-- LIFE OS · Áreas, formularios y campos iniciales del dashboard.
--
-- Solo ESTRUCTURA (cuestionarios), nunca datos personales. Idempotente: no toca
-- áreas, formularios ni campos que ya existan (por slug/clave), así que los cambios
-- que hagas desde el dashboard se respetan. Lo ejecuta el workflow "bootstrap".
-- Fuentes: sueno/06 (registro de mañana y WHO-5), entrenamiento/06 (registro por
-- serie y cuestionario), entrenamiento/04 (cardio X/S), finanzas/02 §4.
-- Las fotos corporales y de pelo NO entran nunca en el dashboard.

do $seed$
declare
  v_seed jsonb := $json$
[
 {"slug":"sueno","name":"Sueño","icon":"🌙","sort":10,"description":"Registro de mañana y bienestar. 5 = mejor salvo agujetas (0 = ninguna).",
  "forms":[
   {"slug":"manana","name":"Registro de mañana","cadence":"daily","sort":10,"description":"Al despertar, ≈45 s. Mejor incompleto que nada: solo la calidad es obligatoria.",
    "fields":[
     {"key":"luz_apagada","label":"Hora a la que apagaste la luz","type":"time"},
     {"key":"latencia_larga","label":"¿Tardaste más de 30 min en dormirte?","type":"boolean"},
     {"key":"despertares","label":"Despertares","type":"integer","min":0,"max":30},
     {"key":"min_despierto","label":"Minutos despierto en total","type":"choice","options":[{"value":"0","label":"0"},{"value":"lt10","label":"<10"},{"value":"10_30","label":"10-30"},{"value":"gt30","label":">30"}]},
     {"key":"calidad","label":"Calidad del sueño","type":"scale","min":1,"max":5,"required":true,"overview":true},
     {"key":"zepp_duracion","label":"Zepp: duración","type":"duration","unit":"min","min":0,"max":960,"help":"En minutos (7 h 40 = 460)","overview":true},
     {"key":"zepp_inicio","label":"Zepp: inicio","type":"time"},
     {"key":"zepp_fin","label":"Zepp: fin","type":"time"},
     {"key":"zepp_puntuacion","label":"Zepp: puntuación","type":"integer","min":0,"max":100},
     {"key":"fc_reposo","label":"FC en reposo nocturna","type":"integer","unit":"lpm","min":25,"max":140},
     {"key":"energia","label":"Energía","type":"scale","min":1,"max":5,"overview":true},
     {"key":"agujetas","label":"Agujetas","type":"scale","min":0,"max":5,"help":"0 = ninguna"},
     {"key":"motivacion","label":"Motivación","type":"scale","min":1,"max":5},
     {"key":"estres","label":"Estrés","type":"scale","min":1,"max":5,"help":"5 = sin estrés, 1 = mucho","overview":true},
     {"key":"animo","label":"Ánimo","type":"scale","min":1,"max":5,"overview":true},
     {"key":"fuente_estres","label":"Fuente del estrés (si es ≤2)","type":"multi","options":[{"value":"trabajo","label":"Trabajo"},{"value":"piso","label":"Piso"},{"value":"relacion","label":"Relación"},{"value":"salud","label":"Salud"},{"value":"dinero","label":"Dinero"},{"value":"otro","label":"Otro"}]},
     {"key":"etiquetas","label":"Algo distinto","type":"multi","options":[{"value":"ruido","label":"Ruido"},{"value":"luz","label":"Luz"},{"value":"pantalla","label":"Llamada o pantalla tarde"},{"value":"hambre","label":"Hambre"},{"value":"bano","label":"Baño"},{"value":"enfermedad","label":"Enfermedad"},{"value":"viaje","label":"Viaje"},{"value":"siesta","label":"Siesta"},{"value":"cafeina","label":"Cafeína distinta"},{"value":"atipico","label":"Día atípico"}]},
     {"key":"notas","label":"Notas","type":"text","help":"Fuente y hora de ruido o luz, libido u otras sensaciones"}
    ]},
   {"slug":"who5","name":"WHO-5 (cada dos domingos)","cadence":"biweekly","sort":20,"description":"Últimas 2 semanas. 0 = nunca, 5 = todo el tiempo. Traducción por cotejar con la versión oficial.",
    "fields":[
     {"key":"alegre","label":"Me he sentido alegre y de buen humor","type":"scale","min":0,"max":5,"required":true},
     {"key":"tranquilo","label":"Me he sentido tranquilo y relajado","type":"scale","min":0,"max":5,"required":true},
     {"key":"activo","label":"Me he sentido activo y enérgico","type":"scale","min":0,"max":5,"required":true},
     {"key":"descansado","label":"Me he despertado fresco y descansado","type":"scale","min":0,"max":5,"required":true},
     {"key":"interes","label":"Mi vida diaria ha estado llena de cosas que me interesan","type":"scale","min":0,"max":5,"required":true},
     {"key":"semana","label":"Qué ha ido mejor y peor","type":"text"}
    ]}
  ]},
 {"slug":"entreno","name":"Entrenamiento","icon":"🏋️","sort":20,"description":"Pesas por serie y cardio. Registro por serie según entrenamiento/06.",
  "forms":[
   {"slug":"sesion","name":"Sesión de pesas","cadence":"per_session","sort":10,"description":"Cuestionario de 30 s antes de entrenar y una fila por serie.",
    "fields":[
     {"key":"pre_sueno","label":"Antes: sueño","type":"scale","min":1,"max":5},
     {"key":"pre_estres","label":"Antes: estrés (5 = sin estrés)","type":"scale","min":1,"max":5},
     {"key":"pre_dolor","label":"Antes: dolor muscular (5 = ninguno)","type":"scale","min":1,"max":5},
     {"key":"pre_energia","label":"Antes: energía","type":"scale","min":1,"max":5},
     {"key":"pre_motivacion","label":"Antes: motivación","type":"scale","min":1,"max":5},
     {"key":"inicio","label":"Hora de inicio","type":"time"},
     {"key":"fin","label":"Hora de fin","type":"time"},
     {"key":"series","label":"Series","type":"table","columns":[
       {"key":"ejercicio","label":"Ejercicio","type":"text","required":true},
       {"key":"maquina","label":"Máquina","type":"text"},
       {"key":"ajuste","label":"Ajuste","type":"text"},
       {"key":"carga_kg","label":"Carga","type":"number","unit":"kg","min":0,"max":1000},
       {"key":"perfil","label":"Perfil","type":"text"},
       {"key":"reps","label":"Reps","type":"integer","min":0,"max":200},
       {"key":"rir","label":"RIR","type":"integer","min":0,"max":10},
       {"key":"lado","label":"Lado","type":"choice","options":[{"value":"ambos","label":"Ambos"},{"value":"izq","label":"Izq."},{"value":"der","label":"Der."}]},
       {"key":"molestia","label":"Molestia 0-10","type":"integer","min":0,"max":10},
       {"key":"zona","label":"Zona de la molestia","type":"text"}
     ]},
     {"key":"observaciones","label":"Observaciones","type":"text"}
    ]},
   {"slug":"cardio","name":"Cardio, abdomen y movilidad","cadence":"per_session","sort":20,"description":"Días X y S: airbike, abdomen después y movilidad.",
    "fields":[
     {"key":"tipo","label":"Tipo","type":"choice","required":true,"options":[{"value":"airbike","label":"Airbike"},{"value":"paseo","label":"Paseo"},{"value":"otro","label":"Otro"}]},
     {"key":"duracion","label":"Duración","type":"duration","unit":"min","min":0,"max":600,"overview":true},
     {"key":"esfuerzo","label":"Esfuerzo percibido (RPE)","type":"scale","min":1,"max":10},
     {"key":"abdomen_series","label":"Series de abdomen","type":"integer","min":0,"max":30},
     {"key":"movilidad","label":"Movilidad hecha","type":"boolean"},
     {"key":"notas","label":"Notas","type":"text"}
    ]},
   {"slug":"maquina","name":"Catálogo de máquinas","cadence":"free","sort":30,"description":"Una entrada por máquina de Elevate Gym (catálogo; para el registro por serie).",
    "fields":[
     {"key":"nombre","label":"Nombre","type":"text","required":true},
     {"key":"marca_modelo","label":"Marca y modelo","type":"text"},
     {"key":"zona","label":"Zona","type":"choice","options":[{"value":"torso","label":"Torso"},{"value":"pierna","label":"Pierna"},{"value":"core","label":"Core"}]},
     {"key":"carga","label":"Tipo de carga","type":"choice","options":[{"value":"discos","label":"Discos"},{"value":"placas","label":"Placas (selector)"},{"value":"polea","label":"Polea"},{"value":"libre","label":"Peso libre"}]},
     {"key":"musculos","label":"Músculos","type":"text"},
     {"key":"notas","label":"Notas (ajustes, asiento, sensaciones)","type":"text"}
    ]}
  ]},
 {"slug":"cuerpo","name":"Cuerpo","icon":"📏","sort":30,"description":"Peso y cinta. Se decide con la media de 7 días. Las fotos NO van aquí.",
  "forms":[
   {"slug":"peso","name":"Peso","cadence":"daily","sort":10,"description":"Mañana, en ayunas, tras ir al baño.",
    "fields":[
     {"key":"peso","label":"Peso","type":"number","unit":"kg","min":20,"max":400,"step":0.1,"required":true,"overview":true},
     {"key":"condiciones","label":"En ayunas y tras el baño","type":"boolean"}
    ]},
   {"slug":"cinta","name":"Medidas con cinta","cadence":"weekly","sort":20,"description":"Mismo día y condiciones; media de dos mediciones por punto.",
    "fields":[
     {"key":"cintura_ombligo","label":"Cintura (ombligo)","type":"number","unit":"cm","min":30,"max":250,"step":0.1,"overview":true},
     {"key":"cintura_arriba","label":"Cintura (5 cm arriba)","type":"number","unit":"cm","min":30,"max":250,"step":0.1},
     {"key":"cintura_abajo","label":"Cintura (5 cm abajo)","type":"number","unit":"cm","min":30,"max":250,"step":0.1},
     {"key":"cuello","label":"Cuello","type":"number","unit":"cm","min":10,"max":100,"step":0.1},
     {"key":"pecho","label":"Pecho","type":"number","unit":"cm","min":30,"max":250,"step":0.1},
     {"key":"hombros","label":"Hombros","type":"number","unit":"cm","min":30,"max":250,"step":0.1},
     {"key":"cadera","label":"Cadera","type":"number","unit":"cm","min":30,"max":250,"step":0.1},
     {"key":"brazo_izq","label":"Brazo izq.","type":"number","unit":"cm","min":10,"max":100,"step":0.1},
     {"key":"brazo_der","label":"Brazo der.","type":"number","unit":"cm","min":10,"max":100,"step":0.1},
     {"key":"antebrazo","label":"Antebrazo","type":"number","unit":"cm","min":10,"max":100,"step":0.1},
     {"key":"muslo","label":"Muslo","type":"number","unit":"cm","min":20,"max":150,"step":0.1},
     {"key":"pantorrilla","label":"Pantorrilla","type":"number","unit":"cm","min":10,"max":100,"step":0.1}
    ]}
  ]},
 {"slug":"nutricion","name":"Nutrición","icon":"🥗","sort":40,"description":"Cumplimiento del menú y sensaciones. Kcal y proteína son estimaciones.",
  "forms":[
   {"slug":"dia","name":"Día de comida","cadence":"daily","sort":10,"description":"Al final del día.",
    "fields":[
     {"key":"menu","label":"¿Seguiste el menú?","type":"choice","required":true,"options":[{"value":"si","label":"Sí"},{"value":"casi","label":"Casi"},{"value":"no","label":"No"}]},
     {"key":"kcal","label":"Kcal (estimadas)","type":"integer","unit":"kcal","min":0,"max":10000},
     {"key":"proteina","label":"Proteína (estimada)","type":"number","unit":"g","min":0,"max":500},
     {"key":"hambre","label":"Hambre (5 = nada)","type":"scale","min":1,"max":5,"overview":true},
     {"key":"agua","label":"Agua","type":"number","unit":"L","min":0,"max":10,"step":0.1},
     {"key":"suplementos","label":"Suplementos tomados","type":"multi","options":[{"value":"creatina","label":"Creatina"},{"value":"omega","label":"Omega"},{"value":"d3","label":"D3"},{"value":"proteina","label":"Proteína en polvo"},{"value":"cafeina","label":"Cafeína"}]},
     {"key":"notas","label":"Notas","type":"text","help":"Comida fuera, cambios del menú"}
    ]}
  ]},
 {"slug":"planificacion","name":"Planificación","icon":"🗓️","sort":50,"description":"Revisión semanal del domingo.",
  "forms":[
   {"slug":"revision","name":"Revisión semanal","cadence":"weekly","sort":10,"description":"Domingo, 20-30 min.",
    "fields":[
     {"key":"cumplimiento","label":"Cumplimiento de la semana","type":"scale","min":1,"max":5,"required":true,"overview":true},
     {"key":"horas_frances","label":"Horas de francés","type":"number","unit":"h","min":0,"max":100,"step":0.25},
     {"key":"bien","label":"Qué fue bien","type":"text"},
     {"key":"mejorar","label":"Qué mejorar","type":"text"},
     {"key":"prioridades","label":"Prioridades de la semana que empieza","type":"text"}
    ]}
  ]},
 {"slug":"proyectos","name":"Proyectos","icon":"🚀","sort":60,"description":"Empresa y otros proyectos.",
  "forms":[
   {"slug":"empresa","name":"Empresa: semana","cadence":"weekly","sort":10,"description":"Captación y avance.",
    "fields":[
     {"key":"horas","label":"Horas dedicadas","type":"number","unit":"h","min":0,"max":100,"step":0.25,"overview":true},
     {"key":"contactos","label":"Contactos nuevos","type":"integer","min":0,"max":1000},
     {"key":"reuniones","label":"Reuniones o demos","type":"integer","min":0,"max":200},
     {"key":"clientes_pago","label":"Clientes de pago (total)","type":"integer","min":0,"max":100000,"overview":true},
     {"key":"ingreso_mes","label":"Ingreso recurrente mensual","type":"number","unit":"€","min":0,"max":10000000},
     {"key":"notas","label":"Notas","type":"text"}
    ]}
  ]},
 {"slug":"finanzas","name":"Finanzas","icon":"💶","sort":70,"description":"Sin bancos conectados. Conceptos genéricos: nada de IBAN, tarjetas ni nombres.",
  "forms":[
   {"slug":"movimiento","name":"Gasto o ingreso","cadence":"free","sort":10,"description":"Efectivo, compartidos o lo que no esté en el extracto.",
    "fields":[
     {"key":"tipo","label":"Tipo","type":"choice","required":true,"options":[{"value":"gasto","label":"Gasto"},{"value":"ingreso","label":"Ingreso"}]},
     {"key":"importe","label":"Importe","type":"number","min":0,"max":10000000,"step":0.01,"required":true},
     {"key":"moneda","label":"Moneda","type":"choice","required":true,"options":[{"value":"CHF","label":"CHF"},{"value":"EUR","label":"EUR"}]},
     {"key":"categoria","label":"Categoría","type":"choice","options":[{"value":"vivienda","label":"Vivienda"},{"value":"seguros","label":"Seguros"},{"value":"comida","label":"Comida"},{"value":"transporte","label":"Transporte"},{"value":"salud","label":"Salud"},{"value":"ocio","label":"Ocio"},{"value":"viajes","label":"Viajes"},{"value":"suscripciones","label":"Suscripciones"},{"value":"empresa","label":"Empresa"},{"value":"ahorro","label":"Ahorro e inversión"},{"value":"otros","label":"Otros"}]},
     {"key":"ambito","label":"Ámbito","type":"choice","options":[{"value":"personal","label":"Personal"},{"value":"compartido","label":"Compartido"},{"value":"empresa","label":"Empresa"}]},
     {"key":"concepto","label":"Concepto genérico","type":"text","max":120}
    ]},
   {"slug":"cierre","name":"Cierre de mes","cadence":"monthly","sort":20,"description":"Primer domingo de mes, con el extracto.",
    "fields":[
     {"key":"ingreso_neto","label":"Ingreso neto","type":"number","unit":"CHF","min":0,"max":10000000,"step":0.01},
     {"key":"gasto_total","label":"Gasto total","type":"number","unit":"CHF","min":0,"max":10000000,"step":0.01},
     {"key":"liquidez","label":"Liquidez total","type":"number","unit":"CHF","min":0,"max":100000000,"step":0.01,"overview":true},
     {"key":"inversion","label":"Inversiones","type":"number","unit":"CHF","min":0,"max":100000000,"step":0.01},
     {"key":"cuadra","label":"¿Cuadra con el extracto?","type":"boolean"},
     {"key":"notas","label":"Notas","type":"text"}
    ]}
  ]},
 {"slug":"pelo","name":"Pelo","icon":"💈","sort":80,"description":"Seguimiento subjetivo. Las fotos van solo a la carpeta privada, nunca aquí.",
  "forms":[
   {"slug":"seguimiento","name":"Seguimiento mensual","cadence":"monthly","sort":10,"description":"Junto con las fotos de cada 4 semanas.",
    "fields":[
     {"key":"impresion","label":"Impresión (5 = mucho mejor)","type":"scale","min":1,"max":5,"required":true},
     {"key":"fotos_hechas","label":"Fotos de control hechas","type":"boolean"},
     {"key":"notas","label":"Notas","type":"text"}
    ]}
  ]}
]
$json$;
  a jsonb;
  f jsonb;
  fl jsonb;
  v_area uuid;
  v_form uuid;
  i integer;
begin
  for a in select * from jsonb_array_elements(v_seed) loop
    insert into core.area (slug, name, description, icon, sort_order)
    values (a ->> 'slug', a ->> 'name', coalesce(a ->> 'description', ''), coalesce(a ->> 'icon', ''), (a ->> 'sort')::integer)
    on conflict (slug) do nothing;
    select id into v_area from core.area where slug = a ->> 'slug';

    for f in select * from jsonb_array_elements(a -> 'forms') loop
      insert into core.form (area_id, slug, name, description, cadence, sort_order)
      values (v_area, f ->> 'slug', f ->> 'name', coalesce(f ->> 'description', ''),
              (f ->> 'cadence')::core.cadence, (f ->> 'sort')::integer)
      on conflict (area_id, slug) do nothing;
      select id into v_form from core.form where area_id = v_area and slug = f ->> 'slug';

      i := 0;
      for fl in select * from jsonb_array_elements(f -> 'fields') loop
        i := i + 10;
        insert into core.field (form_id, key, label, help, type, unit, min, max, step, options, columns,
                                required, on_overview, sort_order)
        values (v_form, fl ->> 'key', fl ->> 'label', coalesce(fl ->> 'help', ''), (fl ->> 'type')::core.field_type,
                coalesce(fl ->> 'unit', ''), (fl ->> 'min')::numeric, (fl ->> 'max')::numeric, (fl ->> 'step')::numeric,
                coalesce(fl -> 'options', '[]'), coalesce(fl -> 'columns', '[]'),
                coalesce((fl ->> 'required')::boolean, false), coalesce((fl ->> 'overview')::boolean, false), i)
        on conflict (form_id, key) do nothing;
      end loop;
    end loop;
  end loop;
end
$seed$;
