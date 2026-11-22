# ADR-0002 — Dashboard único, conector propio y plan gratuito

- **Fecha:** 2026-10-18
- **Estado:** aceptada por el usuario (respuestas del 18-oct a las 5 preguntas de la propuesta v0.1 del dashboard).
- **Sustituye:** D-02 de ADR-0001. Complementa D-05 y D-07.

## Contexto
El usuario quiere un dashboard único con todas las áreas, que pueda crear, modificar y eliminar áreas desde él, y que **toda la introducción de datos** (entreno, sueño, cardio, peso, estrés, cuestionarios) se haga ahí; a Claude solo le pedirá cambios o peticiones. Quiere el conector ya, empezar en enero con el sistema vacío y **no pagar nada** (Supabase en plan gratuito).

## Decisiones

| ID | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| D-15 | **Plan gratuito de Supabase en producción** con copia diaria cifrada (age) en GitHub Actions y uso diario anti-pausa | Supabase Pro (D-02) | Decisión del usuario. El volumen previsto cabe de sobra en 500 MB; la copia propia cubre la falta de backups |
| D-16 | **Motor de áreas genérico** (`core`): áreas, formularios y campos son datos; los formularios del dashboard se generan de ellos; validación determinista en la BD | Tablas por área (P1 de la Vía B: máquinas, medidas, peso) | Es la única forma de crear y modificar áreas desde el dashboard sin migraciones. Las tablas P1 pasan a ser formularios (`entreno/maquina`, `cuerpo/peso`, `cuerpo/cinta`) |
| D-17 | Registros **solo de anexado**: corregir = versión nueva con `supersedes_id`; borrar = versión anulada; borrado definitivo de un área solo escribiendo su nombre. "Eliminar" en el dashboard = archivar | Edición en sitio | Mismos principios que D-05; nada se pierde por error |
| D-18 | **Un único dueño** (`core.app_owner`), registro cerrado. Acceso con **contraseña** (mín. 10 caracteres); la primera vez, o si la olvida, **enlace por correo** y la crea en Ajustes. *Revisada 2026-10-19*: antes era solo código por correo | Solo código por correo; varios usuarios | Desde jun-2026 los proyectos gratuitos nuevos no pueden editar la plantilla del correo, así que el código no llega garantizado; la contraseña funciona igual en Safari y en la app instalada, y no gasta los pocos correos por hora del plan gratuito |
| D-19 | **Conector MCP propio** (Edge Function) con el **servidor OAuth 2.1 de Supabase** (beta) y consentimiento en el dashboard. El agente lee, añade y corrige registros (marcados `claude`); los cambios de estructura solo como **propuesta** que el dueño aprueba en el dashboard, ligada a un hash del contenido | Clave en la URL; servidor de autorización aparte | Coste cero, sin secretos compartidos, y la BD (no el prompt) limita al agente (D-07) |
| D-20 | Dashboard React + Vite como **PWA** en **Cloudflare Pages** | GitHub Pages (en repos privados requiere plan de pago), Vercel/Netlify | Gratis, cabeceras de seguridad propias, sin límite de tráfico práctico |
| D-21 | Despliegue y configuración **solo con workflows manuales** desde `main` (`deploy`, `bootstrap`) que el usuario lanza escribiendo una confirmación | Despliegue automático al fusionar | Cada cambio en su Supabase queda aprobado por él |
| D-22 | **Arranque en enero, vacío**: sin importar el histórico de los chats | Importación inicial | Decisión del usuario |
| D-23 | **Claves nuevas de Supabase** (`publishable` y `secret`, `sb_secret_…` solo en la cabecera `apikey`), con las heredadas `anon`/`service_role` como respaldo | Solo claves heredadas | Los proyectos nuevos ya no las traen |
| D-24 | Las propuestas de Claude nombran áreas, cuestionarios y campos **por su nombre corto** y un cuestionario nuevo llega **con sus campos dentro** (todo o nada); la revisión semanal sale de `lifeos_week`, la misma cuenta que la página Semana | Propuestas por id, campo a campo | Claude no ve los ids internos sin leer antes; aprobar un cuestionario a medias dejaría formularios incompletos |

| D-25 | *2026-11-22.* **Planes versionados** (`core.plan`: horario, rutina, menú con productos y recetas) como documentos JSON validados, con fecha de inicio; nunca se editan: una versión nueva sustituye a la anterior desde su fecha. Se importan desde un archivo privado o Claude los propone (`plan.save`) y el dueño aprueba | Tablas por bloque, ejercicio y receta | Cambian poco y siempre en bloque; versión entera = revisión clara y vuelta atrás trivial. Los datos reales no entran al repositorio |
| D-26 | *2026-11-22.* **Despensa como libro de movimientos** (recuento, compra, ajuste; solo anexado) y **stock estimado** con el menú: último recuento + compras − consumo diario del menú (los días "fuera de casa" no gastan). Lista de la compra = necesidad del periodo del pedido − lo que quedará al llegar, en envases enteros | Inventario manual completo; descontar al registrar cada comida | Cero registro diario; él solo recuenta de vez en cuando y marca los pedidos recibidos |
| D-27 | *2026-11-22.* **Semana configurable** (`core.week_plan`): días de teletrabajo (por defecto los del horario) y días fuera de casa; Claude puede fijarlos cuando él se lo dice | Horario fijo | Elige el teletrabajo cada semana y de ello dependen el autobús, el lote 3 y la entrega |
| D-28 | *2026-11-22.* **Modo entreno** con sugerencia de doble progresión (entrenamiento/05) calculada en el cliente a partir de las series guardadas; cada serie lleva `linea` (clave del ejercicio en el plan) para comparar con la última vez aunque cambie el nombre. La sugerencia es orientativa; los cambios de rutina siguen siendo propuestas | Progresión en la BD; sin sugerencia | Funciona sin cobertura y no añade estado; la decisión sigue siendo suya |
| D-29 | *2026-11-22.* **Rutina por gimnasio**: un plan de entreno vigente por `gym` (sin él, el de casa `elevate`), con `mode` `mantenimiento` para el de viaje (repetir carga, sin escalones ni estancamiento). **Periodos** (`core.gym_period`, sin solapes) dicen qué gimnasio toca cada día; la sesión guarda `gimnasio` y sus líneas tienen claves propias, así que el historial va aparte pero las series cuentan para el volumen | Tipo de plan nuevo; mezclar historiales; elegir gimnasio en cada sesión | Visita mensual a España sin tocar la rutina de casa ni falsear su progresión; la excepción por sesión queda en el selector |

## Consecuencias
- Los esquemas de P0 (`raw`, `health`, `ops`) se mantienen; `health` queda para importaciones automáticas futuras (Zepp) y `ops.audit_log` recibe la auditoría del motor de áreas.
- El servidor OAuth de Supabase está en beta: si cambia, el conector puede necesitar ajustes. Riesgos y comprobaciones pendientes en `docs/runbooks/dashboard-puesta-en-marcha.md`.
- Las fotos corporales y de pelo no entran nunca en el sistema.
