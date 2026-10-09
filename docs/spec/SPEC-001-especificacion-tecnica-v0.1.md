# LIFE OS — Especificación técnica v0.1

- **Estado del documento:** borrador para revisión. Es diseño, no implementación: **nada de lo descrito aquí está construido, desplegado ni probado**.
- **Fecha:** 2026-10-09
- **Autor:** Claude (arquitecto técnico), a petición de martagon
- **Actualización 2026-10-09:** modificada en parte por [SPEC-002 (adenda v0.2)](SPEC-002-adenda-v0.2.md) tras tus respuestas (interfaz, niveles de acción, fuentes, privacidad). Ante discrepancia, prevalece la adenda.
- **Alcance de esta versión:** decisiones, arquitectura mínima, contratos, plan. Sin cuentas conectadas, sin repositorios creados, sin acciones externas.

## Convención de evidencia

Cada afirmación relevante lleva una etiqueta:

| Etiqueta | Significado |
|---|---|
| **[V]** | Verificado en fuente oficial el 2026-10-09 (ver Anexo A). Los precios cambian: revalidar antes de contratar. |
| **[H]** | Hipótesis o estimación mía. Debe validarse con una prueba o un dato real. |
| **[P]** | Pendiente de verificación; no la he comprobado y no debe darse por cierta. |
| **[U]** | Decisión o dato del usuario (martagon). |

---

## 0. Resumen ejecutivo

1. **Recomendación central:** arrancar con una arquitectura de **tres piezas**: Postgres (Supabase) como única fuente de verdad, **código TypeScript determinista** (Edge Functions + librería de dominio) para cálculos, validaciones y control de permisos, y **Claude API** solo para razonamiento y redacción. **n8n no entra en el día 1**: se incorpora cuando exista la primera integración que lo justifique (OAuth o webhooks de terceros).
2. **Por qué cuestiono n8n como pieza obligatoria:** la edición Community no incluye control de versiones con Git, entornos, ni gestión de secretos externos **[V]**, lo que choca con el principio "todo versionado en GitHub". Además, el plan Starter de n8n Cloud incluye 2.500 ejecuciones/mes **[V]**: un workflow que sondee cada 15 minutos ya consume ~2.880/mes **[H, cálculo propio]**. n8n sigue siendo útil, pero como adaptador de integraciones, no como cerebro.
3. **Un gasto que sí recomiendo:** Supabase **Pro (25 USD/mes)** **[V]**. El plan gratuito pausa proyectos tras 1 semana de inactividad, no incluye backups y limita a 500 MB **[V]**; para datos de salud y finanzas que quieres conservar años, eso es un riesgo inaceptable. Alternativa de coste 0 documentada en §2.
4. **Coste mensual estimado del MVP:** ~27–60 USD **[H]** (Supabase Pro 25 USD **[V]** + Claude API ~2–10 USD **[H]** + n8n 0–~22 USD según decisión D-04 **[V]** para el precio de Cloud). Detalle en §2.6.
5. **Principio de seguridad que condiciona el diseño:** la autorización se aplica con **roles de base de datos y funciones**, no con prompts. Los agentes solo pueden *proponer* (insertar filas en `ops.action_proposal`); un ejecutor determinista distinto ejecuta lo aprobado.
6. **Primer entregable útil (Fase P2):** un resumen diario/semanal de salud generado a partir de datos que tú registres, con cálculos deterministas y narración de Claude, de solo lectura (nivel 0).
7. **Cinco preguntas** que condicionan el diseño definitivo están al final (§12).

---

## 1. Decisiones tomadas y abiertas

### 1.1 Decididas por el usuario [U]

| ID | Decisión | Fuente |
|---|---|---|
| C-01 | Claude es la plataforma principal de IA | Mensaje inicial |
| C-02 | Automatización máxima desde el inicio, con seguridad, fiabilidad y control | Mensaje inicial |
| C-03 | Preferencia por servicios gestionados | Mensaje inicial |
| C-04 | Prioridad presupuestaria: coste mínimo | Mensaje inicial |
| C-05 | Stack de referencia: Claude API, n8n, Supabase/PostgreSQL, TypeScript, GitHub (como hipótesis de trabajo, no como decisión cerrada, según las instrucciones maestras) | Instrucciones maestras §3 |
| C-06 | Nivel técnico avanzado (APIs, SQL, código, despliegues) | Mensaje inicial |
| C-07 | Acciones de nivel 3 requieren aprobación humana explícita | Instrucciones maestras §8 |
| C-08 | No conectar cuentas ni ejecutar acciones externas sin autorización explícita | Tema del proyecto |
| C-09 | Idioma de trabajo: español | Memoria del proyecto |

### 1.2 Propuestas mías pendientes de tu aprobación

| ID | Decisión propuesta | Recomendación | Sección |
|---|---|---|---|
| D-01 | Postgres/Supabase como única fuente de verdad | **Aprobar** | §4 |
| D-02 | Supabase Pro desde el inicio (backups, sin pausa) | **Aprobar** (alternativa gratuita en §2.2) | §2.2 |
| D-03 | Lógica determinista y orquestación inicial en Edge Functions + pg_cron, sin n8n en el día 1 | **Aprobar** | §2.3 |
| D-04 | Cómo ejecutar n8n cuando llegue: Cloud Starter, o autoalojado en contenedor gestionado | Decidir en Fase P3 con datos reales | §2.3 |
| D-05 | Modelo de datos con ledger inmutable (`raw`) + capas normalizadas + observaciones con calidad (`measured/estimated/manual`) | **Aprobar** | §5 |
| D-06 | Dos agentes al inicio (coordinador + salud); resto bajo demanda | **Aprobar** | §6 |
| D-07 | Niveles de acción 0–3 aplicados en BD, con tabla de propuestas y aprobaciones | **Aprobar** | §7 |
| D-08 | Monorepo único, trunk-based, migraciones solo hacia delante, contratos de agente con semver | **Aprobar** | §9 |
| D-09 | Finanzas en solo lectura y por importación (CSV) hasta que exista política específica | **Aprobar** | §8, §10 |
| D-10 | Interfaz inicial: Supabase Studio + un canal de mensajería para captura y aprobaciones; dashboard propio después | Depende de pregunta 4 | §4, §10 |

### 1.3 Abiertas que dependen de información tuya

Fuentes de datos reales, jurisdicción/privacidad, techo presupuestario, canal de interacción preferido, alcance de la autonomía (ver §12). Hasta que las respondas, el diseño es válido pero algunas fases (P3, P4, P6, P7) quedan sin detallar.

---

## 2. Evaluación crítica de la arquitectura propuesta

### 2.1 Qué mantengo y qué cuestiono

| Componente | Veredicto | Motivo |
|---|---|---|
| Supabase/PostgreSQL | **Mantener** | Fuente única de verdad, SQL avanzado (restricciones, RLS, vistas, funciones), gestionado, coste previsible. |
| TypeScript | **Mantener** | Tipado compartido entre validaciones, Edge Functions y contratos de agente. |
| GitHub | **Mantener** | Código, migraciones, prompts, ADRs, CI. |
| Claude API | **Mantener** | Es la decisión C-01. Cuestiono el *uso*, no el proveedor: modelos baratos para tareas rutinarias (§2.5). |
| n8n | **Reducir a adaptador de integraciones** | Ver §2.3. |

### 2.2 Supabase: gratuito vs Pro

Datos verificados **[V]** (supabase.com/pricing, 2026-10-09):

| | Free | Pro |
|---|---|---|
| Precio | 0 USD | desde 25 USD/mes (primer proyecto incluido; proyectos adicionales desde 10 USD/mes) |
| Base de datos | 500 MB/proyecto | 8 GB/proyecto, luego 0,125 USD/GB |
| Pausa por inactividad | Sí, tras 1 semana | No |
| Backups automáticos | No incluidos | Diarios, 7 días |
| Recuperación a un punto (PITR) | No | 100 USD/mes por 7 días de retención |
| Edge Functions | 500.000 invocaciones | 2 millones |
| Tope de gasto | No indicado | Activado por defecto |

**Recomendación:** Pro. Los 25 USD compran backups y ausencia de pausa; un sistema que gestiona entrenamiento, sueño y finanzas no puede depender de que "alguien lo despierte". PITR (100 USD/mes) **no** se justifica para un único usuario; se sustituye por un export lógico periódico (ver §7.5).

**Alternativa de coste 0 (si el presupuesto es estricto):** plan gratuito + `pg_dump` programado en GitHub Actions hacia almacenamiento cifrado propio. Riesgos: pausa a la semana de inactividad [V], tope de 500 MB [V], sin soporte de backup gestionado, y te hace responsable de la restauración. Si algún día el sistema deja de recibir tráfico una semana (viaje, enfermedad), se pausa. **No la recomiendo para producción**, sí para prototipar en la Fase P0–P1.

### 2.3 n8n: dónde encaja realmente

Hechos verificados **[V]** (n8n.io/pricing, docs.n8n.io):

- Cloud Starter: 20 €/mes (facturación anual), 2.500 ejecuciones/mes, 5 ejecuciones concurrentes, 1 proyecto. Cloud Pro: 50 €/mes, 10.000 ejecuciones/mes. No hay plan Cloud gratuito permanente; sí prueba con 1.000 ejecuciones.
- El precio cuenta **ejecuciones de workflow**, no pasos.
- Existe la edición Community autoalojada, gratuita. En Community **no** hay: control de versiones con Git, entornos, SSO, proyectos, compartir credenciales, secretos externos, log streaming ni variables personalizadas. (Una variante "Registered Community", gratuita, añade carpetas, depuración en el editor y datos de ejecución personalizados.)
- Autoalojar exige infraestructura propia (Docker Compose o proveedor cloud); eso contradice parcialmente "servicios gestionados" y añade mantenimiento, parches y copias de seguridad.

Análisis:

| Opción | Coste | Ventajas | Inconvenientes |
|---|---|---|---|
| **A. Sin n8n (Edge Functions + pg_cron + `pg_net`)** | 0 adicional | Todo en un lugar, versionado en Git, sin ejecuciones facturables, menos piezas | Hay que escribir cada integración en código; límites de Edge Functions: 150 s (Free) / 400 s (Pro) de pared y 2 s de CPU por petición **[V]** |
| **B. n8n Cloud Starter** | 20 €/mes **[V]** | Gestionado, catálogo de conectores/OAuth | 2.500 ejecuciones/mes; sin Git ni entornos **[V para Community; Cloud Starter: [P]]**; ejecución máx. 5 min **[V]** |
| **C. n8n autoalojado** | hosting **[P]** + tiempo | Sin tope de ejecuciones | Mantenimiento, seguridad, backups, parches; sin Git en Community **[V]** |

**Recomendación (D-03/D-04):** empezar con A. Los casos que justifican n8n son los que dependen de conectores OAuth mantenidos por terceros (calendario, tareas, ciertos wearables). Cuando aparezca el primero, decidir B o C con una medición real de ejecuciones/mes. Regla de diseño para que n8n sea **sustituible**: n8n solo hace *extraer → POST a una Edge Function de ingesta con clave de idempotencia*. Nunca escribe directamente en tablas ni contiene lógica de negocio.

Pendiente de verificar **[P]**: si n8n Cloud Starter incluye gestión de credenciales segura suficiente y exportación de workflows por API/CLI (la exportación existe, a mi entender, pero no la he comprobado); condiciones de la licencia de la edición Community para uso personal.

### 2.4 Complejidad que NO añado

- Sin Kubernetes, sin colas externas (Kafka/Redis), sin base vectorial separada: Postgres basta. Si en el futuro hace falta búsqueda semántica sobre notas, `pgvector` es una extensión de Postgres **[P: confirmar disponibilidad en Supabase]**.
- Sin framework de orquestación de agentes (LangChain y similares): un coordinador es una función TypeScript que llama a la API de Claude con herramientas definidas. Justificación: menos dependencias, depuración con SQL y logs propios.
- Sin un agente por tarea trivial: calculadoras (déficit calórico, volumen semanal, saldo presupuestario) son funciones TypeScript, no agentes.

### 2.5 Uso económico de Claude

Precios verificados **[V]** (platform.claude.com, 2026-10-09), por millón de tokens:

| Modelo | Entrada | Salida | Lectura de caché | Batch (entrada / salida) |
|---|---|---|---|---|
| Fable 5.1 | 10 USD | 50 USD | 0,25 USD | 5 / 25 USD |
| Opus 5.5 | 4 USD | 20 USD | 0,20 USD | 2 / 10 USD |
| Sonnet 5.5 | 2 USD | 10 USD | 0,10 USD | 1 / 5 USD |
| Haiku 5.5 (prompt ≤100k) | 0,10 USD | 0,50 USD | 0,01 USD | 0,05 / 0,25 USD |

Escritura de caché: 1,25× (5 min) o 2× (1 h) el precio de entrada. Batch: −50 % **[V]**.

Política propuesta **[H]**:
- **Haiku 5.5** para clasificación, extracción y normalización de texto (p. ej. interpretar una comida descrita en texto libre).
- **Sonnet 5.5** para el coordinador y los informes.
- **Opus/Fable** solo en revisiones puntuales (planificación trimestral, análisis complejo), nunca en bucles automáticos.
- **Batch** para informes no urgentes (resumen semanal nocturno).
- Los **cálculos nunca van a Claude**: el modelo recibe resultados ya calculados y los interpreta.
- **Tope de gasto en código:** tabla `ops.budget` con límite mensual; la capa que llama a Claude se niega a ejecutar si se supera. No se confía en el prompt para esto.

### 2.6 Estimación de coste mensual [H salvo donde se indique]

| Concepto | Mínimo | Esperado | Nota |
|---|---|---|---|
| Supabase Pro | 25 USD **[V]** | 25 USD | Sin proyectos adicionales; desarrollo en local con CLI **[P: confirmar flujo]** |
| Claude API | ~2 USD | ~5–10 USD | Ejemplo: 1 informe diario de 20.000 tokens de entrada + 2.000 de salida en Sonnet 5.5 ≈ 0,06 USD/día ≈ 1,8 USD/mes; el resto son recomendaciones, capturas y semanales |
| n8n | 0 | 0–22 USD | 0 hasta que haga falta; Cloud Starter = 20 €/mes **[V]** |
| GitHub | 0 | 0 | Plan gratuito con repos privados y Actions **[P: verificar límites de minutos]** |
| Dominio / interfaz | 0 | 0–10 | Hosting estático gratuito **[P]** |
| **Total** | **~27 USD** | **~35–60 USD** | |

Hasta no medir el uso real, el rango de Claude es una estimación, no una medición.

---

## 3. Requisitos

### 3.1 Funcionales

| ID | Requisito | Prioridad |
|---|---|---|
| RF-01 | Registrar datos de salud (entrenamiento, nutrición, sueño, biometría) con origen, unidad, fecha y calidad | Alta |
| RF-02 | Importar datos desde fuentes externas con deduplicación y trazabilidad al dato original | Alta |
| RF-03 | Calcular métricas derivadas de forma determinista y reproducible (con versión del método) | Alta |
| RF-04 | Generar resúmenes y recomendaciones con Claude, citando datos y marcando incertidumbre | Alta |
| RF-05 | Objetivos con indicadores (KPI), metas y seguimiento | Alta |
| RF-06 | Proponer acciones (tareas, eventos, ajustes de plan) sin ejecutarlas hasta aprobación según nivel | Alta |
| RF-07 | Flujo de aprobación humana con registro (quién, cuándo, qué versión de la propuesta) | Alta |
| RF-08 | Auditoría completa: quién/qué ejecutó, con qué entrada, qué salida, a qué coste | Alta |
| RF-09 | Gestión de trabajo y proyectos (tareas, hitos, prioridades, carga) | Media |
| RF-10 | Finanzas: ingresos, gastos, presupuesto, ahorro, patrimonio (solo lectura al inicio) | Media |
| RF-11 | Detección de conflictos entre dominios (p. ej. semana de carga laboral alta vs plan de entrenamiento intenso) | Media |
| RF-12 | Interfaz de supervisión: estado del sistema, errores, propuestas pendientes, KPIs | Media |
| RF-13 | Exportación completa de mis datos en formato abierto | Media |
| RF-14 | Evaluación continua de calidad de los agentes con casos de prueba | Media |

### 3.2 No funcionales

| ID | Requisito | Criterio medible |
|---|---|---|
| RNF-01 | Fiabilidad | Ningún fallo de automatización pierde datos; todo fallo queda en `ops.dead_letter` con reintento manual |
| RNF-02 | Idempotencia | Reprocesar una misma entrada 2 veces no crea duplicados (prueba automatizada) |
| RNF-03 | Seguridad | RLS activado en todas las tablas; ningún secreto en repositorio, prompts ni logs; menor privilegio por componente |
| RNF-04 | Privacidad | Datos mínimos a Claude (sin identificadores bancarios, sin direcciones); registro de qué se envió |
| RNF-05 | Trazabilidad | Toda recomendación enlaza a los datos y versiones de método/prompt que la generaron |
| RNF-06 | Recuperabilidad | Restauración probada de backup al menos una vez antes de depender del sistema; objetivo de pérdida de datos ≤24 h (RPO) **[H, a confirmar contigo]** |
| RNF-07 | Coste | Gasto total ≤ techo que definas (pregunta 3); alerta al 80 % del tope de Claude |
| RNF-08 | Mantenibilidad | Un solo repositorio, migraciones versionadas, CI con tipos, linter y pruebas |
| RNF-09 | Sustituibilidad | Cualquier integración o proveedor de IA reemplazable sin migrar el modelo de datos |
| RNF-10 | Observabilidad | Cada ejecución con `run_id`, duración, estado, tokens y coste |
| RNF-11 | Portabilidad | Esquema en SQL estándar; sin dependencias propietarias no documentadas |
| RNF-12 | Seguridad frente a entradas no confiables | Texto externo (correos, eventos, notas importadas) tratado como dato, nunca como instrucción (§7.6) |

---

## 4. Arquitectura técnica inicial

### 4.1 Vista de componentes

```
                      ┌────────────────────────────┐
  Tú (captura,        │  Interfaz                  │
  aprobaciones) ◄────►│  canal de mensajería [D-10]│
                      │  + Studio / dashboard      │
                      └─────────────┬──────────────┘
                                    │ eventos (HTTPS firmado)
┌──────────────────┐   ┌────────────▼──────────────┐   ┌───────────────────┐
│ Fuentes externas │   │  CAPA DE APLICACIÓN (TS)  │   │  Claude API       │
│ (wearables, apps,│──►│  Edge Functions           │◄─►│  razonamiento,    │
│ calendario, CSV) │   │  · ingest   · compute     │   │  redacción        │
│   [vía adaptador;│   │  · coordinator · executor │   └───────────────────┘
│    n8n opcional] │   └────────────┬──────────────┘
└──────────────────┘                │ roles de BD con menor privilegio
                      ┌─────────────▼──────────────┐
                      │ Supabase / PostgreSQL      │
                      │ raw · core · health ·      │
                      │ work · finance · agents ·  │
                      │ ops (auditoría, colas)     │
                      │ pg_cron: programación      │
                      └────────────────────────────┘
```

### 4.2 Responsabilidades

| Componente | Hace | No hace |
|---|---|---|
| **PostgreSQL** | Persistencia, relaciones, restricciones, RLS, vistas de métricas simples, programación (`pg_cron`) | Llamar a modelos de IA con lógica de negocio compleja |
| **Edge Function `ingest`** | Validar (esquema), deduplicar, guardar crudo en `raw`, normalizar a tablas de dominio | Interpretar datos con IA |
| **Edge Function `compute`** | Calcular métricas derivadas con funciones puras y versionadas | Decidir acciones |
| **Edge Function `coordinator`** | Montar contexto, elegir especialistas, llamar a Claude, validar salidas contra esquema, guardar resultados | Escribir en tablas de dominio; ejecutar acciones |
| **Edge Function `executor`** | Ejecutar acciones **aprobadas** y vigentes, con idempotencia y registro | Decidir qué ejecutar; aprobar |
| **Claude API** | Razonar, resumir, proponer | Cálculos, permisos, estado |
| **n8n (opcional)** | Extraer de terceros y enviar a `ingest` | Lógica de negocio, escritura directa en BD |
| **GitHub + Actions** | Código, migraciones, CI, backups lógicos programados | Almacenar secretos en texto plano |

**Límite a vigilar [V]:** las Edge Functions permiten 150 s (Free) / 400 s (Pro) de duración y 2 s de CPU por petición. Los informes pesados deben trocearse o ejecutarse en Batch (asíncrono) y el resultado leerse después, en lugar de esperar dentro de una petición.

### 4.3 Flujos de datos principales

**Flujo A — Ingesta**
1. Fuente → adaptador → `ingest` con `source`, `external_id`, `payload`, `idempotency_key`.
2. `ingest` valida el esquema, guarda en `raw.event` (inmutable), `UNIQUE (source, external_id)`.
3. Normalizador crea/actualiza `health.observation` (o tabla de dominio) con `raw_event_id` y calidad (`measured`/`manual`/`estimated`).
4. Errores → `ops.dead_letter`, nunca se pierde el crudo.

**Flujo B — Análisis**
1. `pg_cron` (o evento) crea una `ops.run` de tipo `daily_brief`.
2. `compute` actualiza métricas derivadas con versión de método.
3. `coordinator` selecciona contexto (solo lo necesario), llama a Claude con el contrato del agente, valida la salida.
4. Se guarda `agents.output` con afirmaciones clasificadas (hecho/estimación/hipótesis/recomendación) y referencias a datos.

**Flujo C — Acción**
1. Agente emite *propuesta* → `ops.action_proposal` (estado `proposed`, nivel calculado por código).
2. Nivel 0/1: queda como borrador. Nivel 2 autorizado: `executor` ejecuta. Nivel 3: espera `ops.approval`.
3. `executor` verifica hash de la propuesta aprobada = hash actual, aplica con clave de idempotencia, registra resultado.

**Flujo D — Retroalimentación**
Resultados observados (p. ej. peso a 4 semanas) se enlazan a la recomendación que los originó en `ops.outcome`, para medir si el sistema funciona (RF-05, RF-14).

---

## 5. Modelo de datos conceptual

### 5.1 Principios

- Separar **dato original** (`raw`), **dato normalizado**, **métrica calculada**, **estimación**, **hipótesis**, **recomendación**, **decisión**, **acción**, **resultado**. Cada tipo es una tabla o estado distinto.
- Nunca sobrescribir: las correcciones crean un registro nuevo con `supersedes_id`.
- Toda medición lleva `source`, `measured_at`, `unit`, `quality` y `raw_event_id`.
- Zona horaria: guardar `timestamptz` y la zona local del usuario cuando importe (p. ej. sueño).

### 5.2 Esquemas y entidades

| Esquema | Entidades principales (conceptual) |
|---|---|
| `core` | `person` (único usuario), `goal`, `kpi`, `kpi_reading`, `decision`, `note`, `tag` |
| `raw` | `source`, `event` (crudo inmutable), `import_batch` |
| `health` | `metric_def` (catálogo: id, nombre, unidad, rango plausible), `observation` (serie temporal genérica con calidad), `workout`, `workout_set`, `exercise`, `meal`, `meal_item`, `food`, `sleep_session`, `body_measurement`, `health_event` (lesión, enfermedad, medicación declarada por ti) |
| `work` | `project`, `task`, `milestone`, `time_block`, `learning_item` |
| `calendar` | `event_ref` (referencia a eventos externos, no copia completa) |
| `finance` | `account`, `transaction`, `category`, `budget`, `holding`, `valuation` (datos mínimos; sin números de cuenta completos) |
| `agents` | `agent` (id), `agent_version` (contrato + prompt + modelo), `run_output`, `claim` (afirmación clasificada con referencias) |
| `ops` | `run`, `run_step`, `action_proposal`, `approval`, `action_execution`, `policy`, `budget`, `dead_letter`, `audit_log`, `outcome` |

### 5.3 Decisión de diseño: tabla genérica de observaciones + tablas de dominio

**Elijo híbrido** (D-05): `health.observation` (EAV controlado por `metric_def`) para series simples (peso, FC en reposo, pasos, HRV, horas de sueño), y tablas relacionales para estructuras complejas (series de entrenamiento, comidas). Descarto "una tabla por métrica" (migraciones constantes) y "todo en JSONB" (sin restricciones ni índices útiles). Implicaciones: mantenimiento bajo para métricas nuevas; consultas de tendencia homogéneas; coste de validación centralizado en `metric_def`.

### 5.4 Esbozo de DDL (no ejecutado, no probado)

```sql
-- Referencia de diseño; requiere revisión y pruebas antes de migrarse.
create schema if not exists raw;
create schema if not exists health;
create schema if not exists ops;

create table raw.event (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  payload jsonb not null,
  content_hash text not null,
  received_at timestamptz not null default now(),
  unique (source, external_id)
);

create table health.metric_def (
  id text primary key,                -- p. ej. 'body_weight'
  unit text not null,                 -- 'kg'
  plausible_min numeric,
  plausible_max numeric
);

create type health.quality as enum ('measured','manual','estimated');

create table health.observation (
  id uuid primary key default gen_random_uuid(),
  metric_id text not null references health.metric_def(id),
  value numeric not null,
  measured_at timestamptz not null,
  quality health.quality not null,
  source text not null,
  raw_event_id uuid references raw.event(id),
  supersedes_id uuid references health.observation(id),
  validation_status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index on health.observation (metric_id, measured_at desc);

create table ops.action_proposal (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  action_type text not null,
  level smallint not null check (level between 0 and 3),
  payload jsonb not null,
  payload_hash text not null,
  idempotency_key text not null unique,
  status text not null default 'proposed',
  created_at timestamptz not null default now()
);
-- RLS: habilitada en todas las tablas; el rol 'agent_writer' solo puede INSERT en
-- ops.action_proposal y en agents.*, nunca UPDATE de 'status' ni acceso a ops.approval.
```

---

## 6. Contratos: coordinador, especialistas y automatizaciones

### 6.1 Agentes iniciales (D-06)

| Agente | Fase | Propósito | Notas |
|---|---|---|---|
| `coordinator` | P2 | Divide petición, elige especialistas, integra, detecta contradicciones, prioriza | Modelo Sonnet 5.5 **[H]** |
| `health` | P2 | Entrenamiento, nutrición, sueño y recuperación como *capacidades* de un único agente | Se divide solo si el contexto o las métricas lo exigen |
| `planner` (trabajo/proyectos/calendario) | P6 | Carga, prioridades, conflictos con salud | Bajo demanda |
| `finance` | P7 | Presupuesto, seguimiento; solo lectura | Bajo demanda |
| `auditor` | P8 | Revisa fallos, deriva de calidad, coste | Mejor como informe determinista + revisión puntual |

**Por qué no un agente por subdominio de salud:** entrenamiento, sueño y nutrición interactúan (recuperación depende de los tres); separarlos obliga al coordinador a reconstruir esas relaciones. Descarto 3 agentes; coste: contexto más amplio por llamada, mitigado con caché de prompts **[V: lectura de caché desde 0,01–0,25 USD/MTok según modelo]**.

### 6.2 Plantilla de contrato de agente (YAML, versionado en Git)

```yaml
id: health
version: 0.1.0
purpose: >
  Interpretar datos de salud ya calculados y proponer ajustes razonados.
responsibilities:
  - resumir tendencias a partir de métricas proporcionadas
  - proponer ajustes de entrenamiento/nutrición/sueño como recomendaciones
limits:
  - no calcular métricas (las recibe de `compute`)
  - no dar diagnóstico ni indicar medicación
  - no ejecutar acciones; solo proponer
  - escalar al usuario ante síntomas o valores fuera de rango plausible
inputs:
  schema: contracts/health.input.schema.json   # ventana temporal, métricas, objetivos
tools_allowed:
  - read_metrics           # solo vistas con RLS de lectura
  - propose_action         # inserta en ops.action_proposal
output:
  schema: contracts/health.output.schema.json
  required_fields: [claims, recommendations, data_gaps, confidence]
  claim_types: [fact, estimate, hypothesis, recommendation]
metrics: [schema_valid_rate, unsupported_claim_rate, cost_per_run, acceptance_rate]
error_policy:
  invalid_output: retry_once_then_dead_letter
  missing_data: return_data_gaps_not_guess
approval:
  max_level_without_human: 1
delegate_or_escalate:
  - condition: cross_domain_conflict   # p. ej. trabajo vs carga de entrenamiento
    to: coordinator
  - condition: medical_concern
    to: user
```

### 6.3 Contrato coordinador ↔ especialista

- **Entrada:** `{run_id, task, time_window, context_refs[], goals[], constraints[]}`; el coordinador pasa **referencias y resultados ya calculados**, no tablas completas.
- **Salida (validada por esquema):** `{claims[{type, text, evidence_refs[]}], recommendations[], proposed_actions[], data_gaps[], confidence}`.
- **Regla:** una `claim` de tipo `fact` sin `evidence_refs` se rechaza por código. Una estimación nunca se presenta como medición.
- **Contradicciones:** el coordinador compara `recommendations` de varios especialistas contra reglas de conflicto (determinista) y solo escala a Claude lo no resoluble.

### 6.4 Contrato de automatizaciones (workflows/funciones)

Todo workflow o función programada declara:

| Campo | Contenido |
|---|---|
| `id`, `version` | Identidad |
| `trigger` | cron / webhook / evento de BD |
| `input_schema` / `output_schema` | JSON Schema |
| `idempotency_key` | Cómo se deriva (p. ej. `source:external_id`) |
| `retries` | Número y backoff (p. ej. 3 reintentos, 2/10/60 s) |
| `timeout` | Debe ser menor que el límite de la plataforma **[V]** |
| `required_level` | Nivel de acción máximo que puede ejecutar |
| `failure_destination` | `ops.dead_letter` + alerta |
| `owner_role` | Rol de BD con el que se ejecuta |

---

## 7. Permisos, auditoría, errores e idempotencia

### 7.1 Niveles de acción (aplicados en código) — D-07

| Nivel | Ejemplos | Quién ejecuta | Aprobación |
|---|---|---|---|
| 0 | Leer, consultar, analizar | Cualquier agente | No |
| 1 | Borradores, propuestas, tareas pendientes | Agente → `ops.action_proposal` | No (queda en cola) |
| 2 | Operaciones rutinarias, reversibles, expresamente autorizadas (p. ej. crear un evento propio en calendario) | `executor` | Política previa en `ops.policy` (limitada en alcance, importe y tiempo) |
| 3 | Finanzas, comunicaciones externas sensibles, compartir datos, irreversibles | `executor` | **Aprobación humana explícita por cada acción**, salvo política específica y acotada |

El nivel lo calcula **código** a partir de `action_type` (tabla `ops.action_catalog`), no lo decide el modelo. Un `action_type` no catalogado se rechaza.

### 7.2 Roles de base de datos (menor privilegio)

| Rol | Puede | No puede |
|---|---|---|
| `app_reader` | `SELECT` en vistas de dominio | Escribir; leer `ops.approval` |
| `ingest_writer` | `INSERT` en `raw.*`; escribir en normalizadas vía funciones | `UPDATE`/`DELETE` sobre `raw.event` |
| `agent_writer` | `INSERT` en `agents.*` y `ops.action_proposal` | Cambiar `status`; leer/escribir `ops.approval` |
| `executor` | `SELECT` propuestas aprobadas; `INSERT` en `ops.action_execution` | Aprobar; crear propuestas |
| `approver` (tú, vía interfaz) | `INSERT` en `ops.approval` | — |
| `service_admin` | Migraciones | Uso en tiempo de ejecución |

La clave de servicio de Supabase (privilegio total) vive solo en gestión de secretos del entorno y **nunca** llega a n8n, a prompts ni al cliente. Habilitar RLS en todas las tablas, incluidas las de `ops`.

### 7.3 Aprobaciones

- La propuesta incluye `payload_hash`. La aprobación guarda `{proposal_id, payload_hash, approved_by, approved_at, expires_at}`.
- `executor` rechaza si el hash difiere (la propuesta cambió) o si ha caducado.
- La aprobación llega por un canal autenticado (D-10). Un mensaje del tipo "ok" a un chat **no** vale si no está vinculado a un `proposal_id` concreto.

### 7.4 Auditoría

`ops.audit_log` (solo inserción, sin `UPDATE`/`DELETE` para ningún rol de aplicación): `{ts, actor (agente/versión/función/humano), action, target, input_ref, output_ref, run_id, result}`. `ops.run` y `ops.run_step` guardan duración, tokens, coste, versión de prompt/contrato, modelo.

### 7.5 Errores, reintentos y recuperación

- **Clasificación:** transitorio (red, 429/5xx) → reintento con backoff exponencial y *jitter*; permanente (validación) → `dead_letter` sin reintento; ambiguo → una repetición y a `dead_letter`.
- **`ops.dead_letter`:** guarda la entrada original, error y contador; con vista y acción de "reintentar" supervisada.
- **Salida de Claude inválida:** un reintento con el error de validación; si falla, `dead_letter`. Nunca se acepta texto libre como acción.
- **Circuit breaker de coste:** si `ops.budget` del mes se supera, el coordinador responde "presupuesto agotado" y no llama a la API.
- **Backups:** backups gestionados de Supabase Pro (7 días) **[V]** + export lógico semanal (`pg_dump`) cifrado a un destino que controles **[H, destino por decidir]**. **Prueba de restauración obligatoria antes de la Fase P3.**
- **Alertas:** fallo de una ejecución programada crítica genera una alerta por el canal elegido (D-10).

### 7.6 Entradas no confiables (inyección de instrucciones)

Texto procedente de terceros (asuntos de correo, descripciones de eventos, notas importadas, nombres de comercios) puede contener instrucciones maliciosas. Reglas:

1. Se pasa al modelo como **datos delimitados**, nunca mezclado con instrucciones del sistema.
2. Un agente que lea contenido no confiable **no** tiene herramientas de nivel ≥2 en la misma llamada.
3. Las acciones salen siempre por `action_proposal` con su nivel calculado por código; el texto del modelo no puede elevar ni reducir el nivel.
4. Datos personales enviados a Claude: lista blanca de campos por contrato; sin identificadores bancarios ni credenciales.

### 7.7 Idempotencia

| Punto | Mecanismo |
|---|---|
| Ingesta | `UNIQUE (source, external_id)` + `content_hash`; si cambia el contenido con el mismo `external_id`, nueva versión con `supersedes_id` |
| Ejecuciones programadas | `run_key` determinista (`daily_brief:2026-10-09`), `UNIQUE`; una repetición reutiliza la ejecución |
| Acciones | `idempotency_key UNIQUE` en `action_proposal` y `action_execution`; el ejecutor comprueba antes de actuar y envía la clave a la API destino cuando esta la admita **[P por integración]** |
| Webhooks entrantes | Firma/HMAC verificada + ventana de tiempo + almacenamiento de `delivery_id` |
| Escrituras con efectos externos | Patrón *outbox*: se escribe la intención en BD, se envía, se marca como enviada |

---

## 8. Estrategia de integración de fuentes de datos

No asumo cuáles usas ni que tengan API. Para cada fuente futura se rellena esta ficha **antes** de construir nada:

### 8.1 Ficha de fuente

| Campo | Pregunta |
|---|---|
| Datos | ¿Qué entidades y métricas aporta? ¿Frecuencia? |
| Acceso | ¿API oficial? ¿Requiere OAuth? ¿Exportación manual (CSV/JSON/ZIP)? ¿Cobertura para uso personal? **[P: siempre a verificar en la documentación oficial]** |
| Coste y límites | Precio, cuotas, rate limits |
| Autenticación y secretos | Dónde viven los tokens; caducidad y rotación |
| Riesgo | Datos sensibles; términos de uso; cambios de API |
| Calidad | Ruido, unidades, zonas horarias, duplicados |
| Valor | Qué decisión mejora; si ninguna, no se integra |

### 8.2 Escalera de integración (de menos a más compleja)

1. **Entrada manual guiada** (formulario/mensaje): coste 0, fiabilidad total, sirve para validar el modelo de datos.
2. **Importación de archivos** (CSV/JSON exportados por la app): sin credenciales; ideal para finanzas y para históricos.
3. **Webhook o endpoint de la fuente** hacia `ingest`: sin polling.
4. **Conector OAuth gestionado** (n8n o código propio): solo cuando 1–3 no bastan.
5. **Agregadores de terceros:** solo si hay evidencia de que compensan su coste y su exposición de datos **[P]**; para finanzas, nivel 3 por defecto.

**Regla:** cada fuente nueva es una *historia* con ficha, esquema de entrada, pruebas con datos de ejemplo y criterio de aceptación; no se integra "por si acaso".

### 8.3 Orden de adopción recomendado [H]

Entrada manual de peso, sueño, entrenos y comidas → importación de exportaciones de la app de entrenamiento/nutrición que uses → dispositivo wearable (si existe) → calendario → tareas → finanzas por CSV. El orden definitivo depende de la pregunta 1.

---

## 9. Estructura de repositorio y versionado

### 9.1 Estructura (monorepo, D-08) — propuesta, aún no creada

```
life-os/
├─ README.md
├─ docs/
│  ├─ adr/                    # decisiones de arquitectura (ADR-0001…)
│  ├─ spec/                   # esta especificación y sucesivas
│  ├─ runbooks/               # restauración, rotación de secretos, incidentes
│  └─ state/                  # STATE.md: decisiones, riesgos, tareas, estado real
├─ supabase/
│  ├─ migrations/             # SQL versionado, solo hacia delante
│  ├─ seed/                   # catálogos (metric_def, action_catalog)
│  ├─ functions/              # Edge Functions: ingest, compute, coordinator, executor
│  └─ tests/                  # pruebas de BD (RLS, constraints) con pgTAP [P]
├─ packages/
│  ├─ domain/                 # tipos, validaciones, cálculos puros (sin I/O)
│  ├─ contracts/              # JSON Schemas + tipos generados
│  └─ clients/                # cliente Claude, cliente BD
├─ agents/
│  ├─ coordinator/ {contract.yaml, prompt.md, evals/}
│  └─ health/      {contract.yaml, prompt.md, evals/}
├─ integrations/
│  └─ <fuente>/ {source-sheet.md, adapter/, fixtures/}
├─ workflows/                 # exportaciones de n8n, si se usa
├─ evals/                     # casos de evaluación y datos sintéticos
└─ .github/workflows/         # CI, backup lógico programado
```

Datos personales reales **nunca** en el repositorio (ni en fixtures): solo datos sintéticos.

### 9.2 Estrategia de versionado

| Artefacto | Esquema |
|---|---|
| Código | Trunk-based con ramas cortas y PR (aunque seas único usuario: la PR es el punto de CI y de revisión); commits convencionales |
| Migraciones | Numeradas/ordenadas, solo hacia delante; las correcciones son migraciones nuevas; cambios destructivos requieren ADR y backup previo |
| Contratos de agente y prompts | SemVer propio (`health@0.1.0`); cada `ops.run` guarda la versión usada; cambio de salida de esquema = *major* |
| Métodos de cálculo | `method_version` en cada métrica calculada para reproducir históricos |
| Workflows n8n | Export a `workflows/` en PR; **la edición Community no integra Git [V]**, por lo que el export será un paso manual/CI **[P: verificar CLI/API de export]** |
| Esquemas de entrada/salida | JSON Schema en `packages/contracts`, tipos TS generados |
| Estado del proyecto | `docs/state/STATE.md` versionado: objetivos, decisiones, pendientes, riesgos, tareas, estado real |

### 9.3 Entornos

Desarrollo local con la CLI de Supabase y una instancia local **[P: confirmar flujo exacto]** + un único proyecto de producción (Pro). Se evita pagar un segundo proyecto (desde 10 USD/mes **[V]**) hasta que el volumen de cambios lo justifique. Las migraciones se aplican a producción solo desde CI tras pasar pruebas.

### 9.4 Calidad (CI mínimo)

Comprobación de tipos, linter, pruebas unitarias de `domain`, validación de JSON Schemas, pruebas de BD (RLS: un rol sin permiso no puede escribir), análisis de secretos, y evaluaciones de agentes sobre casos sintéticos (umbral mínimo de `schema_valid_rate`).

---

## 10. Plan de implementación priorizado

Equivalencia con las fases de las instrucciones maestras: P0–P1 ≈ Fases 1–2; P2 ≈ Fase 3; P3–P4 ≈ Fase 4; P5 ≈ Fase 5; todas incluyen Fase 6 (pruebas); P8 ≈ Fase 7.

| Fase | Objetivo | Entregables | Criterios de aceptación | Depende de |
|---|---|---|---|---|
| **P0 Fundamentos** | Base técnica verificable | Repo, CI, proyecto Supabase, esquemas `ops`/`raw`, roles y RLS, `STATE.md`, ADR-0001 | Una migración se aplica solo desde CI; test de RLS demuestra que `agent_writer` no puede aprobar; secretos fuera del repo | D-01, D-02, D-08 |
| **P1 Columna de datos** | Registrar y consultar datos de salud con calidad y trazabilidad | `health.*` mínimo, `metric_def`, entrada manual guiada, `ingest` idempotente, dead_letter | Reenviar el mismo evento 2 veces no duplica; un valor fuera de rango plausible se rechaza; restauración de backup probada | P0, preguntas 1 y 4 |
| **P2 Primer valor** | Resumen diario/semanal de solo lectura | `compute` con 3–5 métricas, contrato `health` y `coordinator`, `ops.run` con coste, tope de gasto | Esquema de salida válido ≥95 % en casos sintéticos **[umbral H]**; toda `claim` de tipo `fact` cita datos; coste medido por run | P1 |
| **P3 Primera integración real** | Una fuente automatizada | Ficha de fuente, adaptador, decisión D-04 (n8n o código) con ejecuciones/mes medidas | Ingesta programada sin intervención durante 7 días; 0 duplicados; fallo simulado acaba en `dead_letter` | P1, pregunta 1 |
| **P4 Acciones y aprobaciones** | Propuestas y ejecución controlada | `action_catalog`, `approval`, `executor`, canal de aprobación (D-10) | Propuesta alterada tras aprobación no se ejecuta (hash); acción caducada no se ejecuta; todas las acciones auditadas | P2, preguntas 4 y 5 |
| **P5 Supervisión** | Ver el estado del sistema | Dashboard: KPIs, runs, errores, propuestas, coste | Abre en móvil; muestra la última ejecución y errores abiertos | P2 |
| **P6 Trabajo y calendario** | Detectar conflictos entre dominios | Agente `planner`, ingestión de tareas/calendario | Detecta un conflicto sintético trabajo vs entreno | P3, P4 |
| **P7 Finanzas (lectura)** | Visibilidad financiera | Importación CSV, categorías, presupuesto | Reconciliación de totales con el extracto; ninguna acción financiera habilitada | P1, D-09 |
| **P8 Optimización** | Mejora continua | Informe de calidad/coste, evaluaciones automáticas, revisión de prompts | Informe mensual de acierto, coste y errores | P2+ |

**Riesgo de alcance:** si la vida real te impide dedicar tiempo, el orden P0 → P1 → P2 ya entrega un sistema útil y completo por sí mismo. Las demás fases son opcionales y reordenables.

**Próxima acción concreta tras tu aprobación:** crear el repositorio privado (con tu autorización explícita), la estructura de §9 y ADR-0001 con las decisiones D-01…D-08. Hasta entonces no creo nada.

---

## 11. Riesgos principales y decisiones que requieren aprobación

### 11.1 Riesgos

| # | Riesgo | Prob. | Impacto | Control |
|---|---|---|---|---|
| R-01 | **Datos sensibles de salud/finanzas** enviados a terceros (Claude, Supabase, n8n) | Media | Alto | Minimización de campos, lista blanca por contrato, registro de qué se envía; **[P]** revisar políticas de retención y uso de datos de la API de Claude y de cada proveedor; elegir región de Supabase según tu jurisdicción (pregunta 2) |
| R-02 | Inyección de instrucciones vía contenido de terceros | Media | Alto | §7.6; separación de privilegios |
| R-03 | Plan gratuito de Supabase se pausa o pierde datos | Alta si se usa en producción | Alto | D-02 (Pro) |
| R-04 | Sobreingeniería: construir agentes antes de tener datos | Alta | Medio | Orden de fases; solo 2 agentes; calculadoras deterministas |
| R-05 | Dependencia de n8n sin Git/entornos | Media | Medio | n8n como adaptador mínimo; export a `workflows/` |
| R-06 | Coste de Claude descontrolado por bucles | Baja | Medio | Tope en código, Batch, modelos pequeños, alerta al 80 % |
| R-07 | Recomendaciones de salud percibidas como consejo médico | Media | Alto | Límites en contrato, escalado a profesional ante síntomas, etiquetado de incertidumbre |
| R-08 | Cambios o retirada de APIs de terceros | Media | Medio | Entrada manual y CSV como alternativa; adaptadores aislados |
| R-09 | Calidad de datos pobre (medición, zonas horarias, duplicados) | Alta | Medio | `quality`, rangos plausibles, validación, `supersedes_id` |
| R-10 | Pérdida de acceso/secretos comprometidos | Baja | Alto | Rotación, menor privilegio, gestor de secretos, 2FA en todas las cuentas |
| R-11 | Precios y límites de servicios cambian | Media | Bajo–Medio | Cifras marcadas [V] con fecha; revalidar antes de contratar |
| R-12 | Un solo punto de fallo humano (tú como único aprobador) | Media | Medio | Caducidad de propuestas, valores por defecto seguros (si no se aprueba, no se hace) |

### 11.2 Decisiones que necesito que apruebes

D-01 a D-10 de §1.2. Resumen de mi recomendación: **aprobar D-01, D-02, D-03, D-05, D-06, D-07, D-08, D-09; posponer D-04 hasta P3; D-10 depende de tu respuesta a la pregunta 4.**

---

## 12. Las cinco preguntas que más condicionan el diseño

1. **¿Qué fuentes y dispositivos usas hoy?** (reloj/anillo/báscula, app de entrenamiento, app de nutrición, calendario, gestor de tareas, banco/hojas de cálculo). Determina el orden de integración (§8), si hace falta n8n y el modelo de datos de `health`.
2. **¿Dónde resides y qué tolerancia tienes a enviar datos de salud y finanzas a servicios externos?** Condiciona la región de Supabase, el nivel de minimización/pseudonimización antes de llamar a Claude y qué finanzas se integran. Si estás en la UE, estos datos tienen un tratamiento regulatorio especial **[H: confirmar según tu caso]**.
3. **¿Cuál es tu techo mensual real?** Por ejemplo: 0 USD (prototipo sobre plan gratuito, con riesgos de §2.2), ~30 USD (Supabase Pro + Claude), o ~60 USD (con n8n Cloud). Decide D-02 y D-04.
4. **¿Por qué canal quieres capturar datos y aprobar acciones?** (app de mensajería, correo, PWA web, solo panel). Define D-10, la forma de autenticar aprobaciones y qué tan frecuente será la interacción.
5. **¿Qué acciones concretas estás dispuesto a que el sistema ejecute solo (nivel 2) y cuáles no?** (crear tareas, escribir en el calendario, enviar mensajes, cualquier operación financiera). Define el catálogo inicial de acciones y si finanzas permanece en solo lectura.

---

## Anexo A — Fuentes consultadas (2026-10-09)

| Dato | Fuente |
|---|---|
| Precios y límites de Supabase (Free/Pro, pausa, backups, Edge Functions incluidas) | https://supabase.com/pricing |
| Supabase Cron / `pg_cron` (SQL, HTTP, ≤8 trabajos concurrentes recomendados, <10 min por trabajo) | https://supabase.com/docs/guides/cron |
| Límites de Edge Functions (150 s / 400 s, 2 s CPU, 256 MB) | https://supabase.com/docs/guides/functions/limits |
| Precios de n8n Cloud, ejecuciones, Community autoalojado | https://n8n.io/pricing/ |
| Opciones de autoalojamiento de n8n | https://docs.n8n.io/hosting/ |
| Funciones por edición de n8n | https://docs.n8n.io/hosting/community-edition-features/ |
| Precios de Claude API, caché de prompts y Batch | https://platform.claude.com/docs/en/about-claude/pricing |

Los datos se obtuvieron mediante consulta automatizada de esas páginas y deben **revalidarse manualmente antes de contratar**. Las páginas de n8n no detallan la licencia de la edición Community ni sus condiciones para uso personal **[P]**.

## Anexo B — Pendiente de verificar [P] (lista consolidada)

1. Retención y uso de datos en la API de Claude para datos de salud/finanzas.
2. Licencia de n8n Community y condiciones de uso personal; exportación de workflows por CLI/API; seguridad de credenciales en Cloud Starter.
3. Límites de GitHub gratuito (repos privados, minutos de Actions).
4. Disponibilidad de `pgvector`, pgTAP y flujo de desarrollo local de la CLI de Supabase en el plan elegido.
5. Hosting gratuito/económico para un dashboard estático y su coste real.
6. Capacidades y condiciones de acceso a APIs de cada fuente concreta (tras la pregunta 1).
7. Mecanismo de claves de idempotencia en cada API de destino.
8. Si la actividad programada evita la pausa del plan gratuito de Supabase (no la he comprobado; no se debe confiar en ello).

## Anexo C — Estado real de ejecución

| Elemento | Estado |
|---|---|
| Esta especificación | Redactada (borrador v0.1) |
| Repositorio | **No creado** |
| Proyecto Supabase | **No creado** |
| Cuentas conectadas | **Ninguna** |
| Código, SQL, workflows | **No ejecutados ni probados**; el DDL de §5.4 es un esbozo |
| Acciones externas realizadas | **Ninguna** (solo lectura de páginas públicas de precios y documentación) |
