-- Solo para pruebas locales y CI: simula los roles que Supabase ya trae.
-- NUNCA se ejecuta contra Supabase (no está en supabase/migrations).
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role']
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end
$$;
