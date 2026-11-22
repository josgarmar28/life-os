-- LIFE OS · Gimnasio de cada sesión de pesas.
-- Las rutinas van por gimnasio (content.gym en core.plan; sin él, el de casa) y cada sesión guarda
-- dónde se hizo, para separar su historial y elegir el gimnasio por defecto en el dashboard.
-- En una base nueva el campo lo crea la semilla; aquí se añade a la ya sembrada.
insert into core.field (form_id, key, label, help, type, sort_order)
select f.id, 'gimnasio', 'Gimnasio', 'Slug del gimnasio (elevate, la_zona…). Lo rellena el modo entreno.', 'text', 75
  from core.form f
  join core.area a on a.id = f.area_id
 where a.slug = 'entreno' and f.slug = 'sesion'
on conflict (form_id, key) do nothing;
