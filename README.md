# LIFE OS

Sistema operativo personal: una base de datos única (Supabase/PostgreSQL), lógica determinista en TypeScript y agentes de Claude con permisos mínimos, bajo aprobación humana.

> **Estado:** dashboard, motor de áreas y conector de Claude escritos y probados; **sin desplegar** hasta que el usuario siga `docs/runbooks/dashboard-puesta-en-marcha.md`. No hay datos personales en el repositorio.

## Contenido

| Ruta | Qué hay |
|---|---|
| `docs/spec/` | Especificación técnica (v0.1) y adenda (v0.2). Ante discrepancia, prevalece la adenda. |
| `docs/adr/` | Decisiones de arquitectura (ADR). |
| `docs/state/STATE.md` | Estado vivo del proyecto: decisiones, riesgos, tareas, estado real. |
| `docs/runbooks/` | Guías operativas (puesta en marcha de Supabase y secretos). |
| `supabase/migrations/` | Migraciones SQL, solo hacia delante. |
| `supabase/tests/` | Pruebas SQL de seguridad y flujos (corren en CI). |
| `scripts/test-db.sh` | Aplica migraciones y pruebas a una base **desechable**. |
| `supabase/seed/` | Áreas y cuestionarios iniciales (solo estructura). |
| `supabase/functions/mcp/` | Conector MCP para Claude (Edge Function con OAuth de Supabase). |
| `supabase/functions/_shared/` | TypeScript puro compartido por el conector y el dashboard (modelo, estadísticas). |
| `apps/dashboard/` | Dashboard web instalable (React + Vite, PWA). |
| `.github/workflows/` | `ci` (pruebas), `deploy` y `bootstrap` (manuales), `backup` (copia diaria cifrada). |

## Probar el dashboard en local

```bash
cd apps/dashboard && npm ci && npm test && npm run build
```

## Probar la base de datos en local

Requiere PostgreSQL (binarios `initdb`/`pg_ctl`, y `psql`):

```bash
./scripts/test-db.sh
```

Levanta un PostgreSQL temporal, simula los roles de Supabase (`anon`, `authenticated`, `service_role`), aplica las migraciones y ejecuta las pruebas. Con `DATABASE_URL` usa una base vacía y desechable (es lo que hace CI). El script se niega a ejecutarse contra hosts de Supabase o contra una base que ya contenga los esquemas de LIFE OS.

## Reglas del repositorio

1. **Sin secretos** en el repositorio, en prompts ni en logs. Las claves viven en los secretos de GitHub Actions y en el gestor de secretos de cada servicio.
2. **Sin datos personales reales**, ni siquiera en fixtures: solo datos sintéticos.
3. **Migraciones solo hacia delante.** Las correcciones son migraciones nuevas. Un cambio destructivo requiere ADR y copia de seguridad previa.
4. **La autorización se aplica en la base de datos**, no en prompts: los agentes solo pueden proponer; aprobar y ejecutar son roles distintos.
5. Todo cambio entra por pull request con CI en verde.
