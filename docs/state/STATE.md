# LIFE OS — Estado del proyecto

Última actualización: 2026-10-18. Este archivo refleja el **estado real**; lo diseñado pero no construido consta como tal.

## Objetivos
Sistema personal integrado de salud (entrenamiento, nutrición, sueño), trabajo, calendario y finanzas; máxima automatización compatible con seguridad, bajo coste y control del usuario. Detalle en `docs/spec/`.

## Datos del usuario (declarados por él)
Reside en Pully (Suiza). Gimnasio: Elevate Gym. iPhone. Reloj Amazfit (Zepp). Báscula Xiaomi S200 (solo app Xiaomi Home). Plan de Claude: Pro. Google Calendar personal, lectura completa. Finanzas: datos entregados a mano, sin conexiones. Toda acción pasa por su aprobación. El resto (objetivos, medidas, lesiones, alergias, equipamiento) está **pendiente** en `docs/spec/plantilla-datos-de-partida.md`.

## Decisiones
- **Confirmadas:** Claude como plataforma de IA; automatización máxima con aprobación humana; servicios gestionados; coste mínimo; finanzas sin conexiones (D-09); creación del repositorio y del proyecto de Supabase autorizada.
- **Aceptadas 18-oct (ADR-0002):** dashboard único con motor de áreas genérico, entrada de datos solo en el dashboard, conector MCP con OAuth de Supabase, plan gratuito con copia cifrada propia (sustituye D-02), arranque en enero sin histórico, "eliminar" = archivar.
- **Pendientes de aprobación:** D-01, D-03…D-08, D-10…D-14 (ver `docs/adr/0001-decisiones-iniciales.md`).

## Arquitectura vigente
Ver SPEC-002 §3. Resumen: app de Claude + conector MCP propio (interactivo) y routines/`pg_cron` (programado), ambos sobre el mismo backend en Supabase con permisos por rol.

## Estado de ejecución

| Elemento | Estado real |
|---|---|
| Repositorio `josgarmar28/life-os` | Creado por el usuario, adjuntado a la sesión |
| Esquema base (`raw`, `health`, `ops`) | **Escrito y probado en PostgreSQL 16 local** (3 archivos de prueba, con comprobación de mutaciones). **No aplicado a ningún Supabase** |
| CI (`.github/workflows/ci.yml`) | Escrito; **sin ejecutar todavía** en GitHub |
| Proyecto Supabase | Creado por el usuario (según su mensaje); **no verificado ni conectado**. Sin acceso desde esta sesión |
| PR #1 (P0) y #2 | Fusionados el 2026-10-09 con CI en verde |
| Motor de áreas (`core`, migración 2026-10-18) y áreas iniciales | **Escrito y probado en PostgreSQL 16 local** (pruebas 40 y 50). **No aplicado** |
| Dashboard (`apps/dashboard`, PWA) | **Escrito**; compila y pasa sus pruebas. **No desplegado** |
| Conector MCP (`supabase/functions/mcp`) | **Escrito**; pruebas del protocolo y comprobación con Deno. **No desplegado** |
| Workflows `deploy`, `bootstrap`, `backup` | Escritos; manuales salvo la copia diaria. **Sin ejecutar** (faltan sus secretos) |
| Integraciones (Zepp, Calendar) | **No existen** |
| Datos personales cargados | **Ninguno** |

## Tareas
- [x] Especificación v0.1 y adenda v0.2
- [x] Estructura del repositorio y reglas
- [x] Esquema base de seguridad, auditoría, propuestas/aprobaciones/ejecución, ingesta y observaciones
- [ ] Revisión y fusión del PR de P0 por el usuario
- [ ] Ejecución de CI en GitHub
- [ ] Verificación del esquema contra un Supabase real (ver runbook)
- [x] Dashboard, motor de áreas, conector y despliegue gratuito escritos (PR del 18-oct)
- [ ] Puesta en marcha por el usuario: `docs/runbooks/dashboard-puesta-en-marcha.md`
- [ ] Arranque de uso en enero de 2027 (sistema vacío)
- [ ] Más adelante: importación del CSV de Zepp a `health`

## Riesgos y problemas conocidos
Ver SPEC-001 §11 y SPEC-002 §10.1. Específicos de P0: conexión de roles en Supabase sin verificar; `service_role` ignora RLS; la versión de PostgreSQL de Supabase puede diferir de la 16 probada.

## Próximos pasos
1. El usuario revisa y aprueba el PR del dashboard.
2. Sigue el runbook `docs/runbooks/dashboard-puesta-en-marcha.md` (secretos, `deploy`, `bootstrap`, OAuth, iPhone, conector).
3. Se comprueba en su proyecto lo marcado "sin verificar" en ese runbook.
