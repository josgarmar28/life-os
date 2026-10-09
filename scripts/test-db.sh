#!/usr/bin/env bash
# Aplica supabase/migrations a una base de datos DESECHABLE y ejecuta supabase/tests.
#
#   ./scripts/test-db.sh                       # levanta un PostgreSQL temporal local
#   DATABASE_URL=postgresql://... ./scripts/test-db.sh   # usa una BD vacía y desechable (CI)
#
# Seguridad: se niega a ejecutarse contra hosts de Supabase o bases que ya contengan esquemas de LIFE OS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP=""
PG_BIN=""

cleanup() {
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then
    if [ -n "$PG_BIN" ]; then
      as_pg "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
    fi
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

as_pg() {
  if [ "$(id -u)" = "0" ]; then
    runuser -u pgtest -- "$@"
  else
    "$@"
  fi
}

if [ -z "${DATABASE_URL:-}" ]; then
  PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  if [ -z "$PG_BIN" ]; then
    echo "No se encontró PostgreSQL local; define DATABASE_URL." >&2
    exit 2
  fi
  if [ "$(id -u)" = "0" ] && ! id pgtest >/dev/null 2>&1; then
    useradd --system --create-home --shell /bin/bash pgtest
  fi
  TMP="$(mktemp -d)"
  [ "$(id -u)" = "0" ] && chown pgtest "$TMP"
  as_pg "$PG_BIN/initdb" -D "$TMP/data" -U postgres --auth=trust >/dev/null
  as_pg "$PG_BIN/pg_ctl" -D "$TMP/data" -o "-c listen_addresses='' -c unix_socket_directories='$TMP' -c fsync=off" \
    -l "$TMP/pg.log" -w start >/dev/null
  DATABASE_URL="postgresql:///postgres?host=$TMP&user=postgres"
fi

case "$DATABASE_URL" in
  *supabase.co*|*supabase.com*|*pooler.supabase*)
    echo "Rechazado: DATABASE_URL apunta a Supabase. Estas pruebas solo corren en bases desechables." >&2
    exit 3
    ;;
esac

psql_run() { psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

existing="$(psql_run -At -c "select count(*) from pg_namespace where nspname in ('ops','raw','health')")"
if [ "$existing" != "0" ]; then
  echo "Rechazado: la base ya contiene esquemas de LIFE OS (ops/raw/health). Usa una base vacía y desechable." >&2
  exit 4
fi

echo "== Bootstrap de roles de Supabase (solo pruebas)"
psql_run -o /dev/null -f "$ROOT/supabase/tests/00_bootstrap_supabase_roles.sql"

echo "== Migraciones"
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  echo "   $(basename "$f")"
  psql_run -o /dev/null -f "$f"
done

echo "== Pruebas"
fail=0
for f in $(ls "$ROOT"/supabase/tests/*.test.sql | sort); do
  if (cd "$ROOT/supabase/tests" && psql_run -o /dev/null -f "$f"); then
    echo "   OK   $(basename "$f")"
  else
    echo "   FAIL $(basename "$f")" >&2
    fail=1
  fi
done

if [ "$fail" != "0" ]; then
  echo "Pruebas de base de datos: FALLO" >&2
  exit 1
fi
echo "Pruebas de base de datos: OK"
