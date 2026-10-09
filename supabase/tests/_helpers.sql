-- Funciones auxiliares de prueba (viven en el esquema temporal de la sesión).

-- Ejecuta una sentencia como `p_role` y devuelve su resultado como texto.
create function pg_temp.run_as(p_role text, p_stmt text) returns text
language plpgsql as
$$
declare
  v text;
begin
  execute format('set role %I', p_role);
  execute format('select (%s)::text', p_stmt) into v;
  reset role;
  return v;
exception when others then
  reset role;
  raise;
end
$$;

-- Comprueba que `p_stmt`, ejecutada como `p_role`, FALLA con un mensaje que cumple `p_pattern` (ILIKE).
create function pg_temp.assert_fails(p_role text, p_stmt text, p_pattern text) returns void
language plpgsql as
$$
declare
  v_failed boolean := false;
  v_msg text;
begin
  execute format('set role %I', p_role);
  begin
    execute p_stmt;
  exception when others then
    v_failed := true;
    v_msg := sqlerrm;
  end;
  reset role;
  if not v_failed then
    raise exception 'EXPECTED FAILURE but succeeded [% as %]', p_stmt, p_role;
  end if;
  if v_msg not ilike p_pattern then
    raise exception 'WRONG ERROR [% as %]: got "%", expected like "%"', p_stmt, p_role, v_msg, p_pattern;
  end if;
end
$$;

create function pg_temp.assert_eq(p_what text, p_actual anyelement, p_expected anyelement) returns void
language plpgsql as
$$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERT % failed: got %, expected %', p_what, p_actual, p_expected;
  end if;
end
$$;
