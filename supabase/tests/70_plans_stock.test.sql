-- Planes versionados, semana, despensa y pedidos.
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

-- Planes: el dueño guarda versiones; la forma mínima se comprueba.
select pg_temp.as_owner();
select pg_temp.run_as('authenticated', $$api.save_plan('training', 'Rutina A', '2027-01-11', '{"days":[]}')$$);
select pg_temp.run_as('authenticated', $$api.save_plan('training', 'Rutina B', '2027-02-01', '{"days":[{"weekday":1}]}')$$);
select pg_temp.assert_eq('versions', (select string_agg(version::text || ':' || name, ',' order by version) from core.plan where kind = 'training'), '1:Rutina A,2:Rutina B');
select pg_temp.assert_eq('source', (select source from core.plan where version = 2 and kind = 'training'), 'dashboard');
select pg_temp.assert_fails('authenticated', $$select api.save_plan('meals', 'Menú', '2027-01-10', '{"products":[]}')$$, '%needs an array "recipes"%');
select pg_temp.assert_fails('authenticated', $$select api.save_plan('otro', 'X', '2027-01-10', '{}')$$, '%plan_kind_check%');
select pg_temp.assert_fails('authenticated', $$update core.plan set name = 'x'$$, '%permission denied%');

-- Contenido inmutable; archivar sí.
select pg_temp.run_as('authenticated', $$api.set_plan_status((select id from api.plans where kind = 'training' and version = 1), 'archived')$$);
select pg_temp.assert_eq('archived', (select status::text from core.plan where kind = 'training' and version = 1), 'archived');
do $$ begin
  update core.plan set content = '{"days":[1]}' where kind = 'training' and version = 2;
  raise exception 'should have failed';
exception when others then
  if sqlerrm not like '%immutable%' then raise; end if;
end $$;

-- Claude no guarda planes directamente: los propone y el dueño aprueba.
select pg_temp.as_agent();
select pg_temp.assert_fails('authenticated', $$select api.save_plan('schedule', 'Horario', '2027-01-11', '{"blocks":[]}')$$, '%agents cannot do this directly%');
create temp table t_prop as select pg_temp.run_as('authenticated',
  $$api.create_proposal('plan.save', '{"kind":"schedule","name":"Horario","valid_from":"2027-01-11","content":{"blocks":[{"start":"06:00","title":"Gym"}]}}', 'horario de enero')$$)::uuid as id;
grant select on t_prop to authenticated;
select pg_temp.as_owner();
select pg_temp.assert_eq('plan proposal applied',
  pg_temp.run_as('authenticated', $$api.decide_proposal((select id from t_prop), true, (select payload_hash from api.proposals where id = (select id from t_prop)))::text$$)::jsonb ->> 'status', 'applied');
select pg_temp.assert_eq('plan from claude', (select source || ':' || name from core.plan where kind = 'schedule'), 'claude:Horario');

-- Semana: lunes obligatorio; Claude puede anotarla.
select pg_temp.as_agent();
select pg_temp.run_as('authenticated', $$api.save_week('2027-01-11', '{5,3,5}', '{7,6}', 'fin de semana fuera')$$);
select pg_temp.assert_eq('week (ordenada, sin repetir)', (select telework::text || away::text from core.week_plan where week_start = '2027-01-11'), '{3,5}{6,7}');
select pg_temp.assert_fails('authenticated', $$select api.save_week('2027-01-12', '{3}', '{}')$$, '%week_plan_week_start_check%');

-- Despensa: idempotente, solo inserción, valores válidos.
select pg_temp.as_owner();
select pg_temp.assert_eq('stock moves',
  pg_temp.run_as('authenticated', $$api.record_stock('[{"product":"tofu","kind":"count","qty":600},{"product":"arroz","kind":"purchase","qty":1000}]', '00000000-0000-0000-0000-0000000000a1')$$), '2');
select pg_temp.assert_eq('idempotent',
  pg_temp.run_as('authenticated', $$api.record_stock('[{"product":"tofu","kind":"count","qty":999}]', '00000000-0000-0000-0000-0000000000a1')$$), '2');
select pg_temp.assert_eq('two rows', (select count(*) from core.stock_move), 2::bigint);
select pg_temp.assert_fails('authenticated', $$select api.record_stock('[{"product":"tofu","kind":"count","qty":-1}]', gen_random_uuid())$$, '%stock_move_check%');
select pg_temp.assert_fails('authenticated', $$select api.record_stock('[{"product":"Tofu Bio","kind":"count","qty":1}]', gen_random_uuid())$$, '%stock_move_product_check%');
select pg_temp.assert_fails('authenticated', $$select api.record_stock('[{"product":"tofu","kind":"robo","qty":1}]', gen_random_uuid())$$, '%stock_move_kind_check%');
do $$ begin
  update core.stock_move set qty = 1;
  raise exception 'should have failed';
exception when others then
  if sqlerrm not like '%not allowed%' then raise; end if;
end $$;

-- Pedido: se hace, se recibe parcialmente y entra como compra; no se recibe dos veces.
create temp table t_order as select pg_temp.run_as('authenticated',
  $$api.save_order('2027-01-14', '[{"product":"tofu","packages":2,"amount":600,"price":2.3},{"product":"yogur","packages":8,"amount":1440,"price":0.5}]', '00000000-0000-0000-0000-0000000000b1', 8.6)$$)::uuid as id;
grant select on t_order to authenticated;
select pg_temp.assert_eq('received moves',
  pg_temp.run_as('authenticated', $$api.receive_order((select id from t_order), '[{"product":"tofu","packages":2,"amount":600},{"product":"yogur","packages":0,"amount":0}]', '00000000-0000-0000-0000-0000000000b2')$$), '1');
select pg_temp.assert_eq('order received', (select status from core.shopping_order), 'received');
select pg_temp.assert_eq('purchase', (select qty from core.stock_move where request_id = '00000000-0000-0000-0000-0000000000b2'), 600::numeric);
select pg_temp.assert_fails('authenticated', $$select api.receive_order((select id from t_order), '[{"product":"tofu","packages":1,"amount":300}]', gen_random_uuid())$$, '%already closed%');
select pg_temp.assert_fails('authenticated', $$select api.cancel_order((select id from t_order))$$, '%already closed%');
select pg_temp.assert_fails('authenticated', $$select api.save_order('2027-01-14', '[{"product":"tofu","packages":0,"amount":0}]', gen_random_uuid())$$, '%packages > 0%');

-- Un desconocido no lee ni escribe nada.
select pg_temp.as_stranger();
select pg_temp.assert_eq('stranger plans', pg_temp.run_as('authenticated', 'select count(*) from api.plans'), '0');
select pg_temp.assert_eq('stranger stock', pg_temp.run_as('authenticated', 'select count(*) from api.stock_moves'), '0');
select pg_temp.assert_fails('authenticated', $$select api.record_stock('[{"product":"tofu","kind":"count","qty":1}]', gen_random_uuid())$$, '%not authorized%');
select pg_temp.assert_fails('authenticated', $$select api.save_week('2027-01-11', '{}', '{}')$$, '%not authorized%');

-- anon no ve nada.
select pg_temp.assert_fails('anon', 'select count(*) from api.plans', '%permission denied%');

-- Faltan cantidades: error claro.
select pg_temp.as_owner();
select pg_temp.assert_fails('authenticated', $$select api.save_order('2027-01-14', '[{"product":"tofu"}]', gen_random_uuid())$$, '%packages > 0%');
select pg_temp.assert_fails('authenticated', $$select api.record_stock('[{"product":"tofu","kind":"count"}]', gen_random_uuid())$$, '%numeric qty%');
