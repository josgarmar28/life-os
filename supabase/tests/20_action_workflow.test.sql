\ir _helpers.sql

do $$
declare
  v_run uuid;
  v_p uuid;
  v_p_again uuid;
  v_p_rej uuid;
  v_p_exp uuid;
  v_p_l3 uuid;
  v_ex uuid;
  v_ex_again uuid;
  v_n bigint;
begin
  v_run := pg_temp.run_as('agent_writer', $q$ops.start_run('daily_brief:2026-10-09', 'daily_brief', 'coordinator')$q$)::uuid;
  -- start_run es idempotente
  perform pg_temp.assert_eq('start_run idempotent',
    pg_temp.run_as('agent_writer', $q$ops.start_run('daily_brief:2026-10-09', 'daily_brief', 'coordinator')$q$)::uuid, v_run);

  -- El agente propone; el nivel sale del catálogo, no del cliente.
  v_p := pg_temp.run_as('agent_writer', format(
    $q$ops.create_proposal(%L::uuid, 'calendar.create_event', '{"title":"Gym"}'::jsonb, 'cal:gym:1', now() + interval '3 days')$q$, v_run))::uuid;
  perform pg_temp.assert_eq('level from catalog', (select level from ops.action_proposal where id = v_p), 2::smallint);
  perform pg_temp.assert_eq('hash set by server', (select length(payload_hash) from ops.action_proposal where id = v_p), 64);

  -- Reintento idéntico => misma propuesta; contenido distinto con la misma clave => error.
  v_p_again := pg_temp.run_as('agent_writer', format(
    $q$ops.create_proposal(%L::uuid, 'calendar.create_event', '{"title":"Gym"}'::jsonb, 'cal:gym:1', now() + interval '3 days')$q$, v_run))::uuid;
  perform pg_temp.assert_eq('proposal idempotent', v_p_again, v_p);
  perform pg_temp.assert_fails('agent_writer', format(
    $q$select ops.create_proposal(%L::uuid, 'calendar.create_event', '{"title":"Otro"}'::jsonb, 'cal:gym:1', now() + interval '3 days')$q$, v_run),
    '%already used with different content%');

  -- Catálogo: acción desconocida o no catalogada.
  perform pg_temp.assert_fails('agent_writer', format(
    $q$select ops.create_proposal(%L::uuid, 'finance.transfer', '{}'::jsonb, 'fin:1', now() + interval '1 day')$q$, v_run),
    '%unknown action_type%');

  -- El agente no puede escribir directamente, ni leer aprobaciones, ni aprobar, ni ejecutar.
  perform pg_temp.assert_fails('agent_writer',
    $q$insert into ops.action_proposal(run_id,action_type,level,payload,payload_hash,idempotency_key,expires_at)
       values (gen_random_uuid(),'calendar.create_event',0,'{}','x','k',now())$q$, '%permission denied%');
  perform pg_temp.assert_fails('agent_writer', 'select * from ops.approval', '%permission denied%');
  perform pg_temp.assert_fails('agent_writer', format($q$select ops.decide_proposal(%L::uuid, 'approve', 'agent')$q$, v_p), '%permission denied%');
  perform pg_temp.assert_fails('agent_writer', format($q$select ops.claim_execution(%L::uuid)$q$, v_p), '%permission denied%');
  perform pg_temp.assert_fails('agent_writer', 'update ops.action_proposal set status = ''approved''', '%permission denied%');

  -- El aprobador no crea propuestas ni ejecuta.
  perform pg_temp.assert_fails('approver', format(
    $q$select ops.create_proposal(%L::uuid, 'calendar.create_event', '{}'::jsonb, 'k2', now() + interval '1 day')$q$, v_run), '%permission denied%');
  perform pg_temp.assert_fails('approver', format($q$select ops.claim_execution(%L::uuid)$q$, v_p), '%permission denied%');

  -- El ejecutor no puede ejecutar algo sin aprobar.
  perform pg_temp.assert_fails('executor', format($q$select ops.claim_execution(%L::uuid)$q$, v_p), '%is not approved%');
  perform pg_temp.assert_fails('executor', format($q$select ops.decide_proposal(%L::uuid, 'approve', 'exec')$q$, v_p), '%permission denied%');

  -- Aprobación humana.
  perform pg_temp.assert_eq('approve', pg_temp.run_as('approver', format($q$ops.decide_proposal(%L::uuid, 'approve', 'martagon')$q$, v_p)), 'approved');
  perform pg_temp.assert_fails('approver', format($q$select ops.decide_proposal(%L::uuid, 'approve', 'martagon')$q$, v_p), '%already decided%');
  perform pg_temp.assert_eq('approval bound to hash',
    (select a.payload_hash = p.payload_hash from ops.approval a join ops.action_proposal p on p.id = a.proposal_id where p.id = v_p), true);

  -- El contenido es inmutable tras proponer/aprobar.
  begin
    update ops.action_proposal set payload = '{"title":"Alterado"}' where id = v_p;
    raise exception 'EXPECTED FAILURE: payload update succeeded';
  exception when others then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;

  -- Ejecución idempotente.
  v_ex := pg_temp.run_as('executor', format($q$ops.claim_execution(%L::uuid)$q$, v_p))::uuid;
  v_ex_again := pg_temp.run_as('executor', format($q$ops.claim_execution(%L::uuid)$q$, v_p))::uuid;
  perform pg_temp.assert_eq('claim idempotent', v_ex_again, v_ex);
  perform pg_temp.run_as('executor', format($q$ops.finish_execution(%L::uuid, 'succeeded', '{"event_id":"abc"}'::jsonb)$q$, v_ex));
  perform pg_temp.assert_eq('proposal executed', (select status from ops.action_proposal where id = v_p), 'executed');
  perform pg_temp.assert_fails('executor', format($q$select ops.finish_execution(%L::uuid, 'failed')$q$, v_ex), '%final%');

  -- Rechazo => no ejecutable.
  v_p_rej := pg_temp.run_as('agent_writer', format(
    $q$ops.create_proposal(%L::uuid, 'training.change_plan', '{"change":"x"}'::jsonb, 'tr:1', now() + interval '3 days')$q$, v_run))::uuid;
  perform pg_temp.assert_eq('reject', pg_temp.run_as('approver', format($q$ops.decide_proposal(%L::uuid, 'reject', 'martagon')$q$, v_p_rej)), 'rejected');
  perform pg_temp.assert_fails('executor', format($q$select ops.claim_execution(%L::uuid)$q$, v_p_rej), '%is not approved%');

  -- Caducada => no aprobable ni ejecutable.
  v_p_exp := pg_temp.run_as('agent_writer', format(
    $q$ops.create_proposal(%L::uuid, 'habit.change', '{"habit":"x"}'::jsonb, 'hb:1', now() - interval '1 hour')$q$, v_run))::uuid;
  perform pg_temp.assert_eq('expired on decide', pg_temp.run_as('approver', format($q$ops.decide_proposal(%L::uuid, 'approve', 'martagon')$q$, v_p_exp)), 'expired');
  perform pg_temp.assert_eq('status expired', (select status from ops.action_proposal where id = v_p_exp), 'expired');
  perform pg_temp.assert_fails('executor', format($q$select ops.claim_execution(%L::uuid)$q$, v_p_exp), '%is not approved%');

  -- Nivel 3: exige confirmación reforzada.
  v_p_l3 := pg_temp.run_as('agent_writer', format(
    $q$ops.create_proposal(%L::uuid, 'data.erase_range', '{"from":"2026-01-01"}'::jsonb, 'erase:1', now() + interval '3 days')$q$, v_run))::uuid;
  perform pg_temp.assert_eq('level 3', (select level from ops.action_proposal where id = v_p_l3), 3::smallint);
  perform pg_temp.assert_fails('approver', format($q$select ops.decide_proposal(%L::uuid, 'approve', 'martagon')$q$, v_p_l3), '%reinforced%');
  perform pg_temp.assert_eq('l3 reinforced', pg_temp.run_as('approver', format($q$ops.decide_proposal(%L::uuid, 'approve', 'martagon', true)$q$, v_p_l3)), 'approved');

  -- expire_proposals marca las vigentes pasadas de fecha y sin ejecución.
  v_n := (pg_temp.run_as('executor', 'ops.expire_proposals()'))::bigint;
  perform pg_temp.assert_eq('expire_proposals does not touch executed', (select status from ops.action_proposal where id = v_p), 'executed');

  -- Auditoría: existe y es de solo inserción incluso para el propietario.
  select count(*) into v_n from ops.audit_log;
  if v_n < 8 then raise exception 'audit_log too small: %', v_n; end if;
  begin
    update ops.audit_log set action = 'X';
    raise exception 'EXPECTED FAILURE: audit update succeeded';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    delete from ops.audit_log;
    raise exception 'EXPECTED FAILURE: audit delete succeeded';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    truncate ops.audit_log;
    raise exception 'EXPECTED FAILURE: audit truncate succeeded';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  -- El payload no se copia al log.
  select count(*) into v_n from ops.audit_log where detail ? 'payload';
  perform pg_temp.assert_eq('audit excludes payload', v_n, 0::bigint);

  -- Cierre de la run.
  perform pg_temp.run_as('agent_writer', format($q$ops.finish_run(%L::uuid, 'succeeded', 'sonnet', 'coordinator@0.0.0', 100, 50, 0.0007, null)$q$, v_run));
  perform pg_temp.assert_fails('agent_writer', format($q$select ops.finish_run(%L::uuid, 'failed')$q$, v_run), '%already finished%');
end
$$;
