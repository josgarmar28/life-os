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
| D-18 | **Un único dueño** (`core.app_owner`), acceso con código por correo, registro cerrado | Contraseña; varios usuarios | Sin contraseñas que gestionar; funciona en la app instalada del iPhone |
| D-19 | **Conector MCP propio** (Edge Function) con el **servidor OAuth 2.1 de Supabase** (beta) y consentimiento en el dashboard. El agente lee, añade y corrige registros (marcados `claude`); los cambios de estructura solo como **propuesta** que el dueño aprueba en el dashboard, ligada a un hash del contenido | Clave en la URL; servidor de autorización aparte | Coste cero, sin secretos compartidos, y la BD (no el prompt) limita al agente (D-07) |
| D-20 | Dashboard React + Vite como **PWA** en **Cloudflare Pages** | GitHub Pages (en repos privados requiere plan de pago), Vercel/Netlify | Gratis, cabeceras de seguridad propias, sin límite de tráfico práctico |
| D-21 | Despliegue y configuración **solo con workflows manuales** desde `main` (`deploy`, `bootstrap`) que el usuario lanza escribiendo una confirmación | Despliegue automático al fusionar | Cada cambio en su Supabase queda aprobado por él |
| D-22 | **Arranque en enero, vacío**: sin importar el histórico de los chats | Importación inicial | Decisión del usuario |

## Consecuencias
- Los esquemas de P0 (`raw`, `health`, `ops`) se mantienen; `health` queda para importaciones automáticas futuras (Zepp) y `ops.audit_log` recibe la auditoría del motor de áreas.
- El servidor OAuth de Supabase está en beta: si cambia, el conector puede necesitar ajustes. Riesgos y comprobaciones pendientes en `docs/runbooks/dashboard-puesta-en-marcha.md`.
- Las fotos corporales y de pelo no entran nunca en el sistema.
