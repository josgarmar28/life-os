# LIFE OS

Sistema operativo personal: una base de datos única (Supabase/PostgreSQL), lógica determinista en TypeScript y agentes de Claude con permisos mínimos, bajo aprobación humana.

> **Estado:** fase P0 (fundamentos). Hoy el repositorio contiene el diseño, el esquema base de la base de datos y sus pruebas. **No hay despliegue, no hay integraciones y no hay datos personales.**

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
