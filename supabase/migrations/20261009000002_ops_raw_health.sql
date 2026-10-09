-- LIFE OS · P0 · Tablas y funciones base: ops, raw, health
--
-- Modelo de permisos:
--  * Ningún rol de aplicación escribe directamente en tablas de ops.
--  * Las escrituras pasan por funciones SECURITY DEFINER con EXECUTE concedido
--    rol a rol (ver sección final).
--  * El nivel de una acción lo fija el catálogo (ops.action_catalog), nunca el cliente.
--  * El agente solo puede PROPONER; aprobar y ejecutar son roles distintos.
--  * Las tablas con efectos de seguridad son de solo inserción (triggers).

---------------------------------------------------------------------------
-- Utilidades
---------------------------------------------------------------------------

create function ops.deny_mutation() returns trigger
language plpgsql as
$$
begin
  raise exception '% on %.% is not allowed (append-only)',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'P0001';
end
$$;

---------------------------------------------------------------------------
-- ops: auditoría (solo inserción)
---------------------------------------------------------------------------

create table ops.audit_log (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  db_user    text not null default session_user,
  actor      text not null default coalesce(nullif(current_setting('app.actor', true), ''), session_user),
  action     text not null,
  table_name text not null,
  row_id     text,
  detail     jsonb not null default '{}'::jsonb
);
alter table ops.audit_log enable row level security;
create trigger audit_log_append_only before update or delete on ops.audit_log
  for each row execute function ops.deny_mutation();
create trigger audit_log_no_truncate before truncate on ops.audit_log
  for each statement execute function ops.deny_mutation();

-- Registra la fila sin el payload ni el resultado (pueden contener datos personales).
create function ops.audit_row() returns trigger
language plpgsql security definer set search_path = pg_catalog, ops as
$$
begin
  insert into ops.audit_log (action, table_name, row_id, detail)
  values (
    tg_op,
    tg_table_schema || '.' || tg_table_name,
    to_jsonb(new) ->> 'id',
    to_jsonb(new) - 'payload' - 'result'
  );
  return new;
end
$$;

---------------------------------------------------------------------------
-- ops: catálogo de acciones
---------------------------------------------------------------------------

create table ops.action_catalog (
  action_type               text primary key check (action_type <> ''),
  level                     smallint not null check (level between 0 and 3),
  needs_professional_review boolean not null default false,
  enabled                   boolean not null default true,
  description               text not null
);
alter table ops.action_catalog enable row level security;
comment on column ops.action_catalog.needs_professional_review is
  'Valor base. Los umbrales concretos por regla están pendientes de definir con el profesional.';

insert into ops.action_catalog (action_type, level, description) values
  ('calendar.create_event',  2, 'Crear evento en el calendario secundario LIFE OS'),
  ('calendar.update_event',  2, 'Modificar evento del calendario LIFE OS'),
  ('calendar.delete_event',  2, 'Borrar evento del calendario LIFE OS'),
  ('training.change_plan',   2, 'Modificar el plan de entrenamiento'),
  ('nutrition.change_plan',  2, 'Modificar el plan de alimentación'),
  ('habit.change',           2, 'Modificar un hábito'),
  ('rule.approve_evidence',  2, 'Aprobar o retirar una regla del registro de evidencia'),
  ('data.erase_range',       3, 'Borrar un rango de datos personales')
on conflict (action_type) do nothing;

---------------------------------------------------------------------------
-- ops: ejecuciones (runs)
---------------------------------------------------------------------------

create table ops.run (
  id               uuid primary key default gen_random_uuid(),
  run_key          text not null unique check (run_key <> ''),
  kind             text not null check (kind <> ''),
  actor            text not null check (actor <> ''),
  status           text not null default 'started' check (status in ('started', 'succeeded', 'failed')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  model            text,
  contract_version text,
  input_tokens     integer check (input_tokens >= 0),
  output_tokens    integer check (output_tokens >= 0),
  cost_usd         numeric(12, 6) check (cost_usd >= 0),
  error            text
);
alter table ops.run enable row level security;

-- Idempotente: la misma run_key devuelve la misma ejecución.
create function ops.start_run(p_run_key text, p_kind text, p_actor text) returns uuid
language plpgsql security definer set search_path = pg_catalog, ops as
$$
declare
  v_id uuid;
begin
  insert into ops.run (run_key, kind, actor)
  values (p_run_key, p_kind, p_actor)
  on conflict (run_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from ops.run where run_key = p_run_key;
  end if;
  return v_id;
end
$$;

create function ops.finish_run(
  p_run_id uuid, p_status text, p_model text default null, p_contract_version text default null,
  p_input_tokens integer default null, p_output_tokens integer default null,
  p_cost_usd numeric default null, p_error text default null
) returns void
language plpgsql security definer set search_path = pg_catalog, ops as
$$
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'invalid final status: %', p_status;
  end if;
  update ops.run
     set status = p_status, finished_at = now(), model = p_model, contract_version = p_contract_version,
         input_tokens = p_input_tokens, output_tokens = p_output_tokens, cost_usd = p_cost_usd, error = p_error
   where id = p_run_id and status = 'started';
  if not found then
    raise exception 'run % not found or already finished', p_run_id;
  end if;
end
$$;

---------------------------------------------------------------------------
-- ops: propuestas de acción
---------------------------------------------------------------------------

create table ops.action_proposal (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references ops.run (id),
  action_type     text not null references ops.action_catalog (action_type),
  level           smallint not null,
  payload         jsonb not null,
  payload_hash    text not null,
  idempotency_key text not null unique check (idempotency_key <> ''),
  status          text not null default 'proposed'
                  check (status in ('proposed', 'approved', 'rejected', 'expired', 'executed', 'failed')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  unique (id, payload_hash)
);
alter table ops.action_proposal enable row level security;

-- Nivel y hash los fija el servidor; el cliente no puede elegirlos.
create function ops.proposal_before_insert() returns trigger
language plpgsql security definer set search_path = pg_catalog, ops as
$$
declare
  v_level smallint;
  v_enabled boolean;
begin
  select level, enabled into v_level, v_enabled
    from ops.action_catalog where action_type = new.action_type;
  if not found then
    raise exception 'unknown action_type: %', new.action_type;
  end if;
  if not v_enabled then
    raise exception 'action_type disabled: %', new.action_type;
  end if;
  new.level := v_level;
  new.payload_hash := encode(sha256(convert_to(new.payload::text, 'UTF8')), 'hex');
  new.status := 'proposed';
  return new;
end
$$;
create trigger proposal_before_insert before insert on ops.action_proposal
  for each row execute function ops.proposal_before_insert();

-- Solo cambia el estado; el contenido es inmutable.
create function ops.proposal_before_update() returns trigger
language plpgsql as
$$
begin
  if (new.id, new.run_id, new.action_type, new.level, new.payload, new.payload_hash,
      new.idempotency_key, new.created_at, new.expires_at)
     is distinct from
     (old.id, old.run_id, old.action_type, old.level, old.payload, old.payload_hash,
      old.idempotency_key, old.created_at, old.expires_at) then
    raise exception 'action_proposal content is immutable (only status may change)';
  end if;
  return new;
end
$$;
create trigger proposal_before_update before update on ops.action_proposal
  for each row execute function ops.proposal_before_update();
create trigger proposal_no_delete before delete on ops.action_proposal
  for each row execute function ops.deny_mutation();
create trigger proposal_no_truncate before truncate on ops.action_proposal
  for each statement execute function ops.deny_mutation();
create trigger proposal_audit after insert or update on ops.action_proposal
  for each row execute function ops.audit_row();

create function ops.create_proposal(
  p_run_id uuid, p_action_type text, p_payload jsonb, p_idempotency_key text, p_expires_at timestamptz
) returns uuid
language plpgsql security definer set search_path = pg_catalog, ops as
$$
declare
  v_id uuid;
  v_hash text;
begin
  insert into ops.action_proposal (run_id, action_type, level, payload, payload_hash, idempotency_key, expires_at)
  values (p_run_id, p_action_type, 0, p_payload, '', p_idempotency_key, p_expires_at)
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- Reintento: solo es válido si el contenido es idéntico.
    v_hash := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
    select id into v_id from ops.action_proposal
     where idempotency_key = p_idempotency_key and payload_hash = v_hash and action_type = p_action_type;
    if v_id is null then
      raise exception 'idempotency_key % already used with different content', p_idempotency_key;
    end if;
  end if;
  return v_id;
end
$$;

---------------------------------------------------------------------------
-- ops: aprobaciones (solo inserción, una por propuesta, ligadas al hash)
---------------------------------------------------------------------------

create table ops.approval (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null unique,
  payload_hash text not null,
  decision     text not null check (decision in ('approve', 'reject')),
  decided_by   text not null check (decided_by <> ''),
  reinforced   boolean not null default false,
  decided_at   timestamptz not null default now(),
  foreign key (proposal_id, payload_hash) references ops.action_proposal (id, payload_hash)
);
alter table ops.approval enable row level security;
create trigger approval_append_only before update or delete on ops.approval
  for each row execute function ops.deny_mutation();
create trigger approval_no_truncate before truncate on ops.approval
  for each statement execute function ops.deny_mutation();
create trigger approval_audit after insert on ops.approval
  for each row execute function ops.audit_row();

-- Devuelve 'approved' | 'rejected' | 'expired'.
create function ops.decide_proposal(
  p_proposal_id uuid, p_decision text, p_decided_by text, p_reinforced boolean default false
) returns text
language plpgsql security definer set search_path = pg_catalog, ops as
$$
declare
  v_prop ops.action_proposal%rowtype;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  select * into v_prop from ops.action_proposal where id = p_proposal_id for update;
  if not found then
    raise exception 'proposal % not found', p_proposal_id;
  end if;
  if v_prop.status <> 'proposed' then
    raise exception 'proposal % already decided (status %)', p_proposal_id, v_prop.status;
  end if;

  if v_prop.expires_at < now() then
    update ops.action_proposal set status = 'expired' where id = p_proposal_id;
    return 'expired';
  end if;

  if p_decision = 'approve' and v_prop.level >= 3 and not p_reinforced then
    raise exception 'level 3 actions require reinforced confirmation';
  end if;

  insert into ops.approval (proposal_id, payload_hash, decision, decided_by, reinforced)
  values (p_proposal_id, v_prop.payload_hash, p_decision, p_decided_by, p_reinforced);

  update ops.action_proposal
     set status = case p_decision when 'approve' then 'approved' else 'rejected' end
   where id = p_proposal_id;

  return case p_decision when 'approve' then 'approved' else 'rejected' end;
end
$$;

---------------------------------------------------------------------------
-- ops: ejecuciones de acciones
---------------------------------------------------------------------------

create table ops.action_execution (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null unique references ops.action_proposal (id),
  approval_id     uuid not null references ops.approval (id),
  idempotency_key text not null unique,
  status          text not null default 'started' check (status in ('started', 'succeeded', 'failed')),
  result          jsonb,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);
alter table ops.action_execution enable row level security;

create function ops.execution_before_update() returns trigger
language plpgsql as
$$
begin
  if old.status <> 'started' then
    raise exception 'action_execution is final once %', old.status;
  end if;
  if (new.id, new.proposal_id, new.approval_id, new.idempotency_key, new.started_at)
     is distinct from
     (old.id, old.proposal_id, old.approval_id, old.idempotency_key, old.started_at) then
    raise exception 'action_execution identity columns are immutable';
  end if;
  return new;
end
$$;
create trigger execution_before_update before update on ops.action_execution
  for each row execute function ops.execution_before_update();
create trigger execution_no_delete before delete on ops.action_execution
  for each row execute function ops.deny_mutation();
create trigger execution_no_truncate before truncate on ops.action_execution
  for each statement execute function ops.deny_mutation();
create trigger execution_audit after insert or update on ops.action_execution
  for each row execute function ops.audit_row();

-- Reclama la ejecución de una propuesta aprobada y vigente. Idempotente.
create function ops.claim_execution(p_proposal_id uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, ops as
$$
declare
  v_prop ops.action_proposal%rowtype;
  v_appr ops.approval%rowtype;
  v_id uuid;
begin
  select * into v_prop from ops.action_proposal where id = p_proposal_id for update;
  if not found then
    raise exception 'proposal % not found', p_proposal_id;
  end if;

  -- Reintento del ejecutor: devuelve la ejecución existente.
  select id into v_id from ops.action_execution where proposal_id = p_proposal_id;
  if v_id is not null then
    return v_id;
  end if;

  select * into v_appr from ops.approval where proposal_id = p_proposal_id;
  if not found or v_appr.decision <> 'approve' or v_prop.status <> 'approved' then
    raise exception 'proposal % is not approved', p_proposal_id;
  end if;
  if v_appr.payload_hash <> v_prop.payload_hash then
    raise exception 'proposal % changed after approval', p_proposal_id;
  end if;
  if v_prop.expires_at < now() then
    raise exception 'proposal % has expired', p_proposal_id;
  end if;

  insert into ops.action_execution (proposal_id, approval_id, idempotency_key)
  values (p_proposal_id, v_appr.id, 'exec:' || v_prop.idempotency_key)
  returning id into v_id;
  return v_id;
end
$$;

create function ops.finish_execution(p_execution_id uuid, p_status text, p_result jsonb default null)
returns void
language plpgsql security definer set search_path = pg_catalog, ops as
$$
declare
  v_proposal_id uuid;
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'invalid final status: %', p_status;
  end if;
  update ops.action_execution
     set status = p_status, result = p_result, finished_at = now()
   where id = p_execution_id
  returning proposal_id into v_proposal_id;
  if not found then
    raise exception 'execution % not found', p_execution_id;
  end if;
  update ops.action_proposal
     set status = case p_status when 'succeeded' then 'executed' else 'failed' end
   where id = v_proposal_id;
end
$$;

-- Marca como caducadas las propuestas vigentes pasadas de fecha sin ejecución.
create function ops.expire_proposals() returns integer
language plpgsql security definer set search_path = pg_catalog, ops as
$$
declare
  v_n integer;
begin
  update ops.action_proposal p
     set status = 'expired'
   where p.status in ('proposed', 'approved')
     and p.expires_at < now()
     and not exists (select 1 from ops.action_execution e where e.proposal_id = p.id);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

---------------------------------------------------------------------------
-- ops: errores
---------------------------------------------------------------------------

create table ops.dead_letter (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  source      text not null check (source <> ''),
  payload     jsonb not null,
  error       text not null,
  attempts    integer not null default 1 check (attempts >= 1),
  resolved_at timestamptz
);
alter table ops.dead_letter enable row level security;

create function ops.log_dead_letter(p_source text, p_payload jsonb, p_error text, p_attempts integer default 1)
returns uuid
language plpgsql security definer set search_path = pg_catalog, ops as
$$
declare
  v_id uuid;
begin
  insert into ops.dead_letter (source, payload, error, attempts)
  values (p_source, p_payload, p_error, p_attempts)
  returning id into v_id;
  return v_id;
end
$$;

---------------------------------------------------------------------------
-- raw: datos originales (inmutables, deduplicados)
---------------------------------------------------------------------------

create table raw.event (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source <> ''),
  external_id  text not null check (external_id <> ''),
  payload      jsonb not null,
  content_hash text not null,
  received_at  timestamptz not null default now(),
  unique (source, external_id, content_hash)
);
alter table raw.event enable row level security;
create trigger raw_event_append_only before update or delete on raw.event
  for each row execute function ops.deny_mutation();
create trigger raw_event_no_truncate before truncate on raw.event
  for each statement execute function ops.deny_mutation();

-- Mismo (fuente, id, contenido) => misma fila. Contenido distinto => versión nueva.
create function raw.ingest_event(p_source text, p_external_id text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = pg_catalog, raw as
$$
declare
  v_hash text := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  v_id uuid;
begin
  insert into raw.event (source, external_id, payload, content_hash)
  values (p_source, p_external_id, p_payload, v_hash)
  on conflict (source, external_id, content_hash) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from raw.event
     where source = p_source and external_id = p_external_id and content_hash = v_hash;
  end if;
  return v_id;
end
$$;

---------------------------------------------------------------------------
-- health: catálogo de métricas y observaciones
---------------------------------------------------------------------------

create table health.metric_def (
  id            text primary key check (id <> ''),
  unit          text not null,
  plausible_min numeric not null,
  plausible_max numeric not null,
  description   text not null,
  check (plausible_min < plausible_max)
);
alter table health.metric_def enable row level security;

-- Rangos plausibles amplios, solo para detectar errores de captura (no son límites clínicos).
insert into health.metric_def (id, unit, plausible_min, plausible_max, description) values
  ('body_weight',    'kg',    20,   400,   'Peso corporal'),
  ('waist_circ',     'cm',    30,   250,   'Perímetro de cintura'),
  ('resting_hr',     'bpm',   25,   140,   'Frecuencia cardíaca en reposo'),
  ('sleep_duration', 'h',      0,    24,   'Duración del sueño'),
  ('steps',          'count',  0, 150000,  'Pasos diarios')
on conflict (id) do nothing;

create type health.quality as enum ('measured', 'manual', 'estimated');

create table health.observation (
  id            uuid primary key default gen_random_uuid(),
  metric_id     text not null references health.metric_def (id),
  value         numeric not null check (value <> 'NaN'::numeric),
  measured_at   timestamptz not null,
  quality       health.quality not null,
  source        text not null check (source <> ''),
  raw_event_id  uuid references raw.event (id),
  supersedes_id uuid references health.observation (id),
  created_at    timestamptz not null default now()
);
alter table health.observation enable row level security;
create index observation_metric_time_idx on health.observation (metric_id, measured_at desc);
create unique index observation_dedupe_idx on health.observation
  (metric_id, measured_at, source, coalesce(supersedes_id, '00000000-0000-0000-0000-000000000000'::uuid));
create trigger observation_append_only before update or delete on health.observation
  for each row execute function ops.deny_mutation();
create trigger observation_no_truncate before truncate on health.observation
  for each statement execute function ops.deny_mutation();

-- Núcleo compartido. No se concede a ningún rol: lo llaman las dos funciones públicas.
create function health._record(
  p_metric_id text, p_value numeric, p_measured_at timestamptz, p_quality health.quality,
  p_source text, p_raw_event_id uuid, p_supersedes_id uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, health as
$$
declare
  v_def health.metric_def%rowtype;
  v_id uuid;
  v_existing health.observation%rowtype;
  v_old_metric text;
begin
  select * into v_def from health.metric_def where id = p_metric_id;
  if not found then
    raise exception 'unknown metric: %', p_metric_id;
  end if;
  if p_value < v_def.plausible_min or p_value > v_def.plausible_max then
    raise exception 'value % outside plausible range [%, %] % for %',
      p_value, v_def.plausible_min, v_def.plausible_max, v_def.unit, p_metric_id;
  end if;
  if p_measured_at > now() + interval '5 minutes' then
    raise exception 'measured_at is in the future';
  end if;
  if p_supersedes_id is not null then
    select metric_id into v_old_metric from health.observation where id = p_supersedes_id;
    if v_old_metric is null or v_old_metric <> p_metric_id then
      raise exception 'supersedes_id must reference an observation of the same metric';
    end if;
  end if;

  insert into health.observation (metric_id, value, measured_at, quality, source, raw_event_id, supersedes_id)
  values (p_metric_id, p_value, p_measured_at, p_quality, p_source, p_raw_event_id, p_supersedes_id)
  on conflict (metric_id, measured_at, source, coalesce(supersedes_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_existing from health.observation
     where metric_id = p_metric_id and measured_at = p_measured_at and source = p_source
       and coalesce(supersedes_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_supersedes_id, '00000000-0000-0000-0000-000000000000'::uuid);
    if v_existing.value <> p_value or v_existing.quality <> p_quality then
      raise exception 'conflicting observation already exists; use supersedes_id to correct it';
    end if;
    v_id := v_existing.id;
  end if;
  return v_id;
end
$$;

-- Ingesta automática: puede registrar 'measured'.
create function health.record_observation(
  p_metric_id text, p_value numeric, p_measured_at timestamptz, p_quality health.quality,
  p_source text, p_raw_event_id uuid default null, p_supersedes_id uuid default null
) returns uuid
language sql security definer set search_path = pg_catalog, health as
$$
  select health._record(p_metric_id, p_value, p_measured_at, p_quality, p_source, p_raw_event_id, p_supersedes_id);
$$;

-- Captura conversacional: nunca puede declarar 'measured'.
create function health.record_manual_observation(
  p_metric_id text, p_value numeric, p_measured_at timestamptz,
  p_quality health.quality default 'manual', p_source text default 'manual',
  p_supersedes_id uuid default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, health as
$$
begin
  if p_quality = 'measured' then
    raise exception 'manual capture cannot declare quality measured';
  end if;
  return health._record(p_metric_id, p_value, p_measured_at, p_quality, p_source, null, p_supersedes_id);
end
$$;

---------------------------------------------------------------------------
-- Permisos
---------------------------------------------------------------------------

-- Las funciones se crean con EXECUTE para PUBLIC por defecto: se retira y se concede rol a rol.
revoke execute on all functions in schema raw, health, ops from public;

grant execute on function ops.start_run(text, text, text) to agent_writer, ingest_writer, executor;
grant execute on function ops.finish_run(uuid, text, text, text, integer, integer, numeric, text)
  to agent_writer, ingest_writer, executor;
grant execute on function ops.create_proposal(uuid, text, jsonb, text, timestamptz) to agent_writer;
grant execute on function ops.decide_proposal(uuid, text, text, boolean) to approver;
grant execute on function ops.claim_execution(uuid) to executor;
grant execute on function ops.finish_execution(uuid, text, jsonb) to executor;
grant execute on function ops.expire_proposals() to executor;
grant execute on function ops.log_dead_letter(text, jsonb, text, integer)
  to agent_writer, ingest_writer, executor;
grant execute on function raw.ingest_event(text, text, jsonb) to ingest_writer;
grant execute on function health.record_observation(text, numeric, timestamptz, health.quality, text, uuid, uuid)
  to ingest_writer;
grant execute on function health.record_manual_observation(text, numeric, timestamptz, health.quality, text, uuid)
  to agent_writer;

-- Lectura. app_reader no ve aprobaciones ni datos crudos.
grant select on health.metric_def, health.observation to app_reader;
grant select on ops.run, ops.action_catalog, ops.action_proposal, ops.action_execution to app_reader;
grant select on ops.action_proposal, ops.action_catalog, ops.approval to approver;
grant select on ops.action_proposal, ops.action_catalog, ops.approval, ops.action_execution to executor;

-- RLS: sin política no hay filas. Solo se conceden las de lectura necesarias.
create policy app_reader_read on health.metric_def for select to app_reader using (true);
create policy app_reader_read on health.observation for select to app_reader using (true);
create policy app_reader_read on ops.run for select to app_reader using (true);
create policy app_reader_read on ops.action_catalog for select to app_reader using (true);
create policy app_reader_read on ops.action_proposal for select to app_reader using (true);
create policy app_reader_read on ops.action_execution for select to app_reader using (true);
create policy approver_read on ops.action_proposal for select to approver using (true);
create policy approver_read on ops.action_catalog for select to approver using (true);
create policy approver_read on ops.approval for select to approver using (true);
create policy executor_read on ops.action_proposal for select to executor using (true);
create policy executor_read on ops.action_catalog for select to executor using (true);
create policy executor_read on ops.approval for select to executor using (true);
create policy executor_read on ops.action_execution for select to executor using (true);

-- Defensa en profundidad: los roles de la API pública de Supabase no ven estos esquemas.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema raw, core, health, training, nutrition, body, knowledge, ops from %I', r);
      execute format('revoke all on all functions in schema raw, health, ops from %I', r);
      execute format('revoke all on schema raw, core, health, training, nutrition, body, knowledge, ops from %I', r);
    end if;
  end loop;
end
$$;
