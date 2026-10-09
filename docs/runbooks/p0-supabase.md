# Runbook P0 — Supabase y secretos

Objetivo: aplicar las migraciones de `supabase/migrations/` a TU proyecto de Supabase de forma controlada, sin compartir claves con nadie.

## Principios
- **Nunca** pegues contraseñas, claves ni tokens en el chat ni en el repositorio.
- Las migraciones solo se aplican tras revisar y fusionar el pull request.
- Mientras solo haya esquema y datos sintéticos, el plan gratuito vale. **Antes de cargar datos reales, pasa a Pro** (backups diarios, sin pausa por inactividad). Verifica en el panel de Supabase que el cambio de plan no exige recrear el proyecto.

## Pasos (los haces tú)
1. En el panel de Supabase, comprueba la **región** del proyecto (debe ser europea) y la **versión de PostgreSQL** (Settings → Infrastructure). Anota ambas en `docs/state/STATE.md` por PR.
2. Cuando decidamos desplegar, se añadirá un workflow de despliegue **manual** (`workflow_dispatch`) con estos secretos de GitHub Actions, que configuras tú en *Settings → Secrets and variables → Actions*:
   - `SUPABASE_ACCESS_TOKEN`
   - `SUPABASE_DB_PASSWORD`
   - `SUPABASE_PROJECT_REF`
3. Protege el despliegue con un *environment* `production` con revisores obligatorios. Comprueba que tu plan de GitHub lo permite para repositorios privados; si no, el despliegue seguirá siendo manual y lo lanzas tú.
4. Primera aplicación: ejecutar las migraciones en un proyecto sin datos, y luego correr contra él una versión de solo lectura de las comprobaciones de seguridad (RLS activado, ningún permiso para `anon`/`authenticated`). Este script todavía no existe.

## Qué NO está resuelto
- Cómo se conectará cada componente con su rol (usuario de BD por rol o JWT con claim `role`). Se decide al construir el servidor MCP (P2) y se verifica en Supabase.
- Que los esquemas de LIFE OS **no** estén expuestos en la API de datos de Supabase: en *Settings → API → Exposed schemas* solo debe figurar lo que decidamos exponer. Estas migraciones no exponen ninguno.
