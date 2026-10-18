-- Motor de áreas: acceso del dueño, límites de Claude, validación, historia y propuestas.
\set ON_ERROR_STOP on
\ir _helpers.sql

-- Identidades sintéticas.
create function pg_temp.as_owner() returns void language sql as
$$ select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) $$;
create function pg_temp.as_agent() returns void language sql as
$$ select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","client_id":"claude-test"}', false) $$;
create function pg_temp.as_stranger() returns void language sql as
$$ select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false) $$;

insert into core.app_owner (user_id) values ('11111111-1111-1111-1111-111111111111');

-- Solo puede haber un dueño.
do $$
begin
  insert into core.app_owner (user_id) values ('33333333-3333-3333-3333-333333333333');
  raise exception 'EXPECTED FAILURE: second owner';
exception when unique_violation then null;
end $$;

---------------------------------------------------------------------------
-- Estructura creada por el dueño
---------------------------------------------------------------------------
select pg_temp.as_owner();
create temp table ids as
select
  pg_temp.run_as('authenticated', $q$api.save_area(null, 'sueno', 'Sueño', 'Descanso', '🌙', 10)$q$)::uuid as area_id;
grant all on ids to authenticated;

alter table ids add column form_id uuid;
update ids set form_id = pg_temp.run_as('authenticated',
  format($q$api.save_form(null, %L, 'manana', 'Registro de mañana', '', 'daily', 10)$q$, area_id))::uuid;

select pg_temp.run_as('authenticated', format($q$api.save_field(null, %L, 'calidad', 'Calidad', 'scale', p_min => 1, p_max => 5, p_required => true, p_on_overview => true)$q$, form_id)) from ids;
select pg_temp.run_as('authenticated', format($q$api.save_field(null, %L, 'horas', 'Horas', 'number', p_unit => 'h', p_min => 0, p_max => 24)$q$, form_id)) from ids;
select pg_temp.run_as('authenticated', format($q$api.save_field(null, %L, 'fuente', 'Fuente', 'choice', p_options => '[{"value":"trabajo","label":"Trabajo"},{"value":"piso","label":"Piso"}]')$q$, form_id)) from ids;
select pg_temp.run_as('authenticated', format($q$api.save_field(null, %L, 'series', 'Series', 'table', p_columns => '[{"key":"ejercicio","label":"Ejercicio","type":"text","required":true},{"key":"reps","label":"Reps","type":"integer","min":0,"max":100},{"key":"rir","label":"RIR","type":"integer","min":0,"max":10}]')$q$, form_id)) from ids;

select pg_temp.assert_eq('fields created', pg_temp.run_as('authenticated', '(select count(*) from api.fields)'), '4');

-- Forma de los campos.
select pg_temp.assert_fails('authenticated', format($q$select api.save_field(null, '%s', 'mal', 'Mal', 'scale')$q$, (select form_id from ids)), '%scale fields need integer min and max%');
select pg_temp.assert_fails('authenticated', format($q$select api.save_field(null, '%s', 'mal', 'Mal', 'choice')$q$, (select form_id from ids)), '%needs at least one option%');
select pg_temp.assert_fails('authenticated', format($q$select api.save_field(null, '%s', 'Mal Key', 'Mal', 'number')$q$, (select form_id from ids)), '%field_key_check%');
-- La clave y el tipo son inmutables.
select pg_temp.assert_fails('authenticated',
  format($q$select api.save_field((select id from api.fields where key = 'horas'), '%s', 'horas', 'Horas', 'integer')$q$, (select form_id from ids)),
  '%immutable%');

---------------------------------------------------------------------------
-- Aislamiento
---------------------------------------------------------------------------
select pg_temp.as_stranger();
select pg_temp.assert_eq('stranger sees no areas', pg_temp.run_as('authenticated', '(select count(*) from api.areas)'), '0');
select pg_temp.assert_fails('authenticated', $q$select api.save_area(null, 'x', 'X')$q$, '%not authorized%');
select pg_temp.assert_fails('authenticated',
  format($q$select api.add_entry('%s', '{"calidad":3}', gen_random_uuid())$q$, (select form_id from ids)), '%not authorized%');
select pg_temp.assert_fails('anon', 'select count(*) from api.areas', '%permission denied%');
select pg_temp.assert_fails('anon', 'select count(*) from core.entry', '%permission denied%');

---------------------------------------------------------------------------
-- Entradas del dueño: validación, idempotencia, corrección y anulación
---------------------------------------------------------------------------
select pg_temp.as_owner();
select pg_temp.assert_fails('authenticated', format($q$select api.add_entry('%s', '{"calidad":7}', gen_random_uuid())$q$, (select form_id from ids)), '%outside%');
select pg_temp.assert_fails('authenticated', format($q$select api.add_entry('%s', '{"calidad":3.5}', gen_random_uuid())$q$, (select form_id from ids)), '%whole number%');
select pg_temp.assert_fails('authenticated', format($q$select api.add_entry('%s', '{"horas":7}', gen_random_uuid())$q$, (select form_id from ids)), '%Calidad: required%');
select pg_temp.assert_fails('authenticated', format($q$select api.add_entry('%s', '{"calidad":3,"otro":1}', gen_random_uuid())$q$, (select form_id from ids)), '%unknown or archived field: otro%');
select pg_temp.assert_fails('authenticated', format($q$select api.add_entry('%s', '{"calidad":3,"fuente":"luna"}', gen_random_uuid())$q$, (select form_id from ids)), '%not one of the options%');
select pg_temp.assert_fails('authenticated', format($q$select api.add_entry('%s', '{"calidad":3,"series":[{"reps":8}]}', gen_random_uuid())$q$, (select form_id from ids)), '%Ejercicio is required%');
select pg_temp.assert_fails('authenticated', format($q$select api.add_entry('%s', '{"calidad":3,"series":[{"ejercicio":"x","peso":5}]}', gen_random_uuid())$q$, (select form_id from ids)), '%unknown column peso%');
select pg_temp.assert_fails('authenticated', format($q$select api.add_entry('%s', '{"calidad":3}', gen_random_uuid(), p_quality => 'measured')$q$, (select form_id from ids)), '%quality must be manual or estimated%');
select pg_temp.assert_fails('authenticated', format($q$select api.add_entry('%s', '{"calidad":3}', gen_random_uuid(), p_occurred_at => now() + interval '1 day')$q$, (select form_id from ids)), '%future%');

alter table ids add column e1 uuid, add column e2 uuid, add column e3 uuid;
update ids set e1 = pg_temp.run_as('authenticated', format(
  $q$api.add_entry('%s', '{"calidad":4,"horas":7.5,"fuente":"piso","series":[{"ejercicio":"Prensa","reps":10,"rir":2},{"ejercicio":"","reps":null}]}', 'aaaaaaaa-0000-0000-0000-000000000001', p_occurred_at => '2026-10-12 05:00+02', p_note => '  ok  ')$q$,
  form_id))::uuid;

-- Normalización: filas vacías y textos vacíos fuera, nota recortada, fecha local en Europe/Zurich.
select pg_temp.assert_eq('normalized data',
  pg_temp.run_as('authenticated', format($q$(select data from api.entries where id = '%s')$q$, (select e1 from ids))),
  '{"horas": 7.5, "fuente": "piso", "series": [{"rir": 2, "reps": 10, "ejercicio": "Prensa"}], "calidad": 4}');
select pg_temp.assert_eq('note trimmed', pg_temp.run_as('authenticated', format($q$(select note from api.entries where id = '%s')$q$, (select e1 from ids))), 'ok');
select pg_temp.assert_eq('local date', pg_temp.run_as('authenticated', format($q$(select local_date from api.entries where id = '%s')$q$, (select e1 from ids))), '2026-10-12');
select pg_temp.assert_eq('dashboard source', pg_temp.run_as('authenticated', format($q$(select source from api.entries where id = '%s')$q$, (select e1 from ids))), 'dashboard');

-- Reintento con el mismo request_id: misma entrada, ninguna nueva.
select pg_temp.assert_eq('idempotent',
  pg_temp.run_as('authenticated', format($q$api.add_entry('%s', '{"calidad":4}', 'aaaaaaaa-0000-0000-0000-000000000001')$q$, (select form_id from ids))),
  (select e1::text from ids));
select pg_temp.assert_eq('one entry', (select count(*) from core.entry), 1::bigint);

-- Corrección: nueva versión; la vista muestra solo la vigente.
update ids set e2 = pg_temp.run_as('authenticated', format(
  $q$api.add_entry('%s', '{"calidad":5}', gen_random_uuid(), p_supersedes_id => '%s')$q$, form_id, e1))::uuid;
select pg_temp.assert_eq('current only', pg_temp.run_as('authenticated', '(select count(*) from api.entries)'), '1');
select pg_temp.assert_eq('two versions', pg_temp.run_as('authenticated', '(select count(*) from api.entry_versions)'), '2');
select pg_temp.assert_fails('authenticated', format($q$select api.add_entry('%s', '{"calidad":2}', gen_random_uuid(), p_supersedes_id => '%s')$q$,
  (select form_id from ids), (select e1 from ids)), '%only the current version%');

-- Anulación.
update ids set e3 = pg_temp.run_as('authenticated', format($q$api.void_entry('%s', gen_random_uuid())$q$, e2))::uuid;
select pg_temp.assert_eq('voided', pg_temp.run_as('authenticated', '(select count(*) from api.entries)'), '0');

-- Solo inserción, incluso para el propietario de la tabla.
do $$
begin
  update core.entry set note = 'x';
  raise exception 'EXPECTED FAILURE: update entry';
exception when others then
  if sqlerrm not like '%append-only%' then raise; end if;
end $$;
do $$
begin
  delete from core.entry;
  raise exception 'EXPECTED FAILURE: delete entry';
exception when others then
  if sqlerrm not like '%append-only%' then raise; end if;
end $$;
select pg_temp.assert_fails('authenticated', 'update core.entry set note = $$x$$', '%permission denied%');
select pg_temp.assert_fails('authenticated', 'insert into core.area (slug, name) values ($$a$$, $$A$$)', '%permission denied%');

---------------------------------------------------------------------------
-- Claude (token con client_id)
---------------------------------------------------------------------------
select pg_temp.as_agent();
select pg_temp.assert_eq('agent reads', pg_temp.run_as('authenticated', '(select count(*) from api.areas)'), '1');
select pg_temp.assert_fails('authenticated', $q$select api.save_area(null, 'x', 'X')$q$, '%use api.create_proposal%');
select pg_temp.assert_fails('authenticated', format($q$select api.set_area_status('%s', 'archived')$q$, (select area_id from ids)), '%use api.create_proposal%');
select pg_temp.assert_fails('authenticated', format($q$select api.purge_area('%s', 'Sueño')$q$, (select area_id from ids)), '%use api.create_proposal%');

alter table ids add column ea uuid;
update ids set ea = pg_temp.run_as('authenticated', format($q$api.add_entry('%s', '{"calidad":3}', gen_random_uuid())$q$, form_id))::uuid;
select pg_temp.assert_eq('claude source', pg_temp.run_as('authenticated', format($q$(select source || '/' || actor from api.entries where id = '%s')$q$, (select ea from ids))), 'claude/agent:claude-test');

-- Propuesta de Claude: añadir un campo.
alter table ids add column prop uuid;
update ids set prop = pg_temp.run_as('authenticated', format(
  $q$api.create_proposal('field.save', '{"form_id":"%s","key":"siesta","label":"Siesta","type":"boolean"}', 'Registrar siestas')$q$, form_id))::uuid;
select pg_temp.assert_fails('authenticated', format($q$select api.decide_proposal('%s', true, (select payload_hash from api.proposals where id = '%s'))$q$,
  (select prop from ids), (select prop from ids)), '%use api.create_proposal%');

---------------------------------------------------------------------------
-- El dueño decide
---------------------------------------------------------------------------
select pg_temp.as_owner();
select pg_temp.assert_fails('authenticated', format($q$select api.decide_proposal('%s', true, 'otro-hash')$q$, (select prop from ids)), '%does not match%');
select pg_temp.assert_eq('applied',
  pg_temp.run_as('authenticated', format($q$api.decide_proposal('%s', true, (select payload_hash from api.proposals where id = '%s')) ->> 'status'$q$,
    (select prop from ids), (select prop from ids))),
  'applied');
select pg_temp.assert_eq('field from proposal', pg_temp.run_as('authenticated', $q$(select type::text from api.fields where key = 'siesta')$q$), 'boolean');
select pg_temp.assert_fails('authenticated', format($q$select api.decide_proposal('%s', false, (select payload_hash from api.proposals where id = '%s'))$q$,
  (select prop from ids), (select prop from ids)), '%already decided%');
-- Una propuesta inválida queda como fallida, sin efectos.
alter table ids add column bad uuid;
update ids set bad = pg_temp.run_as('authenticated', $q$api.create_proposal('area.save', '{"slug":"MAL","name":"x"}', 'prueba')$q$)::uuid;
select pg_temp.assert_eq('failed',
  pg_temp.run_as('authenticated', format($q$api.decide_proposal('%s', true, (select payload_hash from api.proposals where id = '%s')) ->> 'status'$q$,
    (select bad from ids), (select bad from ids))),
  'failed');
select pg_temp.assert_eq('no side effects', pg_temp.run_as('authenticated', '(select count(*) from api.areas)'), '1');

---------------------------------------------------------------------------
-- Archivar y borrar definitivamente
---------------------------------------------------------------------------
select pg_temp.run_as('authenticated', format($q$api.set_form_status('%s', 'archived')$q$, (select form_id from ids)));
select pg_temp.assert_fails('authenticated', format($q$select api.add_entry('%s', '{"calidad":3}', gen_random_uuid())$q$, (select form_id from ids)), '%archived%');
select pg_temp.run_as('authenticated', format($q$api.set_form_status('%s', 'active')$q$, (select form_id from ids)));

select pg_temp.assert_fails('authenticated', format($q$select api.purge_area('%s', 'Sueño')$q$, (select area_id from ids)), '%archive the area%');
select pg_temp.run_as('authenticated', format($q$api.set_area_status('%s', 'archived')$q$, (select area_id from ids)));
select pg_temp.assert_eq('archived kept data', pg_temp.run_as('authenticated', '(select count(*) from api.entry_versions)'), '4');
select pg_temp.assert_fails('authenticated', format($q$select api.purge_area('%s', 'sueño')$q$, (select area_id from ids)), '%does not match%');
select pg_temp.assert_eq('purge counts',
  pg_temp.run_as('authenticated', format($q$api.purge_area('%s', 'Sueño') ->> 'entries'$q$, (select area_id from ids))), '4');
select pg_temp.assert_eq('purged', (select count(*) from core.entry), 0::bigint);
select pg_temp.assert_eq('purge audited', (select count(*) from ops.audit_log where action = 'area.purge'), 1::bigint);
-- Tras el borrado, el bloqueo de solo inserción sigue activo.
select pg_temp.assert_eq('purge flag off', coalesce(nullif(current_setting('lifeos.purge', true), ''), 'off'), 'off');

-- La actividad no expone valores.
select pg_temp.assert_eq('activity has no data',
  pg_temp.run_as('authenticated', $q$(select count(*) from api.recent_activity(200) where detail ? 'data' or detail ? 'values')$q$), '0');
