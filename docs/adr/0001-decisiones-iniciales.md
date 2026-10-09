# ADR-0001 — Decisiones iniciales de arquitectura

- **Fecha:** 2026-10-09
- **Estado global:** propuesta. Cada decisión indica su estado individual; ninguna de las marcadas "pendiente" debe tratarse como aceptada.
- **Detalle y justificación:** `docs/spec/SPEC-001-especificacion-tecnica-v0.1.md` y `docs/spec/SPEC-002-adenda-v0.2.md`.

| ID | Decisión | Alternativa descartada | Estado |
|---|---|---|---|
| D-01 | PostgreSQL (Supabase) como única fuente de verdad | Hojas de cálculo + varias bases | Pendiente de aprobación |
| D-02 | Supabase Pro antes de cargar datos reales (backups, sin pausa). Plan gratuito solo con datos sintéticos | Plan gratuito en producción (pausa a 1 semana, sin backups, 500 MB) | Pendiente de aprobación |
| D-03 | Lógica en TypeScript/Edge Functions + `pg_cron`; sin n8n el primer día | n8n desde el inicio (Community sin Git/entornos; Cloud Starter 2.500 ejecuciones/mes) | Pendiente de aprobación |
| D-04 | Cómo ejecutar n8n cuando haga falta | — | Pospuesta a la fase P3 |
| D-05 | Ledger inmutable (`raw`) + observaciones con calidad (`measured/manual/estimated`) y correcciones por `supersedes_id` | Tablas por métrica; JSONB sin esquema | Pendiente de aprobación |
| D-06 | Dos agentes al inicio (coordinador y salud) | Un agente por subdominio | Pendiente de aprobación |
| D-07 | Niveles de acción 0–3 aplicados en BD; **sin política de auto-ejecución**: toda acción requiere aprobación | Autorización por prompt | Ajustada según la respuesta del usuario (aprobación siempre) |
| D-08 | Monorepo, ramas cortas con PR, migraciones solo hacia delante | Varios repositorios | Pendiente de aprobación |
| D-09 | Finanzas: sin conexiones a bancos; solo datos entregados por el usuario; solo lectura | Agregadores bancarios | **Confirmada por el usuario** |
| D-10/D-11 | Interfaz = app de Claude + conector MCP remoto propio; aprobaciones en página aparte | Bot de mensajería + app propia | Pendiente de aprobación |
| D-12 | Registro de evidencia con DOI/PMID verificado por código | Citas libres del modelo | Pendiente de aprobación |
| D-13 | Fotos corporales: bucket privado, retención corta, envío a Claude solo bajo petición | — | Pendiente de aprobación |
| D-14 | Avisos mediante adaptador intercambiable; correo como opción por defecto | Notificaciones push propias | Pendiente de prueba en P2 |

## Implementado en P0 (esta rama)

- Esquemas `raw`, `core`, `health`, `training`, `nutrition`, `body`, `knowledge`, `ops` (solo `raw`, `health` y `ops` tienen tablas).
- Roles `NOLOGIN`: `app_reader`, `ingest_writer`, `agent_writer`, `executor`, `approver`.
- Tablas de solo inserción: `ops.audit_log`, `ops.approval`, `raw.event`, `health.observation`.
- Propuestas inmutables ligadas a un hash; aprobación ligada a ese hash; ejecución idempotente y solo si está aprobada y vigente.
- RLS activado en todas las tablas; sin política = sin acceso.

## Límites conocidos del diseño actual

- Los roles son `NOLOGIN`. Cómo se conectan en producción las Edge Functions con un rol concreto (conexión directa con un usuario de BD por rol, o JWT con claim `role`) **no está verificado en Supabase**. Hasta decidirlo, no hay componente que use estas funciones.
- En Supabase, `service_role` ignora RLS: su clave no debe llegar nunca a agentes, n8n ni clientes.
- El esquema no está probado contra Supabase real, solo contra PostgreSQL 16 local. Versión de PostgreSQL de Supabase: sin verificar.
- Pendientes explícitos: umbrales de revisión profesional, catálogo de equipamiento, reglas de evidencia, presupuesto de tokens (`ops.budget`).
