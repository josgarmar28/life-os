# LIFE OS — Adenda v0.2 a la especificación técnica

- **Modifica y complementa:** [SPEC-001 v0.1](SPEC-001-especificacion-tecnica-v0.1.md). Lo no mencionado aquí sigue vigente.
- **Fecha:** 2026-10-09
- **Motivo:** respuestas de martagon a las cinco preguntas de v0.1.
- **Estado:** diseño. **Nada está construido ni conectado.** No se ha creado repositorio, proyecto ni cuenta.
- **Etiquetas:** **[V]** verificado en fuente oficial hoy; **[S]** verificado solo en fuente secundaria (blog, prensa, repositorio de terceros); **[H]** hipótesis mía; **[P]** pendiente de verificar; **[U]** dato tuyo.

---

## 1. Qué has respondido y qué cambia

| # | Tu respuesta [U] | Impacto en el diseño |
|---|---|---|
| 1 | Reloj Amazfit con app Zepp. Báscula Xiaomi que no logras conectar a Zepp. Entrenamiento y nutrición: me los llevo yo (Claude). Entregarás equipamiento (marca, modelo, grupo muscular), medidas, fotos/vídeos para estimar % graso. Siempre supervisado por un profesional y/o por ti. Máxima evidencia científica actualizada. Calendario: Google Calendar. Banca: me das los datos tú, sin conectar nada. | Nueva capa de **evidencia** y de **equipamiento** (§5); fuente principal de salud es Zepp, con vías limitadas (§4); finanzas por entrega manual/CSV (D-09 confirmada); Calendar con permisos mínimos (§4.3). |
| 2 | Resides en Pully (Suiza); puedes enviar datos; gimnasio Elevate Gym; trabajas en Les Toises. | Marco legal suizo (§7); zona horaria `Europe/Zurich`, moneda CHF, unidades métricas; catálogo de equipamiento específico del gimnasio. |
| 3 | Poco gasto; el rendimiento de la app no importa mientras funcione y las decisiones sean óptimas. | Se puede priorizar calidad de razonamiento sobre latencia: Batch (−50 % [V]) para informes no urgentes y modelos de mayor calidad en decisiones de plan. Mantengo Supabase Pro como único gasto fijo recomendado. |
| 4 | No sabes el canal; quieres usar Claude, con una conversación o agente por tema si hace falta. | **Cambio de arquitectura importante (§3):** interfaz conversacional = la propia app de Claude mediante un conector propio; sin construir chat ni dashboard al principio. |
| 5 | Todas las acciones pasan por ti. Calendario, entrenamiento, dieta y hábitos: pueden modificarse **con tu aprobación**. | Se elimina el nivel 2 "autónomo" del arranque: **no habrá ninguna política de ejecución automática** (§6). |

---

## 2. Decisiones actualizadas

| ID | Estado | Decisión |
|---|---|---|
| D-09 | **Confirmada [U]** | Finanzas: sin conexiones a bancos. Solo datos que tú entregues (CSV/manual). Solo lectura. |
| D-07 | **Ajustada** | Niveles 0–3 se mantienen, pero **toda ejecución requiere aprobación por acción o por lote aprobado**. No se crea ninguna política de auto-ejecución (`ops.policy` vacía al inicio). Cambios de plan de salud llevan además la marca `needs_professional_review` según catálogo (§5.4). |
| D-10 | **Propuesta nueva** | Interfaz = **app de Claude + conector remoto MCP propio** (§3), más un canal de aviso para informes programados (por decidir, §10). Aprobaciones en una página web mínima con enlace de un solo uso, **no** dentro del chat (§3.3). |
| D-11 | **Propuesta nueva** | Un backend, varias "conversaciones por tema": Salud-entrenamiento, Nutrición/composición corporal, Trabajo-calendario, Finanzas, Arquitectura/Sistema. Cada una es un proyecto/chat de Claude con instrucciones propias que usa el mismo conector. Los permisos no dependen del chat: los aplica el servidor (§3.2). |
| D-12 | **Propuesta nueva** | Registro de **evidencia** con referencias verificables (DOI/PMID) como requisito para que una regla de planificación sea usada (§5.3). |
| D-13 | **Propuesta nueva** | Fotos y vídeos corporales: almacenamiento privado, retención corta del original, envío a Claude solo bajo petición, resultado siempre `estimated` con intervalo (§5.5). |

Las demás (D-01 a D-06, D-08) siguen igual; D-04 (n8n) sigue pospuesta: con Calendar y Zepp, ninguna fuente exige n8n todavía (§4).

---

## 3. Arquitectura revisada: dos superficies, un backend

### 3.1 Qué verifiqué

- **Conectores propios en Claude [V]:** la app admite *custom connectors* con MCP remoto; disponibles en Free (limitado a 1), Pro, Max, Team y Enterprise. El servidor debe ser **accesible públicamente desde internet** (conexión desde la nube de Anthropic). Autenticación por OAuth o por cabeceras fijas (clave/token). La página advierte de inyección de instrucciones por servidores no confiables y de que la función *Research* puede invocar herramientas del conector **sin aprobación adicional** (recomienda desactivar las herramientas que escriben). [support.claude.com, artículo 11175166]
- **Disponibilidad en móvil [P]:** la página no confirma que se pueda *añadir* un conector desde móvil; se puede añadir desde escritorio/web [H] y usarlo después. Comprobarlo con tu dispositivo.
- **Servidor MCP en Supabase [V]:** una Edge Function puede alojar un servidor MCP (transporte HTTP "streamable"); con usuarios, Supabase Auth actúa de servidor OAuth 2.1 y cada llamada corre **como tu usuario**, de modo que RLS aplica. Requisitos: habilitar servidor OAuth y registro dinámico de clientes, **alojar tú una pantalla de consentimiento** (Supabase no la aloja), claves JWT asimétricas, Supabase CLI reciente. Las Edge Functions son sin estado (sin "sampling"). [supabase.com/docs/guides/ai-tools/byo-mcp]
- **Plan de Claude que tienes [P]:** no sé si tienes Pro/Max. Condiciona cuánto uso conversacional te cubre tu suscripción (el uso en la app consume tu plan, no tokens de API [H]).

### 3.2 Diagrama

```
 SUPERFICIE INTERACTIVA                      SUPERFICIE PROGRAMADA
 App de Claude (chats por tema)              pg_cron → Edge Function coordinator
        │  conector MCP remoto (OAuth)              │  Claude API (contratos, esquemas)
        ▼                                           ▼
 ┌──────────────────── Edge Function "mcp" / "coordinator" ────────────────────┐
 │  Herramientas con permisos mínimos (misma capa para ambas superficies)     │
 │  LECTURA: métricas, plan vigente, historial   ESCRITURA: solo registrar    │
 │  datos y CREAR PROPUESTAS (nunca aprobar ni ejecutar)                      │
 └───────────────────────────────┬─────────────────────────────────────────────┘
                                 ▼
                    Supabase / PostgreSQL (RLS, auditoría, ops.*)
                                 ▲
        ┌────────────────────────┴───────────────────────┐
        │ Página de aprobación (enlace de un solo uso)   │──► executor ──► Google Calendar
        │ + autenticación fuerte (tu sesión Supabase)    │               (calendario LIFE OS)
        └────────────────────────────────────────────────┘
```

### 3.3 Reglas de seguridad de la nueva interfaz

1. **El modelo nunca aprueba.** Aunque el cliente pida confirmación de uso de herramientas, eso es una función del cliente, no una garantía del servidor. La aprobación se hace en una **página aparte**, con sesión tuya y con `proposal_id` + `payload_hash` visibles; el conector no expone ninguna herramienta de aprobación ni de ejecución.
2. **Herramientas de escritura mínimas:** `log_observation`, `log_meal`, `log_workout`, `create_proposal`. Todas pasan por validación de esquema, rangos plausibles e idempotencia. Sin SQL libre.
3. **Entradas no confiables:** el contenido que Claude lea del conector (notas, nombres de eventos de calendario, texto de documentos) puede contener instrucciones. Las herramientas devuelven datos delimitados y el servidor no concede más privilegios por texto del modelo. Un chat que lee eventos de calendario externos no obtiene herramientas de escritura más allá de `create_proposal`.
4. **Research y navegación web:** si activas funciones que invocan conectores sin pedir confirmación, las herramientas de escritura deben quedar desactivadas en ese chat [recomendación de la propia página, V].
5. **Auditoría:** cada llamada de herramienta registra `actor=claude_app`, chat/tema (si el cliente lo informa [P]), entrada, salida e idempotency key.
6. **Revocación:** registro de clientes OAuth revisable y revocable; rotación periódica.

### 3.4 Qué ganamos y qué cuesta

| | Efecto |
|---|---|
| **Ganancia** | Sin desarrollar chat ni dashboard al inicio; conversación natural por tema; menos código a mantener; coste de API solo para tareas programadas. |
| **Coste** | Dependes de la disponibilidad de conectores de Claude; los tokens de la conversación interactiva no pasan por tu control de presupuesto; **el agente "programado" y el "interactivo" son sistemas distintos** (el segundo no aplica los esquemas/contratos de salida de la API): la garantía de seguridad vive en las herramientas, no en el prompt. |
| **Alternativa descartada** | Bot de mensajería + app propia: más control y notificaciones push nativas, pero más código, más superficie de ataque y otro servicio. Reconsiderar si el conector no cubre tus necesidades. |
| **Pendiente** | Un canal de **aviso** para informes programados y recordatorios (correo es lo más simple y sin coste adicional [H]). Pregunta 4 en §10. |

---

## 4. Fuentes de datos (fichas)

### 4.1 Zepp / Amazfit (reloj)

| Aspecto | Hallazgo |
|---|---|
| API oficial para uso personal | **No encontré ninguna** en la búsqueda de hoy. Ausencia de resultado no prueba que no exista: **[P]** revisar la documentación oficial de Zepp. |
| Health Connect (Android) | Zepp lanzó (enero 2025) la sincronización con Health Connect: permite elegir tipos de datos (p. ej. frecuencia cardíaca, sueño, peso, presión arterial). Es **unidireccional**: Zepp solo *escribe* en Health Connect [S: Notebookcheck]. Un blog de terceros indica que no llegan a Health Connect PAI, planes de Zepp Coach, detalle de fases de sueño, trazas GPS completas ni estrés continuo, y que el histórico completo no está garantizado [S: FitMesh]. |
| iPhone | Health Connect es Android. Para iPhone, la cadena Zepp → Apple Health depende de lo que ofrezca la app iOS [S, sin detalle]. **Necesito saber qué móvil usas** (pregunta 1 de §10). |
| Exportación | Existe una exportación masiva en CSV desde la página de exportación de datos (GDPR) de Zepp; por actividad en FIT, una a una en la app [S: repositorio de terceros]. |
| Llamadas no oficiales | Hay herramientas que usan un *token* de sesión extraído del navegador. **No las recomiendo**: frágiles, contra los términos de servicio probablemente [H], y obligan a manejar una credencial sensible. |
| Agregadores comerciales (Thryve, Terra, etc.) | Existen [S], son servicios B2B de pago y mueven tus datos por un tercero más. **No recomendados** para este proyecto [H]. |

**Plan de fuente (escalera):**
1. **P1:** entrada manual (peso, sueño percibido, entreno) + **importación de CSV** de la exportación de Zepp, a mano cada cierto tiempo. Cero credenciales.
2. **Después, si usas Android:** probar Health Connect → una app puente que exporte a un archivo o endpoint tuyo. Requiere una app en el móvil (existente o propia) **[P: no he evaluado ninguna]** y es otro punto de privacidad.
3. Reevaluar si Zepp publica una API personal.

### 4.2 Báscula Xiaomi

Falta el **modelo** y la app con la que sincroniza (Xiaomi suele usar su propia app, y según la región/modelo puede ser Mi Fitness o Zepp Life; **[P]**, no lo he verificado). Un blog de terceros indica que Mi Fitness también escribe en Health Connect en Android [S]. Mientras tanto: **peso manual** con protocolo fijo (misma hora, tras ir al baño, en ayunas). La grasa que mide una báscula de bioimpedancia es una estimación sensible a la hidratación; se guarda como `estimated` y se usa solo para tendencia **[H, práctica común]**.

### 4.3 Google Calendar

Alcances de la API [V: developers.google.com, hoy]: `calendar.events.owned.readonly` (leer eventos de calendarios propios), `calendar.events.owned` (crear/modificar/borrar eventos de calendarios propios), `calendar.app.created` (crear calendarios secundarios y gestionar eventos **solo en ellos**), `calendar.freebusy` (solo disponibilidad). La página recomienda el alcance más estrecho posible.

**Diseño de mínimo privilegio [H]:**
- **Lectura:** `calendar.events.owned.readonly` (o `freebusy` si basta con disponibilidad; así el sistema no lee títulos de eventos laborales).
- **Escritura:** `calendar.app.created` → el sistema crea un **calendario secundario "LIFE OS"** y solo puede tocar eventos ahí; **nunca** toca tus eventos del calendario principal. Tú ves ambos superpuestos en la app de Calendar.
- Toda escritura = acción aprobada (§6), con `idempotency_key` y `extendedProperties` para correlacionar el evento con la propuesta **[P: confirmar campo de la API]**.
- **[P]** Comportamiento de caducidad de tokens de OAuth en aplicaciones en modo de pruebas (puede obligar a reautorizar cada pocos días); **[P]** si tu cuenta es personal o de Workspace (un administrador puede bloquear aplicaciones OAuth). Ver pregunta 3 de §10.
- **Privacidad laboral [H]:** los títulos de eventos de trabajo pueden contener información confidencial de tu empleador; se recomienda leer solo disponibilidad o filtrar por etiquetas. Decisión tuya.

### 4.4 Finanzas

Sin conexiones [U]. Entrega por CSV/hoja o manual; categorización asistida; pseudonimización antes de enviar a Claude (sin IBAN ni números de cuenta, nombres de comercio genéricos si procede). Solo lectura y propuestas. Nada de nivel 3 financiero habilitado.

---

## 5. Salud: entrenamiento, nutrición y composición corporal

### 5.1 Rol del sistema y límites

Claude diseña y razona; el **código** calcula y valida; tú y/o un profesional decidís. El contrato del agente mantiene: sin diagnóstico, sin indicación de medicación, escalado a profesional ante síntomas o valores fuera de rango. "Máximo rendimiento y salud" se interpreta como **objetivos medibles con restricciones de seguridad**, no como maximización sin límite; necesito tus objetivos concretos (plantilla de datos de partida).

### 5.2 Equipamiento del gimnasio (Elevate Gym)

Tabla `training.equipment` (marca, modelo, tipo, rango de carga, incrementos, grupos musculares primarios/secundarios, notas de ajuste) y `training.exercise` enlazada a equipamiento y músculos. Tú entregas la lista; no la invento ni asumo qué máquinas tiene Elevate Gym. El planificador solo propone ejercicios cuyo equipamiento figure en el catálogo. **[P]** si se pueden obtener los datos de fabricantes de forma legítima; mejor tu lista o fotos de las placas de cada máquina.

### 5.3 Capa de evidencia (D-12)

Para que "máxima evidencia científica y actualizada" no sea un eslogan:

- `knowledge.evidence_rule`: regla (p. ej. rango de volumen semanal por grupo muscular, criterio de progresión, proteína por kg, límites de déficit), su **fuente** (DOI/PMID), tipo de estudio, nivel de evidencia, población, fecha de revisión, versión y estado (`proposed/approved/retired`).
- El planificador determinista y los agentes solo usan reglas `approved`; cada recomendación cita `rule_id`.
- **Revisión periódica:** una tarea programada (con búsqueda web o bibliográfica si la API de Claude la ofrece **[P: disponibilidad y coste de herramienta de búsqueda web]**) propone cambios de reglas como *propuestas* con enlaces. Una referencia solo se acepta si su DOI/PMID se resuelve contra una base pública **[P: p. ej. PubMed/Crossref; verificar acceso y límites]**, para evitar citas inventadas por el modelo.
- **Honestidad epistemológica:** cuando la evidencia es débil o contradictoria, la salida lo dice (`confidence`, `data_gaps`). La regla no se "inventa" para completar un plan.
- Aprobación de reglas nuevas: tú y/o tu profesional. Un cambio de regla es una acción con aprobación como las demás.

### 5.4 Catálogo de acciones de salud y supervisión profesional

| Acción | Nivel | Aprobación | `needs_professional_review` |
|---|---|---|---|
| Registrar datos (peso, comida, entreno) | 1 | Tu captura | No |
| Proponer ajuste de entrenamiento (volumen, ejercicios, progresión) | 2 | Tú | Según regla (p. ej. lesión o dolor) |
| Proponer cambio de dieta (calorías, macros, ayunos, suplementos) | 2 | Tú | **Sí** si supera umbrales definidos con tu profesional [umbrales: pendientes] |
| Cambio de hábitos (sueño, rutinas) | 2 | Tú | No |
| Crear/modificar evento en calendario LIFE OS | 2 | Tú (individual o lote) | No |
| Cualquier acción con síntomas o valores fuera de rango | 3 | Tú + profesional | Sí |

Para tu profesional, el sistema generará un **informe exportable** (resumen, datos, plan vigente, cambios propuestos y motivos con referencias). Quién es ese profesional y cómo recibirá los informes: pregunta en §10.

### 5.5 Fotos, vídeos y % graso (D-13)

- Las imágenes del cuerpo son datos de salud muy sensibles. Bucket **privado** en Supabase Storage con URLs firmadas; almacenamiento incluido: 1 GB (Free) / 100 GB (Pro) [V].
- El original se conserva el tiempo mínimo necesario (propuesta: eliminar a los 30 días tras extraer medidas, tú decides) **[H]**; se guarda el resultado.
- Se envían a Claude **solo cuando lo pides**, directamente en la petición (no mediante almacenamiento persistente de la API: la API de Archivos conserva ficheros hasta que se borren y **no** es compatible con retención cero [V]).
- **Fiabilidad:** la estimación visual del % graso por IA tiene error considerable [H, conocimiento general; no he consultado literatura en esta sesión **[P]**]. Se registra como `estimated` con **intervalo** y método, nunca como medición; se usa para tendencias con fotos estandarizadas (misma luz, pose, distancia, hora). Para anclar, convendría una medición de referencia por un profesional de vez en cuando.
- Las medidas corporales (cintura, etc.) sí son `manual`/`measured` con protocolo estándar.

### 5.6 Nutrición

`nutrition.food` necesita una fuente de composición nutricional. **[P]** evaluar bases públicas (por ejemplo la suiza de composición de alimentos y bases abiertas) y sus licencias; hasta entonces las comidas se guardan con cantidades y valores estimados marcados como tales. El plan de alimentación sale de reglas aprobadas (§5.3), objetivos, preferencias, alergias/intolerancias y restricciones que me des, y pasa por la marca de revisión profesional (§5.4).

---

## 6. Permisos revisados (cambios respecto a v0.1 §7)

- `ops.policy` **vacía**: ninguna acción se ejecuta sin aprobación.
- **Lote aprobado:** puedes aprobar de una vez "plan de la semana" (varios eventos) con `batch_id`; cada elemento mantiene su hash e idempotencia.
- **Caducidad:** propuestas caducan (propuesta: 72 h para calendario, 7 días para cambios de plan); caducar = no hacer nada.
- **Aprobador:** tú. Si en el futuro quieres que tu profesional apruebe ciertos cambios, `approval.approver_role` ya lo contempla.
- Niveles 0–3 se mantienen como clasificación de riesgo; la diferencia práctica entre 2 y 3 es la confirmación reforzada y, en 3, el requisito de revisión profesional/espera.

---

## 7. Privacidad en Suiza y tratamiento por Claude

### 7.1 Verificado hoy

| Tema | Hallazgo |
|---|---|
| Retención de la API de Claude [V] | La política de retención de datos comerciales indica que entradas y salidas se **borran del backend en un plazo de 30 días**, con excepciones (acuerdos de retención cero, cumplimiento de la política de uso, requisitos legales; hasta 2 años si hay infracciones de la política de uso). La página de documentación de la API afirma que el contenido "no se conserva por defecto" salvo excepciones; las dos formulaciones no coinciden del todo: **asumo 30 días como caso conservador y [P] confirmo con Anthropic.** |
| Entrenamiento [V] | Por defecto, Anthropic no usa entradas ni salidas de sus productos comerciales (incluida la API) para entrenar, salvo que lo permitas o envíes feedback. |
| Retención cero [V] | Se activa por organización contactando con ventas; no cubre la consola ni los productos de consumo; Batch tiene retención de 29 días y la API de Archivos no es compatible. |
| Modelos "Covered" [V] | **Fable 5.1** requiere retención de 30 días y no está disponible con retención cero salvo autorización. |
| Normativa suiza [S] | La nueva Ley Federal de Protección de Datos (nLPD/nFADP) entró en vigor el **1 de septiembre de 2023**. Las transferencias a terceros países se limitan a países con protección adecuada o con garantías. El marco **Swiss–US Data Privacy Framework** fue reconocido por el Consejo Federal el **14 de agosto de 2024** para receptores de EE. UU. certificados (certificación específica para datos suizos). |
| Datos sensibles [H] | Los datos de salud se consideran datos personales sensibles bajo la nLPD (conocimiento general mío; no verificado en fuente primaria hoy). |

### 7.2 Pendiente [P]

1. Comprobar en la lista oficial del Data Privacy Framework si **Anthropic**, **Supabase**, **Google** y cualquier otro proveedor están certificados para datos suizos; o qué garantías contractuales ofrecen (cláusulas tipo).
2. Región de Supabase: elegir una región **europea**; comprobar cuáles ofrece **[P]** (¿incluye Suiza?).
3. Para un uso estrictamente personal, tú eres a la vez titular y responsable; las obligaciones formales de un responsable de tratamiento (registro, evaluación de impacto) son menores o no aplican [H]. Esto **no es asesoramiento jurídico**; si en el futuro compartes datos con un profesional, conviene que ese circuito esté claro.

### 7.3 Políticas derivadas

- Modelo para datos con foto o información muy sensible: **Sonnet 5.5 / Opus 5.5** (sin la restricción de modelos "Covered") **[H]**; evitar Fable 5.1 salvo necesidad y consentimiento expreso de su retención de 30 días.
- Minimización: campos por lista blanca; sin nombre completo, dirección ni identificadores bancarios en los prompts.
- Registro `ops.data_disclosure`: qué datos, a qué proveedor, cuándo y bajo qué `run_id`.
- Derecho a exportar/borrar tus datos: función `export_all` y `erase_range` (con aprobación) desde P1.

---

## 8. Cambios en el modelo de datos

Añadir a v0.1 §5:

| Esquema | Nuevas entidades |
|---|---|
| `training` | `equipment`, `exercise`, `muscle_group`, `exercise_muscle`, `program`, `program_week`, `planned_session`, `performed_session`, `performed_set` (carga, repeticiones, RIR/RPE, tempo opcional) |
| `nutrition` | `food`, `recipe`, `meal_plan`, `meal`, `meal_item`, `supplement` (solo registro de lo que tú declares) |
| `body` | `measurement_protocol`, `body_measurement` (cintura, pecho, etc. con protocolo), `media_asset` (referencia a Storage, retención), `composition_estimate` (método, valor, intervalo, `quality=estimated`) |
| `knowledge` | `evidence_rule`, `evidence_source` (DOI/PMID verificado), `rule_review` |
| `ops` | `batch` (lotes de aprobación), `data_disclosure`, `tool_call_log` |

Convenciones nuevas: `quality ∈ {measured, manual, estimated}`; las estimaciones llevan `uncertainty` (intervalo o desviación) y `method_version`; `supersedes_id` en correcciones; zona horaria local `Europe/Zurich` para eventos de sueño y comidas.

---

## 9. Plan revisado de las primeras fases

| Fase | Entregables concretos | Criterios de aceptación |
|---|---|---|
| **P0 Fundamentos** (necesita tu autorización para crear repo y proyecto) | Repo privado, CI, proyecto Supabase en región europea, esquemas `ops/raw/health/training/nutrition/body/knowledge`, roles y RLS, ADR-0001 con D-01…D-13 | Test de RLS: rol de agente no puede aprobar ni ejecutar; migraciones solo desde CI; secretos fuera del repo |
| **P1 Datos y perfil** | Plantilla de datos de partida cargada; entrada manual de peso/medidas/entreno/comida; importación del CSV de Zepp; `equipment` de Elevate Gym; backups con restauración probada | Reimportar el mismo CSV no duplica; datos fuera de rango rechazados; restauración probada |
| **P2 Servidor MCP + primer informe** | Conector con herramientas de lectura/registro/propuesta; página de aprobación; informe semanal de salud de solo lectura con métricas deterministas | Desde la app de Claude: registrar un entreno y consultar tendencias; una propuesta alterada tras aprobarla no se ejecuta; toda llamada queda auditada |
| **P3 Plan de entrenamiento v1** | `evidence_rule` aprobadas (primer lote), planificador con restricciones (equipamiento, días, lesiones), propuesta de programa | Cada recomendación cita `rule_id` con fuente verificada; tu revisión/aprobación; plan pasa a calendario LIFE OS solo con aprobación |
| **P4 Nutrición v1** | Objetivos, plan de alimentación, registro de comidas, informe para profesional | Cambios por encima de umbrales requieren marca profesional; informe exportable |
| **P5 Calendar** | Lectura mínima + calendario LIFE OS | Eventos creados solo en calendario secundario; idempotentes |

El orden P3/P4 puede invertirse según qué te importe más ahora.

---

## 10. Riesgos nuevos y preguntas restantes

### 10.1 Riesgos nuevos

| # | Riesgo | Control |
|---|---|---|
| R-13 | Dependencia de datos de Zepp con vías limitadas y manuales | Escalera de integración; el sistema es útil con entrada manual |
| R-14 | Un chat de Claude con herramientas de escritura leyendo contenido no confiable | Herramientas de escritura mínimas; aprobación fuera del chat; desactivar escritura en funciones tipo Research |
| R-15 | Fotos corporales: exposición y mal uso | Bucket privado, retención corta, envío bajo petición, no usar APIs con almacenamiento persistente |
| R-16 | Estimaciones (% graso por foto o báscula) tratadas como mediciones | `estimated` + intervalo; solo tendencias |
| R-17 | Citas científicas inventadas por el modelo | Registro de evidencia con DOI/PMID resuelto por código; reglas solo `approved` |
| R-18 | Los chats interactivos escapan a los esquemas y límites de coste de la API | Seguridad en herramientas (servidor); coste interactivo = tu plan; tope en API programada |
| R-19 | Reautorizaciones de Google (modo pruebas) o bloqueo por Workspace | Verificar antes de P5 |
| R-20 | Exceso de confianza en "máxima evidencia" sin supervisión | Reglas versionadas, revisión humana/profesional, `confidence` y `data_gaps` obligatorios |

### 10.2 Preguntas que siguen condicionando el diseño

1. **¿Qué móvil usas (Android o iPhone)** y qué **modelo de báscula Xiaomi** y app usas con ella? Define la vía del reloj/báscula.
2. **¿Qué plan de Claude tienes** (Free/Pro/Max)? Determina si el conector cubre tu uso interactivo y los límites de conectores personalizados.
3. **¿Tu Google Calendar es personal (Gmail) o de Workspace/empresa?** ¿Quieres que el sistema lea los títulos de tus eventos laborales o solo tu disponibilidad?
4. **¿Qué canal quieres para avisos y resúmenes programados?** (Correo es lo más simple y barato [H]; otras opciones añaden un servicio.) ¿Con qué frecuencia: diario, semanal, solo cuando hay algo accionable?
5. **¿Quién es el profesional que supervisa** (médico, dietista, entrenador), qué decisiones debe ver y cómo prefiere recibir información (informe PDF/Markdown, hoja compartida)? Define los umbrales de `needs_professional_review`.
6. **Tus objetivos y restricciones de salud** (ver plantilla): objetivo principal y plazo, experiencia de entrenamiento, días/horas disponibles, lesiones, alergias, condiciones médicas relevantes que quieras que el sistema tenga en cuenta. Lo que no me des, no lo asumo.
7. **¿Autorizas ya la creación del repositorio privado y el proyecto de Supabase** (en región europea) para empezar P0? Hasta tu "sí" explícito no creo nada.

---

## Anexo A — Fuentes consultadas hoy (2026-10-09)

| Dato | Fuente | Tipo |
|---|---|---|
| Custom connectors / MCP remoto en Claude | https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp | Oficial |
| Servidor MCP en Edge Functions de Supabase | https://supabase.com/docs/guides/ai-tools/byo-mcp | Oficial |
| Alcances de Google Calendar API | https://developers.google.com/workspace/calendar/api/auth | Oficial |
| Retención de datos de la API de Claude | https://platform.claude.com/docs/en/manage-claude/api-and-data-retention y https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data | Oficial |
| No uso para entrenamiento por defecto | https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training | Oficial |
| Zepp → Health Connect (ene. 2025) | https://www.notebookcheck.net/Amazfit-smartwatches-get-new-Health-Connect-data-sync-feature.951489.0.html | Secundaria |
| Qué datos de Zepp/Xiaomi llegan a Health Connect | https://www.fitmesh.fit/en/blog/xiaomi-amazfit-health-connect-data-dashboard | Secundaria (comercial) |
| Exportación de Zepp (CSV, FIT; API no oficial) | https://github.com/H3llK33p3r/zepp-fit-extractor | Secundaria (terceros) |
| nLPD y transferencias | https://www.reedsmith.com/our-insights/blogs/technology-law-dispatch/102k322/swiss-authoritys-summary-of-its-gdpr-like-revised-federal-law/ | Secundaria |
| Swiss–US Data Privacy Framework (14-08-2024) | https://globallawexperts.com/swissus-data-privacy-framework-compliance-2026/ | Secundaria |

No he podido consultar la página del Comisionado Federal suizo (error de acceso); el marco legal debe contrastarse con fuentes primarias antes de basar decisiones en él.

## Anexo B — Estado real

| Elemento | Estado |
|---|---|
| Esta adenda | Redactada |
| Repositorio, proyecto Supabase, cuentas, conectores | **No creados / no conectados** |
| Código, SQL, MCP, workflows | **No existen** |
| Acciones externas | **Ninguna** (solo lectura de páginas públicas) |

---

## 11. Ronda 2 de respuestas (2026-10-09, 07:33 UTC)

### 11.1 Datos nuevos [U]

| Pregunta | Respuesta |
|---|---|
| Móvil | iPhone |
| Báscula | Xiaomi Smart Scale S200, sin app instalada por ahora |
| Plan de Claude | Pro |
| Google Calendar | Cuenta personal; **se permite leer los eventos completos** (la semana ya está organizada y se quiere optimizar) |
| Avisos | Pregunta: ¿notificación de Claude o correo (más barato)? |
| Informes para profesional | No hacen falta; el usuario transmite la información |
| Datos de partida | Los contestará él; no se asume nada |
| Repositorio y proyecto | **Autorizada** su creación |

### 11.2 Hallazgos verificados hoy

| Hallazgo | Fuente | Efecto |
|---|---|---|
| **S200 solo funciona con la app Xiaomi Home / Mi Home**; la ficha oficial indica que "no puede vincularse a otras apps como Mi Fitness y Zepp Life". Eso explica que no se conecte a Zepp. | Páginas oficiales de Xiaomi (mi.com, ficha del producto y FAQ de emparejamiento) **[V]** | No hay vía oficial documentada hacia Zepp, Apple Health ni Health Connect. Peso: **entrada manual** (o capturarlo desde la app Xiaomi Home y teclearlo). |
| La ficha oficial de la S200 lista peso, IMC, peso estándar, test de equilibrio y tendencias; **no lista grasa corporal ni masa muscular** y no indica tecnología de medición. | mi.com **[V]**; [P] confirmar en las especificaciones completas | No se espera % graso fiable de esta báscula. La composición corporal se estima por medidas, fotos (siempre `estimated`) y, si se quiere, mediciones profesionales puntuales. |
| iPhone: Health Connect no existe en iOS. | Fuente secundaria **[S]** | La vía "Zepp → Health Connect" de §4.1 **no aplica**. Quedan: CSV de Zepp, entrada manual y, **[P]**, lo que ofrezca la app Zepp para Apple Health. |
| **Routines de Claude (vista previa de investigación)**: tareas programadas que se ejecutan en la nube de Anthropic, disponibles en Pro, **pueden usar tus conectores**, intervalo mínimo 1 hora, consumen el uso de tu suscripción, no coste de API aparte. Su documentación no describe notificaciones push; cada ejecución aparece como una sesión en tu cuenta. | code.claude.com/docs/en/routines **[V]** | Los informes programados pueden ser un **routine que llama al conector LIFE OS**, sin API de Claude. Pendiente **[P]** si avisan al iPhone. Rutinas necesitan un repositorio para clonar. |
| GitHub: la sesión no tiene cuenta de GitHub enlazada; no puedo listar ni crear repositorios. | Herramientas de la sesión | El repositorio lo crea el usuario (vacío, privado) y yo lo adjunto (§11.4). |

### 11.3 Avisos: respuesta y decisión propuesta (D-14)

- **Correo:** barato y fiable. Coste: 0 si no se usa un servicio de envío; un servicio de envío tendría su propio plan **[P: no verificado]**.
- **Notificación de Claude:** no he podido verificar que los routines o el conector envíen notificaciones push al iPhone. Lo verificable hoy es que cada ejecución programada genera una **sesión** visible en tu cuenta.
- **Propuesta:** diseñar un adaptador de avisos intercambiable. Empezar sin servicio extra: el routine semanal/diario genera su informe como sesión en tu cuenta; cuando quieras un aviso activo, añadimos correo. Decisión definitiva tras probar si la notificación del routine llega al iPhone en P2.

### 11.4 Lo que pasa a continuación (P0)

1. **Tú:** crear en GitHub un repositorio **privado y vacío** (nombre sugerido: `life-os`) y decirme `propietario/nombre`. Si GitHub no está enlazado con tu cuenta de Claude, hay que enlazarlo desde claude.ai/connect-github y comprobar que la app de Claude tiene acceso a ese repositorio.
2. **Yo:** adjunto el repositorio, creo la estructura de §9 de SPEC-001, ADR-0001 con D-01…D-14 y las migraciones iniciales (esquemas, roles, RLS) con sus pruebas. Todo en una rama y pull request para tu revisión.
3. **Tú, en tu cuenta de Supabase:** crear un proyecto en región europea. No me compartas contraseñas ni claves en el chat. Las claves van a los secretos de GitHub Actions que configuras tú. Propuesta de coste: empezar en plan gratuito mientras solo haya esquema y datos sintéticos, y **pasar a Pro antes de cargar datos reales** **[P: confirmar que se puede subir de plan sin recrear el proyecto]**.
4. Las migraciones solo se aplican a Supabase desde CI tras tu aprobación del pull request. No tengo, ni pido, acceso directo a tu Supabase.

Quedan sin resolver: datos de partida (plantilla), y el orden P3/P4 (entrenamiento antes que nutrición o al revés).
