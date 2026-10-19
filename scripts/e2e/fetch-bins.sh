#!/usr/bin/env bash
# Descarga (versiones fijas) los binarios oficiales de PostgREST y Supabase Auth para las pruebas e2e.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${E2E_BIN:-$ROOT/.e2e-bin}"
POSTGREST=v12.2.12
AUTH=v2.186.0
mkdir -p "$DEST/auth"
if [ ! -x "$DEST/postgrest" ]; then
  curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST/postgrest-$POSTGREST-linux-static-x86-64.tar.xz" | tar xJ -C "$DEST"
fi
if [ ! -x "$DEST/auth/auth" ]; then
  curl -fsSL "https://github.com/supabase/auth/releases/download/$AUTH/auth-$AUTH-x86.tar.gz" | tar xz -C "$DEST/auth"
fi
"$DEST/postgrest" --version
"$DEST/auth/auth" version
