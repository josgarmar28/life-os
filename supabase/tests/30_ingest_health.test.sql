\ir _helpers.sql

do $$
declare
  v_e1 uuid;
  v_e2 uuid;
  v_e3 uuid;
  v_o1 uuid;
  v_o2 uuid;
  v_o3 uuid;
  v_n bigint;
begin
  -- Ingesta cruda: idempotente, versiona si cambia el contenido.
  v_e1 := pg_temp.run_as('ingest_writer', $q$raw.ingest_event('zepp_csv', 'row-1', '{"weight":78.4}'::jsonb)$q$)::uuid;
  v_e2 := pg_temp.run_as('ingest_writer', $q$raw.ingest_event('zepp_csv', 'row-1', '{"weight":78.4}'::jsonb)$q$)::uuid;
  perform pg_temp.assert_eq('ingest idempotent', v_e2, v_e1);
  v_e3 := pg_temp.run_as('ingest_writer', $q$raw.ingest_event('zepp_csv', 'row-1', '{"weight":78.9}'::jsonb)$q$)::uuid;
  if v_e3 = v_e1 then raise exception 'changed content must create a new version'; end if;
  select count(*) into v_n from raw.event where source = 'zepp_csv' and external_id = 'row-1';
  perform pg_temp.assert_eq('two versions', v_n, 2::bigint);

  perform pg_temp.assert_fails('agent_writer', $q$select raw.ingest_event('x','y','{}'::jsonb)$q$, '%permission denied%');
  perform pg_temp.assert_fails('ingest_writer', 'update raw.event set payload = ''{}''', '%permission denied%');
  begin
    update raw.event set payload = '{}';
    raise exception 'EXPECTED FAILURE: raw.event update succeeded';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;

  -- Observaciones: validación y calidad.
  v_o1 := pg_temp.run_as('ingest_writer', format(
    $q$health.record_observation('body_weight', 78.4, '2026-10-08 07:00+02', 'measured', 'zepp_csv', %L::uuid)$q$, v_e1))::uuid;
  v_o2 := pg_temp.run_as('ingest_writer', format(
    $q$health.record_observation('body_weight', 78.4, '2026-10-08 07:00+02', 'measured', 'zepp_csv', %L::uuid)$q$, v_e1))::uuid;
  perform pg_temp.assert_eq('observation idempotent', v_o2, v_o1);
  perform pg_temp.assert_fails('ingest_writer',
    $q$select health.record_observation('body_weight', 79.9, '2026-10-08 07:00+02', 'measured', 'zepp_csv')$q$,
    '%conflicting observation%');
  perform pg_temp.assert_fails('ingest_writer',
    $q$select health.record_observation('body_weight', 900, '2026-10-08 07:10+02', 'measured', 'zepp_csv')$q$,
    '%outside plausible range%');
  perform pg_temp.assert_fails('ingest_writer',
    $q$select health.record_observation('nope', 1, '2026-10-08 07:10+02', 'measured', 'zepp_csv')$q$,
    '%unknown metric%');
  perform pg_temp.assert_fails('ingest_writer',
    $q$select health.record_observation('body_weight', 78, now() + interval '1 day', 'measured', 'zepp_csv')$q$,
    '%in the future%');

  -- Corrección: nueva fila que sustituye a la anterior; la original se conserva.
  v_o3 := pg_temp.run_as('ingest_writer', format(
    $q$health.record_observation('body_weight', 78.9, '2026-10-08 07:00+02', 'measured', 'zepp_csv', null, %L::uuid)$q$, v_o1))::uuid;
  perform pg_temp.assert_eq('original kept', (select value from health.observation where id = v_o1), 78.4::numeric);
  perform pg_temp.assert_eq('correction links', (select supersedes_id from health.observation where id = v_o3), v_o1);
  perform pg_temp.assert_fails('ingest_writer',
    format($q$select health.record_observation('waist_circ', 80, '2026-10-08 07:00+02', 'manual', 'x', null, %L::uuid)$q$, v_o1),
    '%same metric%');

  -- Captura conversacional: puede ser manual o estimada, nunca medida.
  perform pg_temp.run_as('agent_writer',
    $q$health.record_manual_observation('waist_circ', 84.5, '2026-10-08 08:00+02')$q$);
  perform pg_temp.run_as('agent_writer',
    $q$health.record_manual_observation('body_weight', 78.0, '2026-10-09 07:00+02', 'estimated', 'photo_estimate')$q$);
  perform pg_temp.assert_fails('agent_writer',
    $q$select health.record_manual_observation('body_weight', 78, '2026-10-09 07:30+02', 'measured')$q$,
    '%cannot declare quality measured%');
  perform pg_temp.assert_fails('agent_writer',
    $q$select health.record_observation('body_weight', 78, '2026-10-09 07:30+02', 'manual', 'x')$q$,
    '%permission denied%');
  perform pg_temp.assert_fails('agent_writer', 'select health._record(''body_weight'', 78, now(), ''manual'', ''x'', null, null)', '%permission denied%');

  -- Inmutabilidad y lectura.
  begin
    delete from health.observation;
    raise exception 'EXPECTED FAILURE: observation delete succeeded';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  perform pg_temp.assert_eq('reader sees rows (via RLS policy)',
    (pg_temp.run_as('app_reader', 'select count(*) from health.observation'))::bigint > 0, true);
  perform pg_temp.assert_eq('agent reads via app_reader membership',
    (pg_temp.run_as('agent_writer', 'select count(*) from health.metric_def'))::bigint, 5::bigint);

  -- Errores a dead letter.
  perform pg_temp.run_as('ingest_writer', $q$ops.log_dead_letter('zepp_csv', '{"row":7}'::jsonb, 'bad date', 1)$q$);
  perform pg_temp.assert_fails('app_reader', 'select * from ops.dead_letter', '%permission denied%');
end
$$;
