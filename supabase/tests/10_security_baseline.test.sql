\ir _helpers.sql

-- RLS activado en todas las tablas de los esquemas de LIFE OS.
do $$
declare
  v_missing text;
begin
  select string_agg(n.nspname || '.' || c.relname, ', ') into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p')
     and n.nspname in ('raw', 'core', 'health', 'training', 'nutrition', 'body', 'knowledge', 'ops')
     and not c.relrowsecurity;
  if v_missing is not null then
    raise exception 'RLS disabled on: %', v_missing;
  end if;
end
$$;

-- Los roles de la API pública de Supabase no ven nada.
select pg_temp.assert_fails('anon', 'select * from ops.action_proposal', '%permission denied%');
select pg_temp.assert_fails('authenticated', 'select * from ops.action_proposal', '%permission denied%');
select pg_temp.assert_fails('authenticated', 'select * from health.observation', '%permission denied%');
select pg_temp.assert_fails('authenticated', 'select * from raw.event', '%permission denied%');
select pg_temp.assert_fails('authenticated', 'select ops.expire_proposals()', '%permission denied%');

-- Ninguna función concedida a PUBLIC en nuestros esquemas.
do $$
declare
  v text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ') into v
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('raw', 'health', 'ops')
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('public', p.oid, 'execute');
  if v is not null then
    raise exception 'functions executable by PUBLIC: %', v;
  end if;
end
$$;

-- Lectura por rol: app_reader no ve aprobaciones ni datos crudos.
select pg_temp.assert_fails('app_reader', 'select * from ops.approval', '%permission denied%');
select pg_temp.assert_fails('app_reader', 'select * from raw.event', '%permission denied%');
select pg_temp.assert_fails('app_reader', 'insert into health.observation(metric_id,value,measured_at,quality,source) values (''body_weight'',70,now(),''manual'',''x'')', '%permission denied%');
