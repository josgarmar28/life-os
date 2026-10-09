# LIFE OS — Estado del proyecto

Última actualización: 2026-10-09. Este archivo refleja el **estado real**; lo diseñado pero no construido consta como tal.

## Objetivos
Sistema personal integrado de salud (entrenamiento, nutrición, sueño), trabajo, calendario y finanzas; máxima automatización compatible con seguridad, bajo coste y control del usuario. Detalle en `docs/spec/`.

## Datos del usuario (declarados por él)
Reside en Pully (Suiza). Gimnasio: Elevate Gym. iPhone. Reloj Amazfit (Zepp). Báscula Xiaomi S200 (solo app Xiaomi Home). Plan de Claude: Pro. Google Calendar personal, lectura completa. Finanzas: datos entregados a mano, sin conexiones. Toda acción pasa por su aprobación. El resto (objetivos, medidas, lesiones, alergias, equipamiento) está **pendiente** en `docs/spec/plantilla-datos-de-partida.md`.

## Decisiones
- **Confirmadas:** Claude como plataforma de IA; automatización máxima con aprobación humana; servicios gestionados; coste mínimo; finanzas sin conexiones (D-09); creación del repositorio y del proyecto de Supabase autorizada.
- **Aprobadas por el usuario (2026-10-09):** D-01, D-02, D-03, D-05, D-06, D-07, D-08, D-10/D-11, D-12, D-13.
- **Pendientes por diseño:** D-04 (n8n, fase P3) y D-14 (avisos, se prueba en P2). Ver `docs/adr/0001-decisiones-iniciales.md`.

## Arquitectura vigente
Ver SPEC-002 §3. Resumen: app de Claude + conector MCP propio (interactivo) y routines/`pg_cron` (programado), ambos sobre el mismo backend en Supabase con permisos por rol.

## Estado de ejecución

| Elemento | Estado real |
|---|---|
| Repositorio `josgarmar28/life-os` | Creado por el usuario; PR #1 (P0) fusionado en `main`; CI en verde |
| Esquema base (`raw`, `health`, `ops`) | **Escrito y probado en PostgreSQL 16 local** (3 archivos de prueba, con comprobación de mutaciones). **No aplicado a ningún Supabase** |
| CI (`.github/workflows/ci.yml`) | Ejecutada en GitHub en el PR #1: verde |
| Proyecto Supabase | Creado por el usuario (según su mensaje); **no verificado ni conectado**. Sin acceso desde esta sesión |
| Servidor MCP, Edge Functions, página de aprobación | **No existen** |
| Integraciones (Zepp, Calendar) | **No existen** |
| Datos personales cargados | **Ninguno** |

## Tareas
- [x] Especificación v0.1 y adenda v0.2
- [x] Estructura del repositorio y reglas
- [x] Esquema base de seguridad, auditoría, propuestas/aprobaciones/ejecución, ingesta y observaciones
- [x] Revisión y fusión del PR de P0 por el usuario (PR #1)
- [x] Ejecución de CI en GitHub (verde)
- [ ] Verificación del esquema contra un Supabase real (ver runbook)
- [ ] P1: datos de partida, entrada manual, importación del CSV de Zepp, catálogo de equipamiento

## Riesgos y problemas conocidos
Ver SPEC-001 §11 y SPEC-002 §10.1. Específicos de P0: conexión de roles en Supabase sin verificar; `service_role` ignora RLS; la versión de PostgreSQL de Supabase puede diferir de la 16 probada.

## Próximos pasos
1. El usuario revisa el PR de P0.
2. Verificar el flujo de roles en Supabase (runbook `docs/runbooks/p0-supabase.md`).
3. Rellenar la plantilla de datos de partida; decidir el orden entrenamiento/nutrición.
