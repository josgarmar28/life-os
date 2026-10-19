#!/usr/bin/env bash
# Levanta un Supabase LOCAL mínimo y desechable para las pruebas end-to-end del dashboard y del conector:
#   PostgreSQL (initdb temporal) + Supabase Auth (GoTrue, con servidor OAuth) + PostgREST
#   + conector MCP en Deno + dashboard compilado + pasarela tipo Kong en un único origen.
# No toca ningún Supabase real ni usa claves reales: todo se genera aquí y se borra al salir.
#
#   scripts/e2e/stack.sh            # levanta, ejecuta las pruebas e2e y apaga
#   KEEP=1 scripts/e2e/stack.sh     # deja todo levantado (Ctrl+C para parar)
#
# Requiere: PostgreSQL 16 (initdb/pg_ctl/psql), Node 22, Deno 2, y los binarios de PostgREST y Auth
# en $E2E_BIN (los descarga scripts/e2e/fetch-bins.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
E2E_BIN="${E2E_BIN:-$ROOT/.e2e-bin}"
TMP="$(mktemp -d)"
PIDS=()
PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"

# El conector usa el puerto por defecto de Deno.serve (8000).
GW=54321; PG=54329; AUTH=54331; REST=54330; FN=8000; WEB=54333
SECRET="e2e-local-secret-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
URL="http://127.0.0.1:$GW"

cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  as_pg "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
  if [ -n "${E2E_LOGS:-}" ]; then mkdir -p "$E2E_LOGS" && cp "$TMP"/*.log "$E2E_LOGS"/ 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u pgtest -- "$@"; else "$@"; fi; }
if [ "$(id -u)" = 0 ]; then id pgtest >/dev/null 2>&1 || useradd --system --create-home pgtest; chown pgtest "$TMP"; fi

wait_http() { for _ in $(seq 1 60); do curl -s -o /dev/null "$1" && return 0; sleep 0.5; done; echo "No arranca: $1" >&2; tail -30 "$TMP"/*.log >&2; exit 1; }

echo "== PostgreSQL"
as_pg "$PG_BIN/initdb" -D "$TMP/data" -U postgres --auth=trust >/dev/null
as_pg "$PG_BIN/pg_ctl" -D "$TMP/data" -o "-c listen_addresses=127.0.0.1 -c port=$PG -c unix_socket_directories='$TMP' -c fsync=off" -l "$TMP/pg.log" -w start >/dev/null
DB="postgresql://postgres@127.0.0.1:$PG/postgres"
psql_run() { psql "$DB" -X -q -v ON_ERROR_STOP=1 "$@"; }

# Roles como en Supabase.
psql_run <<'SQL'
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login createrole noinherit;
create schema auth authorization supabase_auth_admin;
grant create on database postgres to supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
SQL

echo "== Auth (migraciones propias)"
AUTH_ENV=(
  GOTRUE_DB_DRIVER=postgres
  DATABASE_URL="postgresql://supabase_auth_admin@127.0.0.1:$PG/postgres?search_path=auth"
  GOTRUE_DB_MIGRATIONS_PATH="$E2E_BIN/auth/migrations"
  API_EXTERNAL_URL="$URL/auth/v1"
  GOTRUE_API_HOST=127.0.0.1 PORT=$AUTH
  GOTRUE_SITE_URL="$URL" GOTRUE_URI_ALLOW_LIST="$URL/**"
  GOTRUE_JWT_SECRET="$SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
  GOTRUE_JWT_ADMIN_ROLES=service_role
  GOTRUE_DISABLE_SIGNUP=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=false
  GOTRUE_SMTP_HOST= GOTRUE_SMTP_MAX_FREQUENCY=1ns GOTRUE_MAILER_OTP_EXP=600 GOTRUE_RATE_LIMIT_EMAIL_SENT=1000
  GOTRUE_JWT_ISSUER="$URL/auth/v1"
  GOTRUE_OAUTH_SERVER_ENABLED=true GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION=true
  GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH=/oauth/consent
  GOTRUE_LOG_LEVEL=info
)
env "${AUTH_ENV[@]}" "$E2E_BIN/auth/auth" migrate >"$TMP/auth-migrate.log" 2>&1 || { cat "$TMP/auth-migrate.log"; exit 1; }
psql_run <<'SQL'
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
SQL

echo "== Migraciones de LIFE OS y áreas iniciales"
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do psql_run -o /dev/null -f "$f"; done
psql_run -o /dev/null -f "$ROOT/supabase/seed/areas-iniciales.sql"

ANON="$(node "$ROOT/scripts/e2e/jwt.mjs" "$SECRET" anon)"
SERVICE="$(node "$ROOT/scripts/e2e/jwt.mjs" "$SECRET" service_role)"

echo "== Servicios"
env "${AUTH_ENV[@]}" "$E2E_BIN/auth/auth" serve >"$TMP/auth.log" 2>&1 & PIDS+=($!)
cat > "$TMP/postgrest.conf" <<CONF
db-uri = "postgresql://authenticator@127.0.0.1:$PG/postgres"
db-schemas = "api"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $REST
CONF
"$E2E_BIN/postgrest" "$TMP/postgrest.conf" >"$TMP/postgrest.log" 2>&1 & PIDS+=($!)
SUPABASE_URL="$URL" SUPABASE_ANON_KEY="$ANON" \
  deno run --allow-net --allow-env --config "$ROOT/supabase/functions/mcp/deno.json" \
  "$ROOT/supabase/functions/mcp/index.ts" >"$TMP/mcp.log" 2>&1 & PIDS+=($!)
(cd "$ROOT/apps/dashboard" && VITE_SUPABASE_URL="$URL" VITE_SUPABASE_ANON_KEY="$ANON" npx vite build --emptyOutDir --outDir "$TMP/web" >"$TMP/build.log" 2>&1)
(cd "$ROOT/apps/dashboard" && exec node node_modules/vite/bin/vite.js preview --outDir "$TMP/web" --host 127.0.0.1 --port $WEB --strictPort >"$TMP/web.log" 2>&1) & PIDS+=($!)
node "$ROOT/scripts/e2e/gateway.mjs" $GW $AUTH $REST $FN $WEB >"$TMP/gateway.log" 2>&1 & PIDS+=($!)

wait_http "http://127.0.0.1:$AUTH/health"
wait_http "http://127.0.0.1:$REST/"
wait_http "http://127.0.0.1:$FN/functions/v1/mcp"
wait_http "http://127.0.0.1:$WEB/"
wait_http "$URL/"
echo "   listo en $URL"

export E2E_URL="$URL" E2E_ANON="$ANON" E2E_SERVICE="$SERVICE" E2E_DB="$DB"
if [ -n "${KEEP:-}" ]; then
  echo "E2E_URL=$URL E2E_ANON=$ANON E2E_SERVICE=$SERVICE E2E_DB=$DB"
  wait
else
  (cd "$ROOT/apps/dashboard" && npx playwright test "$@")
fi
