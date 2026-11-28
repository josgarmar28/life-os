-- Modo viaje: crear, editar y cancelar un viaje aplica y revierte periodo de gimnasio y semanas sin pisar
-- lo que él haya elegido; solo el dueño marca el checklist; Claude puede crear y cancelar.
\set ON_ERROR_STOP on
\ir _helpers.sql

create function pg_temp.as_owner() returns void language sql as
$$ select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) $$;
create function pg_temp.as_agent() returns void language sql as
$$ select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","client_id":"claude-test"}', false) $$;
create function pg_temp.as_stranger() returns void language sql as
$$ select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false) $$;

delete from core.app_owner;
insert into core.app_owner (user_id) values ('11111111-1111-1111-1111-111111111111');
-- Las pruebas anteriores comparten base: partimos sin periodos ni semanas.
delete from core.gym_period;
delete from core.week_plan;

select pg_temp.as_owner();
-- Semana con elecciones suyas previas: teletrabajo X y V, una nota.
select pg_temp.run_as('authenticated', $$api.save_week('2027-01-18', array[3,5]::smallint[], array[]::smallint[], 'mía')$$);

-- Viaje corto vie 22 → dom 24 con gimnasio en España; semana del 18 ya existe, la del 18 es la del viernes 22.
select pg_temp.run_as('authenticated', $$api.save_trip(
  '{"kind":"espana","date_from":"2027-01-22","date_to":"2027-01-24","leave_time":"16:00","return_leave_time":"12:00","return_home_time":"17:30",
    "gym":"la_zona","gym_opens":"07:00","commute_min":15,"gym_from":"2027-01-23","gym_to":"2027-01-24",
    "away_dates":["2027-01-23","2027-01-24"],"night_dates":["2027-01-23","2027-01-24"],
    "weeks":[{"week_start":"2027-01-18","telework_base":[3,5],"add_telework":[],"add_away":[6,7]}]}'::jsonb,
  '33333333-3333-3333-3333-333333333301')$$);
select pg_temp.assert_eq('trip saved', (select count(*) from core.trip where status = 'planned'), 1::bigint);
select pg_temp.assert_eq('gym period created', (select gym || date_from || date_to from core.gym_period), 'la_zona2027-01-232027-01-24');
select pg_temp.assert_eq('week merged', (select telework::text || away::text from core.week_plan where week_start = '2027-01-18'), '{3,5}{6,7}');
select pg_temp.assert_eq('note kept', (select note from core.week_plan where week_start = '2027-01-18'), 'mía');
select pg_temp.assert_eq('visible in view', (select count(*) from api.trips), 1::bigint);

-- Idempotente: el mismo request_id no duplica.
select pg_temp.run_as('authenticated', $$api.save_trip('{"kind":"espana","date_from":"2027-01-22","date_to":"2027-01-24"}'::jsonb, '33333333-3333-3333-3333-333333333301')$$);
select pg_temp.assert_eq('idempotent', (select count(*) from core.trip), 1::bigint);

-- Él cambia la semana a mano después (añade el lunes fuera); cancelar solo quita lo que añadió el viaje.
select pg_temp.run_as('authenticated', $$api.save_week('2027-01-18', array[3,5]::smallint[], array[1,6,7]::smallint[], 'mía')$$);
select pg_temp.run_as('authenticated', $$api.cancel_trip((select id from core.trip))$$);
select pg_temp.assert_eq('cancelled', (select status from core.trip), 'cancelled');
select pg_temp.assert_eq('gym period removed', (select count(*) from core.gym_period), 0::bigint);
select pg_temp.assert_eq('manual away kept', (select telework::text || away::text from core.week_plan where week_start = '2027-01-18'), '{3,5}{1}');
-- Cancelar dos veces no hace nada raro.
select pg_temp.run_as('authenticated', $$api.cancel_trip((select id from core.trip))$$);

-- Viaje que crea semanas nuevas (sin fila): parte del teletrabajo por defecto y, al cancelar, la fila desaparece.
select pg_temp.run_as('authenticated', $$api.save_trip(
  '{"kind":"espana","date_from":"2027-02-01","date_to":"2027-02-07","leave_time":"09:00","return_leave_time":"08:30","return_home_time":"18:30",
    "vacation_from":"2027-02-03","vacation_to":"2027-02-04",
    "gym":"la_zona","gym_opens":"07:00","commute_min":15,"gym_from":"2027-02-02","gym_to":"2027-02-07",
    "away_dates":["2027-02-02","2027-02-03","2027-02-04","2027-02-05","2027-02-06","2027-02-07"],
    "remote_dates":["2027-02-02","2027-02-05"],"night_dates":["2027-02-02","2027-02-03"],
    "weeks":[{"week_start":"2027-02-01","telework_base":[3,5],"add_telework":[2,5],"add_away":[2,3,4,5,6,7]}]}'::jsonb,
  '33333333-3333-3333-3333-333333333302')$$);
select pg_temp.assert_eq('new week from default', (select telework::text || away::text from core.week_plan where week_start = '2027-02-01'), '{2,3,5}{2,3,4,5,6,7}');
select pg_temp.assert_eq('actor owner', (select actor from core.trip where request_id = '33333333-3333-3333-3333-333333333302'), 'owner');

-- Solapes: otro viaje que pisa fechas, o un periodo de gimnasio que choca.
select pg_temp.assert_fails('authenticated', $$select api.save_trip('{"kind":"espana","date_from":"2027-02-05","date_to":"2027-02-09"}'::jsonb, '33333333-3333-3333-3333-333333333303')$$, '%trip overlaps%');
select pg_temp.run_as('authenticated', $$api.save_gym_period('la_zona', '2027-03-02', '2027-03-04')$$);
select pg_temp.assert_fails('authenticated', $$select api.save_trip(
  '{"kind":"espana","date_from":"2027-03-01","date_to":"2027-03-05","gym":"la_zona","gym_from":"2027-03-03","gym_to":"2027-03-05",
    "weeks":[{"week_start":"2027-03-01","telework_base":[3,5],"add_telework":[],"add_away":[1]}]}'::jsonb, '33333333-3333-3333-3333-333333333304')$$, '%gym period overlaps%');
-- Atómico: el fallo anterior no dejó semana ni viaje a medias.
select pg_temp.assert_eq('nothing left behind', (select count(*) from core.week_plan where week_start = '2027-03-01'), 0::bigint);
select pg_temp.assert_eq('no trip left behind', (select count(*) from core.trip where request_id = '33333333-3333-3333-3333-333333333304'), 0::bigint);

-- Validaciones.
select pg_temp.assert_fails('authenticated', $$select api.save_trip('{"kind":"espana","date_from":"2027-04-05","date_to":"2027-04-01"}'::jsonb, '33333333-3333-3333-3333-333333333305')$$, '%trip_check%');
select pg_temp.assert_fails('authenticated', $$select api.save_trip('{"kind":"espana","date_from":"2027-04-01","date_to":"2027-04-03","away_dates":["2027-04-09"]}'::jsonb, '33333333-3333-3333-3333-333333333306')$$, '%outside the trip range%');
select pg_temp.assert_fails('authenticated', $$select api.save_trip('{"kind":"espana","date_from":"2027-04-01","date_to":"2027-04-03","vacation_from":"2027-04-02"}'::jsonb, '33333333-3333-3333-3333-333333333307')$$, '%trip_check%');
select pg_temp.assert_fails('authenticated', $$select api.save_trip('{"kind":"visita","date_from":"2027-04-01","date_to":"2027-04-03","gym":"la_zona","gym_from":"2027-04-02","gym_to":"2027-04-03"}'::jsonb, '33333333-3333-3333-3333-333333333308')$$, '%trip_check%');
select pg_temp.assert_fails('authenticated', $$select api.save_trip('{"kind":"espana","date_from":"2027-04-01","date_to":"2027-04-03","weeks":[{"week_start":"2027-03-31"}]}'::jsonb, '33333333-3333-3333-3333-333333333309')$$, '%Monday%');

-- Editar: revierte lo anterior y aplica lo nuevo (en la misma transacción).
select pg_temp.run_as('authenticated', $$api.save_trip(
  '{"kind":"espana","date_from":"2027-02-01","date_to":"2027-02-05","away_dates":["2027-02-02","2027-02-03"],"remote_dates":["2027-02-02"],
    "weeks":[{"week_start":"2027-02-01","telework_base":[3,5],"add_telework":[2],"add_away":[2,3]}]}'::jsonb,
  '33333333-3333-3333-3333-333333333302', (select id from core.trip where request_id = '33333333-3333-3333-3333-333333333302'))$$);
select pg_temp.assert_eq('edited week', (select telework::text || away::text from core.week_plan where week_start = '2027-02-01'), '{2,3,5}{2,3}');
select pg_temp.assert_eq('edit dropped gym period', (select count(*) from core.gym_period where date_from = '2027-02-02'), 0::bigint);
select pg_temp.assert_eq('edit kept one trip', (select count(*) from core.trip where status = 'planned'), 1::bigint);

-- Checklist: solo él; Claude no.
select pg_temp.run_as('authenticated', $$api.set_trip_item((select id from core.trip where status = 'planned'), 'maleta', true)$$);
select pg_temp.assert_eq('checklist', (select checklist ->> 'maleta' from core.trip where status = 'planned'), 'true');
select pg_temp.run_as('authenticated', $$api.set_trip_item((select id from core.trip where status = 'planned'), 'maleta', false)$$);
select pg_temp.assert_eq('unchecked', (select checklist::text from core.trip where status = 'planned'), '{}');
select pg_temp.assert_fails('authenticated', $$select api.set_trip_item((select id from core.trip where status = 'planned'), 'Mal Clave', true)$$, '%invalid checklist key%');

select pg_temp.as_agent();
select pg_temp.assert_fails('authenticated', $$select api.set_trip_item((select id from core.trip where status = 'planned'), 'maleta', true)$$, '%agents cannot%');
select pg_temp.assert_fails('authenticated', $$select api.finish_trip((select id from core.trip where status = 'planned'))$$, '%agents cannot%');
-- Claude sí puede crear y cancelar (reversible), con su actor.
select pg_temp.run_as('authenticated', $$api.save_trip('{"kind":"visita","date_from":"2027-05-14","date_to":"2027-05-16","away_dates":["2027-05-14","2027-05-15","2027-05-16"]}'::jsonb, '33333333-3333-3333-3333-333333333310')$$);
select pg_temp.assert_eq('agent actor', (select actor from core.trip where request_id = '33333333-3333-3333-3333-333333333310'), 'agent:claude-test');
select pg_temp.run_as('authenticated', $$api.cancel_trip((select id from core.trip where request_id = '33333333-3333-3333-3333-333333333310'))$$);

-- Terminar el viaje (él): queda hecho y ya no se puede editar.
select pg_temp.as_owner();
select pg_temp.run_as('authenticated', $$api.finish_trip((select id from core.trip where status = 'planned'))$$);
select pg_temp.assert_eq('done', (select count(*) from core.trip where status = 'done'), 1::bigint);
select pg_temp.assert_fails('authenticated', $$select api.save_trip('{"kind":"espana","date_from":"2027-02-01","date_to":"2027-02-05"}'::jsonb, '33333333-3333-3333-3333-333333333302', (select id from core.trip where status = 'done'))$$, '%only a planned trip%');

-- Un desconocido ni lee ni escribe; anon nada; nada de DML directo.
select pg_temp.as_stranger();
select pg_temp.assert_eq('stranger reads nothing', pg_temp.run_as('authenticated', 'select count(*) from api.trips'), '0');
select pg_temp.assert_fails('authenticated', $$select api.save_trip('{"kind":"espana","date_from":"2027-06-01","date_to":"2027-06-02"}'::jsonb, '33333333-3333-3333-3333-333333333311')$$, '%not authorized%');
select pg_temp.assert_fails('authenticated', $$select api.cancel_trip(gen_random_uuid())$$, '%not authorized%');
select pg_temp.assert_fails('anon', 'select count(*) from api.trips', '%permission denied%');
select pg_temp.as_owner();
select pg_temp.assert_fails('authenticated', $$update core.trip set note = 'x'$$, '%permission denied%');
select pg_temp.assert_fails('authenticated', $$select core.trip_revert((select id from core.trip limit 1))$$, '%permission denied%');
-- La auditoría registra los cambios.
select pg_temp.assert_eq('audited', (select count(*) > 3 from ops.audit_log where action like 'trip.%'), true);
