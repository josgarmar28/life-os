-- Propuestas con identificadores legibles y cuestionario con campos en una sola propuesta.
\set ON_ERROR_STOP on
\ir _helpers.sql

create function pg_temp.as_owner() returns void language sql as
$$ select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) $$;
create function pg_temp.as_agent() returns void language sql as
$$ select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","client_id":"claude-test"}', false) $$;
-- Propone como Claude y aprueba como dueño; devuelve el estado.
create function pg_temp.propose_and_approve(p_kind text, p_payload text) returns text language plpgsql as
$$
declare
  v_id uuid;
  v text;
begin
  perform pg_temp.as_agent();
  v_id := pg_temp.run_as('authenticated', format('api.create_proposal(%L, %L, %L)', p_kind, p_payload, 'prueba'))::uuid;
  perform pg_temp.as_owner();
  v := pg_temp.run_as('authenticated', format('api.decide_proposal(%L, true, (select payload_hash from api.proposals where id = %L))::text', v_id, v_id));
  return v;
end
$$;

delete from core.app_owner;
insert into core.app_owner (user_id) values ('11111111-1111-1111-1111-111111111111');

-- Área nueva por slug y, después, la misma propuesta por slug la modifica (no duplica).
select pg_temp.assert_eq('area new', pg_temp.propose_and_approve('area.save', '{"slug":"lectura","name":"Lectura","icon":"📚"}')::jsonb ->> 'status', 'applied');
select pg_temp.assert_eq('area update', pg_temp.propose_and_approve('area.save', '{"slug":"lectura","name":"Lectura y estudio","icon":"📚"}')::jsonb ->> 'status', 'applied');
select pg_temp.assert_eq('area name', (select name from core.area where slug = 'lectura'), 'Lectura y estudio');
select pg_temp.assert_eq('one area', (select count(*) from core.area where slug = 'lectura'), 1::bigint);

-- Cuestionario con campos en una sola propuesta.
select pg_temp.assert_eq('form with fields',
  pg_temp.propose_and_approve('form.save', '{"area":"lectura","slug":"diaria","name":"Lectura diaria","cadence":"daily","fields":[
     {"key":"minutos","label":"Minutos","type":"integer","min":0,"max":600,"on_overview":true},
     {"key":"libro","label":"Libro","type":"text"}]}')::jsonb ->> 'status', 'applied');
select pg_temp.assert_eq('fields created',
  (select string_agg(fd.key || ':' || fd.sort_order, ',' order by fd.sort_order) from core.field fd join core.form f on f.id = fd.form_id where f.slug = 'diaria'),
  'minutos:10,libro:20');

-- Campo por area+form+key: añade uno y modifica otro existente sin duplicar.
select pg_temp.assert_eq('field add', pg_temp.propose_and_approve('field.save', '{"area":"lectura","form":"diaria","key":"paginas","label":"Páginas","type":"integer","min":0}')::jsonb ->> 'status', 'applied');
select pg_temp.assert_eq('field update', pg_temp.propose_and_approve('field.save', '{"area":"lectura","form":"diaria","key":"libro","label":"Título del libro","type":"text"}')::jsonb ->> 'status', 'applied');
select pg_temp.assert_eq('field label', (select label from core.field where key = 'libro'), 'Título del libro');
select pg_temp.assert_eq('three fields', (select count(*) from core.field fd join core.form f on f.id = fd.form_id where f.slug = 'diaria'), 3::bigint);

-- El tipo de un campo existente no cambia por propuesta: falla y no aplica nada.
select pg_temp.assert_eq('type change fails', pg_temp.propose_and_approve('field.save', '{"area":"lectura","form":"diaria","key":"libro","label":"Libro","type":"integer"}')::jsonb ->> 'status', 'failed');

-- Todo o nada: un cuestionario con un campo inválido no deja ni el cuestionario.
select pg_temp.assert_eq('atomic', pg_temp.propose_and_approve('form.save', '{"area":"lectura","slug":"semanal","name":"Semanal","cadence":"weekly","fields":[
     {"key":"ok","label":"Ok","type":"boolean"},{"key":"MAL CLAVE","label":"x","type":"text"}]}')::jsonb ->> 'status', 'failed');
select pg_temp.assert_eq('no partial form', (select count(*) from core.form where slug = 'semanal'), 0::bigint);

-- Referencias inexistentes: fallo legible.
select pg_temp.assert_eq('unknown area', pg_temp.propose_and_approve('form.save', '{"area":"nada","slug":"x","name":"X"}')::jsonb ->> 'error', 'area "nada" not found');

-- Archivar por identificadores legibles.
select pg_temp.assert_eq('field archive', pg_temp.propose_and_approve('field.archive', '{"area":"lectura","form":"diaria","key":"paginas"}')::jsonb ->> 'status', 'applied');
select pg_temp.assert_eq('field archived', (select status::text from core.field where key = 'paginas'), 'archived');
select pg_temp.assert_eq('form archive', pg_temp.propose_and_approve('form.archive', '{"area":"lectura","form":"diaria"}')::jsonb ->> 'status', 'applied');
select pg_temp.assert_eq('form archived', (select status::text from core.form where slug = 'diaria'), 'archived');

-- Claude sigue sin poder aplicar nada por su cuenta, ni fabricando una propuesta a mano.
select pg_temp.as_agent();
select pg_temp.assert_fails('authenticated',
  $q$select core.apply_proposal(row(gen_random_uuid(), 'area.save', '{"slug":"atajo","name":"Atajo"}', 'x', '', 'pending', 'x', now(), now() + interval '1 day', null, null)::core.proposal)$q$,
  '%permission denied%');
select pg_temp.assert_eq('no shortcut area', (select count(*) from core.area where slug = 'atajo'), 0::bigint);
