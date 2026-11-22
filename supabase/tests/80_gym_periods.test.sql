-- Periodos en otro gimnasio: sin solapes, editables y borrables por el dueño y por Claude.
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

select pg_temp.as_owner();
select pg_temp.run_as('authenticated', $$api.save_gym_period('la_zona', '2027-01-22', '2027-01-25', 'visita')$$);
select pg_temp.assert_eq('saved', pg_temp.run_as('authenticated', $$(select gym || ' ' || date_from || ' ' || date_to || ' ' || note from api.gym_periods)$$), 'la_zona 2027-01-22 2027-01-25 visita');
select pg_temp.assert_fails('authenticated', $$select api.save_gym_period('la_zona', '2027-01-25', '2027-01-27')$$, '%overlaps%');
select pg_temp.assert_fails('authenticated', $$select api.save_gym_period('la_zona', '2027-02-05', '2027-02-01')$$, '%gym_period_check%');
select pg_temp.assert_fails('authenticated', $$select api.save_gym_period('La Zona', '2027-02-01', '2027-02-02')$$, '%gym_period_gym_check%');

-- Editar el mismo periodo no choca consigo mismo; Claude puede registrar otro.
select pg_temp.run_as('authenticated', $$api.save_gym_period('la_zona', '2027-01-21', '2027-01-25', '', (select id from core.gym_period))$$);
select pg_temp.assert_eq('edited', (select date_from::text || note from core.gym_period), '2027-01-21');
select pg_temp.as_agent();
select pg_temp.run_as('authenticated', $$api.save_gym_period('la_zona', '2027-02-19', '2027-02-21')$$);
select pg_temp.assert_eq('two periods', (select count(*) from core.gym_period), 2::bigint);
select pg_temp.assert_eq('agent actor', (select count(*) from core.gym_period where actor <> 'owner'), 1::bigint);

-- Borrar; un desconocido ni lee ni escribe; anon nada.
select pg_temp.as_owner();
select pg_temp.run_as('authenticated', $$api.delete_gym_period((select id from core.gym_period where date_from = '2027-02-19'))$$);
select pg_temp.assert_eq('one left', (select count(*) from core.gym_period), 1::bigint);
select pg_temp.assert_fails('authenticated', $$select api.delete_gym_period(gen_random_uuid())$$, '%not found%');
select pg_temp.as_stranger();
select pg_temp.assert_eq('stranger reads nothing', pg_temp.run_as('authenticated', 'select count(*) from api.gym_periods'), '0');
select pg_temp.assert_fails('authenticated', $$select api.save_gym_period('la_zona', '2027-03-01', '2027-03-02')$$, '%not authorized%');
select pg_temp.assert_fails('anon', 'select count(*) from api.gym_periods', '%permission denied%');
