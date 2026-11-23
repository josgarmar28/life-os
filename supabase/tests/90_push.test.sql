-- Avisos: solo el dueño se suscribe y cambia horarios; la función (service_role) decide qué avisar,
-- una vez al día y solo si falta algo; un desconocido, Claude o anon no tocan nada.
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

\set ep '''https://web.push.apple.com/QGxpZmVvcy10ZXN0'''
\set key '''BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'''

-- Suscribirse y ajustar horarios: el dueño sí.
select pg_temp.as_owner();
select pg_temp.run_as('authenticated', format($$api.save_push_subscription(%L, %L, 'BTBZMqHH6r4Tts7J_aSIgg', 'iPhone')$$, :ep, :key));
select pg_temp.run_as('authenticated', format($$api.save_push_subscription(%L, %L, 'BTBZMqHH6r4Tts7J_aSIgg', 'iPhone de nuevo')$$, :ep, :key));
select pg_temp.assert_eq('one subscription (upsert)', (select count(*) from core.push_subscription), 1::bigint);
select pg_temp.assert_eq('settings for owner', pg_temp.run_as('authenticated', $$(select jsonb_array_length(api.push_settings()->'subscriptions') || ' ' || (api.push_settings()->'reminders'->0->>'at'))$$), '1 05:30');
select pg_temp.assert_eq('no keys for owner', pg_temp.run_as('authenticated', $$(select coalesce(api.push_settings()->>'private_jwk', 'none'))$$), 'none');
select pg_temp.assert_fails('authenticated', $$select api.save_push_subscription('http://inseguro.example/x', 'a', 'b')$$, '%check%');
select pg_temp.run_as('authenticated', $$api.save_push_reminder('semana', true, '18:15', array[7, 7]::smallint[])$$);
select pg_temp.assert_eq('reminder saved', (select to_char(at_time, 'HH24:MI') || ' ' || days::text from core.push_reminder where key = 'semana'), '18:15 {7}');
select pg_temp.assert_fails('authenticated', $$select api.save_push_reminder('otro', true, '10:00', array[1]::smallint[])$$, '%not found%');
select pg_temp.assert_fails('authenticated', $$select api.save_push_reminder('dia', true, '10:00', array[8]::smallint[])$$, '%check%');

-- Claude, un desconocido y anon: nada.
select pg_temp.as_agent();
select pg_temp.assert_fails('authenticated', $$select api.push_settings()$$, '%agents cannot%');
select pg_temp.assert_fails('authenticated', $$select api.save_push_reminder('dia', false, '05:30', array[1]::smallint[])$$, '%agents cannot%');
select pg_temp.as_stranger();
select pg_temp.assert_fails('authenticated', $$select api.push_settings()$$, '%not authorized%');
select pg_temp.assert_fails('authenticated', $$select api.push_claim()$$, '%permission denied%');
select pg_temp.assert_fails('authenticated', $$select api.push_config()$$, '%permission denied%');
select pg_temp.assert_fails('anon', $$select api.push_settings()$$, '%permission denied%');
select pg_temp.assert_fails('authenticated', 'select count(*) from core.push_config', '%permission denied%');

-- La función guarda sus claves una sola vez.
select pg_temp.run_as('service_role', $$api.push_init('PUB1', '{"d":"x"}', 'https://ref.supabase.co/functions/v1/push', 'https://life-os.example')$$);
select pg_temp.run_as('service_role', $$api.push_init('PUB2', '{"d":"y"}', null, null)$$);
select pg_temp.assert_eq('keys kept', (select public_key || ' ' || (private_jwk->>'d') || ' ' || function_url || ' ' || site_url from core.push_config),
  'PUB1 x https://ref.supabase.co/functions/v1/push https://life-os.example');
select pg_temp.assert_eq('config lists subscriptions', pg_temp.run_as('service_role', $$(select jsonb_array_length(api.push_config()->'subscriptions'))$$), '1');

-- "Empezar el día": lunes 11-ene-2027 a las 05:35 en Zúrich, sin peso ni registro de mañana.
select pg_temp.assert_eq('nothing before 05:30', pg_temp.run_as('service_role', $$api.push_claim('2027-01-11 05:20+01')::text$$), '[]');
select pg_temp.assert_eq('morning reminder', pg_temp.run_as('service_role', $$(select x->>'body' from jsonb_array_elements(api.push_claim('2027-01-11 05:35+01')) x)$$),
  'Falta: Peso y Registro de mañana.');
select pg_temp.assert_eq('once a day', pg_temp.run_as('service_role', $$api.push_claim('2027-01-11 05:40+01')::text$$), '[]');

-- Al día siguiente, con el peso ya registrado, solo falta el registro de mañana.
insert into core.entry (form_id, occurred_at, local_date, data, source, quality, actor, request_id)
select f.id, '2027-01-12 05:10+01', '2027-01-12', '{"peso": 77.8}', 'dashboard', 'manual', 'owner', gen_random_uuid()
  from core.form f join core.area a on a.id = f.area_id where a.slug = 'cuerpo' and f.slug = 'peso';
select pg_temp.assert_eq('only what is missing', pg_temp.run_as('service_role', $$(select x->>'body' from jsonb_array_elements(api.push_claim('2027-01-12 06:00+01')) x)$$),
  'Falta: Registro de mañana.');
-- Fuera de la ventana de 2 h ya no avisa.
select pg_temp.assert_eq('late tick', pg_temp.run_as('service_role', $$api.push_claim('2027-01-13 08:00+01')::text$$), '[]');

-- Revisión semanal: domingo a la hora elegida; desactivada, nada.
select pg_temp.assert_eq('weekly review', pg_temp.run_as('service_role', $$(select string_agg(x->>'title' || ' ' || (x->>'url'), ',') from jsonb_array_elements(api.push_claim('2027-01-17 18:20+01')) x)$$),
  'Revisión semanal /semana');
update core.push_reminder set enabled = false where key = 'semana';
select pg_temp.assert_eq('disabled', pg_temp.run_as('service_role', $$api.push_claim('2027-01-24 18:20+01')::text$$), '[]');

-- Un navegador dado de baja se borra; un envío correcto queda anotado.
select pg_temp.run_as('service_role', format($$api.push_report(%L, 201, false)$$, :ep));
select pg_temp.assert_eq('ok noted', (select (last_ok_at is not null)::text from core.push_subscription), 'true');
select pg_temp.run_as('service_role', format($$api.push_report(%L, 410, true)$$, :ep));
select pg_temp.assert_eq('gone removed', (select count(*) from core.push_subscription), 0::bigint);

-- Sin suscripciones, el reloj no llama a nadie (y en las pruebas no hay pg_net).
select core.push_tick();
