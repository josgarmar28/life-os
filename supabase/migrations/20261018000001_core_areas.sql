-- LIFE OS · D1 · Motor de áreas del dashboard (core) y API (api)
--
-- Modelo:
--  * Áreas -> formularios (cuestionarios) -> campos, definidos como DATOS: crear,
--    modificar o archivar un área no requiere migraciones.
--  * core.entry es de solo inserción: corregir = nueva versión con supersedes_id;
--    borrar = versión "void". El borrado definitivo solo existe para un área
--    archivada, confirmando su nombre (api.purge_area), y queda auditado.
--  * Validación determinista en la BD (tipo, rango, opciones, obligatorios).
--
-- Identidades (Supabase Auth, rol `authenticated`):
--  * Dueño: el único usuario registrado en core.app_owner (lo inserta el bootstrap).
--  * Sesión del dashboard: JWT del dueño SIN claim client_id.
--  * Claude (conector MCP con OAuth): JWT del dueño CON claim client_id.
--    Puede leer y registrar datos (source = 'claude'), pero NO cambia la estructura
--    ni aprueba: solo propone (api.create_proposal). Aprobar = sesión del dueño.
--
-- Solo hacia delante. Requiere auth.uid() y auth.jwt() (los trae Supabase; en
-- pruebas los simula supabase/tests/00_bootstrap_supabase_roles.sql).

create schema if not exists api;

revoke all on schema api from public;
grant usage on schema api to authenticated;
grant usage on schema core to authenticated;

comment on schema api is 'API pública del dashboard y del conector (PostgREST). Vistas security_invoker y funciones validadas.';

---------------------------------------------------------------------------
-- Identidad y autorización
---------------------------------------------------------------------------

create table core.app_owner (
  user_id    uuid primary key,
  singleton  boolean not null default true unique check (singleton),
  created_at timestamptz not null default now()
);
alter table core.app_owner enable row level security;
comment on table core.app_owner is 'El único usuario con acceso. Una fila como máximo.';

create function core.is_owner() returns boolean
language sql stable security definer set search_path = pg_catalog, core as
$$
  select exists (select 1 from core.app_owner where user_id = auth.uid());
$$;

-- client_id solo existe en tokens emitidos por el servidor OAuth (conector de Claude).
create function core.client_id() returns text
language sql stable as
$$
  select nullif(auth.jwt() ->> 'client_id', '');
$$;

create function core.actor() returns text
language sql stable as
$$
  select case when core.client_id() is null then 'owner' else 'agent:' || core.client_id() end;
$$;

-- Lanza error si quien llama no es el dueño, o si es un agente y la operación no lo admite.
create function core.require_owner(p_allow_agent boolean) returns void
language plpgsql stable as
$$
begin
  if not core.is_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not p_allow_agent and core.client_id() is not null then
    raise exception 'agents cannot do this directly; use api.create_proposal' using errcode = '42501';
  end if;
end
$$;

create function core.audit(p_action text, p_table text, p_row_id text, p_detail jsonb) returns void
language sql security definer set search_path = pg_catalog, ops as
$$
  insert into ops.audit_log (actor, action, table_name, row_id, detail)
  values (core.actor(), p_action, p_table, p_row_id, coalesce(p_detail, '{}'::jsonb));
$$;

---------------------------------------------------------------------------
-- Ajustes
---------------------------------------------------------------------------

create table core.setting (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table core.setting enable row level security;
insert into core.setting (key, value) values ('timezone', '"Europe/Zurich"') on conflict do nothing;

create function core.timezone() returns text
language sql stable security definer set search_path = pg_catalog, core as
$$
  select coalesce((select value #>> '{}' from core.setting where key = 'timezone'), 'Europe/Zurich');
$$;

---------------------------------------------------------------------------
-- Estructura: áreas, formularios y campos
---------------------------------------------------------------------------

create type core.status as enum ('active', 'archived');
create type core.cadence as enum ('daily', 'weekly', 'biweekly', 'monthly', 'per_session', 'free');
create type core.field_type as enum (
  'number', 'integer', 'scale', 'boolean', 'text', 'choice', 'multi', 'date', 'time', 'duration', 'table'
);

create table core.area (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40),
  name        text not null check (length(btrim(name)) between 1 and 60),
  description text not null default '' check (length(description) <= 500),
  icon        text not null default '' check (length(icon) <= 8),
  sort_order  integer not null default 100,
  status      core.status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

create table core.form (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references core.area (id) on delete cascade,
  slug        text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40),
  name        text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 1000),
  cadence     core.cadence not null default 'free',
  sort_order  integer not null default 100,
  status      core.status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (area_id, slug)
);
create index form_area_idx on core.form (area_id);

create table core.field (
  id          uuid primary key default gen_random_uuid(),
  form_id     uuid not null references core.form (id) on delete cascade,
  key         text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label       text not null check (length(btrim(label)) between 1 and 120),
  help        text not null default '' check (length(help) <= 500),
  type        core.field_type not null,
  unit        text not null default '' check (length(unit) <= 20),
  min         numeric check (min is null or min <> 'NaN'::numeric),
  max         numeric check (max is null or max <> 'NaN'::numeric),
  step        numeric check (step is null or step > 0),
  options     jsonb not null default '[]'::jsonb,
  columns     jsonb not null default '[]'::jsonb,
  required    boolean not null default false,
  on_overview boolean not null default false,
  sort_order  integer not null default 100,
  status      core.status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (form_id, key),
  check (min is null or max is null or min <= max)
);
create index field_form_idx on core.field (form_id);

-- Comprueba la forma de options/columns y los requisitos de cada tipo.
create function core.check_field_shape(
  p_type core.field_type, p_min numeric, p_max numeric, p_options jsonb, p_columns jsonb, p_depth integer
) returns void
language plpgsql immutable as
$$
declare
  v_opt jsonb;
  v_col jsonb;
  v_keys text[] := '{}';
begin
  if jsonb_typeof(p_options) <> 'array' or jsonb_typeof(p_columns) <> 'array' then
    raise exception 'options and columns must be JSON arrays';
  end if;

  if p_type in ('choice', 'multi') then
    if jsonb_array_length(p_options) = 0 then
      raise exception '% field needs at least one option', p_type;
    end if;
    for v_opt in select * from jsonb_array_elements(p_options) loop
      if jsonb_typeof(v_opt) <> 'object' or jsonb_typeof(v_opt -> 'value') <> 'string'
         or coalesce(v_opt ->> 'value', '') = '' then
        raise exception 'each option must be an object with a non-empty string "value"';
      end if;
      if (v_opt ->> 'value') = any (v_keys) then
        raise exception 'duplicate option value: %', v_opt ->> 'value';
      end if;
      v_keys := v_keys || (v_opt ->> 'value');
    end loop;
  elsif jsonb_array_length(p_options) > 0 then
    raise exception 'options are only allowed for choice and multi fields';
  end if;

  if p_type = 'scale' and (p_min is null or p_max is null or p_min <> trunc(p_min) or p_max <> trunc(p_max)) then
    raise exception 'scale fields need integer min and max';
  end if;

  if p_type = 'table' then
    if p_depth > 0 then
      raise exception 'tables cannot be nested';
    end if;
    if jsonb_array_length(p_columns) = 0 then
      raise exception 'table field needs at least one column';
    end if;
    v_keys := '{}';
    for v_col in select * from jsonb_array_elements(p_columns) loop
      if jsonb_typeof(v_col) <> 'object' or coalesce(v_col ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$'
         or coalesce(btrim(v_col ->> 'label'), '') = '' or (v_col ->> 'type') is null then
        raise exception 'each column needs key (snake_case), label and type';
      end if;
      if (v_col ->> 'key') = any (v_keys) then
        raise exception 'duplicate column key: %', v_col ->> 'key';
      end if;
      v_keys := v_keys || (v_col ->> 'key');
      perform core.check_field_shape(
        (v_col ->> 'type')::core.field_type,
        (v_col ->> 'min')::numeric, (v_col ->> 'max')::numeric,
        coalesce(v_col -> 'options', '[]'::jsonb), coalesce(v_col -> 'columns', '[]'::jsonb),
        p_depth + 1
      );
    end loop;
  elsif jsonb_array_length(p_columns) > 0 then
    raise exception 'columns are only allowed for table fields';
  end if;
end
$$;

create function core.field_guard() returns trigger
language plpgsql as
$$
begin
  if tg_op = 'UPDATE' and (new.form_id <> old.form_id or new.key <> old.key or new.type <> old.type) then
    raise exception 'form, key and type of a field are immutable; archive it and create a new one';
  end if;
  perform core.check_field_shape(new.type, new.min, new.max, new.options, new.columns, 0);
  new.updated_at := now();
  return new;
end
$$;
create trigger field_guard before insert or update on core.field
  for each row execute function core.field_guard();

create function core.touch() returns trigger
language plpgsql as
$$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status = 'archived' and old.status <> 'archived' then
      new.archived_at := now();
    elsif new.status = 'active' then
      new.archived_at := null;
    end if;
  end if;
  return new;
end
$$;
create trigger area_touch before update on core.area for each row execute function core.touch();
create trigger form_touch before update on core.form for each row execute function core.touch();

---------------------------------------------------------------------------
-- Datos: entradas (solo inserción)
---------------------------------------------------------------------------

create table core.entry (
  id            uuid primary key default gen_random_uuid(),
  form_id       uuid not null references core.form (id) on delete cascade,
  occurred_at   timestamptz not null,
  local_date    date not null,
  data          jsonb not null check (jsonb_typeof(data) = 'object'),
  note          text not null default '' check (length(note) <= 2000),
  source        text not null check (source in ('dashboard', 'claude', 'import')),
  quality       text not null check (quality in ('measured', 'manual', 'estimated')),
  supersedes_id uuid references core.entry (id) on delete cascade,
  is_void       boolean not null default false,
  request_id    uuid not null unique,
  actor         text not null,
  created_at    timestamptz not null default now()
);
create index entry_form_date_idx on core.entry (form_id, local_date desc);
-- Historia lineal: cada versión solo puede sustituirse una vez.
create unique index entry_supersedes_once_idx on core.entry (supersedes_id) where supersedes_id is not null;

-- Solo inserción, salvo el borrado definitivo de un área (api.purge_area).
create function core.deny_mutation_unless_purge() returns trigger
language plpgsql as
$$
begin
  if tg_op = 'DELETE' and current_setting('lifeos.purge', true) = 'on' then
    return old;
  end if;
  raise exception '% on %.% is not allowed (append-only)', tg_op, tg_table_schema, tg_table_name
    using errcode = 'P0001';
end
$$;
create trigger entry_append_only before update or delete on core.entry
  for each row execute function core.deny_mutation_unless_purge();
create trigger entry_no_truncate before truncate on core.entry
  for each statement execute function ops.deny_mutation();

---------------------------------------------------------------------------
-- Validación determinista de valores
---------------------------------------------------------------------------

create function core.validate_scalar(
  p_label text, p_type core.field_type, p_min numeric, p_max numeric, p_options jsonb, p_value jsonb
) returns jsonb
language plpgsql immutable as
$$
declare
  v_num numeric;
  v_txt text;
  v_seen text[] := '{}';
  v_item jsonb;
begin
  case p_type
    when 'number', 'integer', 'scale', 'duration' then
      if jsonb_typeof(p_value) <> 'number' then
        raise exception '%: expected a number', p_label;
      end if;
      v_num := (p_value #>> '{}')::numeric;
      if p_type in ('integer', 'scale') and v_num <> trunc(v_num) then
        raise exception '%: expected a whole number', p_label;
      end if;
      if p_type = 'duration' and v_num < 0 then
        raise exception '%: duration cannot be negative', p_label;
      end if;
      if (p_min is not null and v_num < p_min) or (p_max is not null and v_num > p_max) then
        raise exception '%: % is outside [%, %]', p_label, v_num, coalesce(p_min::text, '-∞'), coalesce(p_max::text, '∞');
      end if;
      return p_value;
    when 'boolean' then
      if jsonb_typeof(p_value) <> 'boolean' then
        raise exception '%: expected true or false', p_label;
      end if;
      return p_value;
    when 'text' then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception '%: expected text', p_label;
      end if;
      v_txt := btrim(p_value #>> '{}');
      if length(v_txt) > coalesce(p_max::integer, 2000) then
        raise exception '%: text is too long', p_label;
      end if;
      if v_txt = '' then
        return null;
      end if;
      return to_jsonb(v_txt);
    when 'choice' then
      if jsonb_typeof(p_value) <> 'string'
         or not exists (select 1 from jsonb_array_elements(p_options) o where o ->> 'value' = p_value #>> '{}') then
        raise exception '%: "%" is not one of the options', p_label, p_value #>> '{}';
      end if;
      return p_value;
    when 'multi' then
      if jsonb_typeof(p_value) <> 'array' then
        raise exception '%: expected a list of options', p_label;
      end if;
      for v_item in select * from jsonb_array_elements(p_value) loop
        if jsonb_typeof(v_item) <> 'string'
           or not exists (select 1 from jsonb_array_elements(p_options) o where o ->> 'value' = v_item #>> '{}') then
          raise exception '%: "%" is not one of the options', p_label, v_item #>> '{}';
        end if;
        if (v_item #>> '{}') = any (v_seen) then
          raise exception '%: repeated option "%"', p_label, v_item #>> '{}';
        end if;
        v_seen := v_seen || (v_item #>> '{}');
      end loop;
      if jsonb_array_length(p_value) = 0 then
        return null;
      end if;
      return p_value;
    when 'date' then
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception '%: expected a date YYYY-MM-DD', p_label;
      end if;
      begin
        perform (p_value #>> '{}')::date;
      exception when others then
        raise exception '%: invalid date', p_label;
      end;
      return p_value;
    when 'time' then
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
        raise exception '%: expected a time HH:MM', p_label;
      end if;
      return p_value;
    else
      raise exception '%: type % is not a scalar', p_label, p_type;
  end case;
end
$$;

-- Devuelve los valores normalizados (sin nulos ni vacíos) o lanza el primer error.
create function core.validate_values(p_form_id uuid, p_values jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, core as
$$
declare
  v_field core.field%rowtype;
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_norm jsonb;
  v_row jsonb;
  v_rows jsonb;
  v_col jsonb;
  v_cell jsonb;
  v_row_out jsonb;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'values must be a JSON object';
  end if;

  for v_key in select jsonb_object_keys(p_values) loop
    if not exists (select 1 from core.field where form_id = p_form_id and key = v_key and status = 'active') then
      raise exception 'unknown or archived field: %', v_key;
    end if;
  end loop;

  for v_field in select * from core.field where form_id = p_form_id and status = 'active' order by sort_order, key loop
    v_val := p_values -> v_field.key;
    v_norm := null;
    if v_val is not null and jsonb_typeof(v_val) <> 'null' then
      if v_field.type = 'table' then
        if jsonb_typeof(v_val) <> 'array' then
          raise exception '%: expected a list of rows', v_field.label;
        end if;
        if jsonb_array_length(v_val) > 200 then
          raise exception '%: too many rows', v_field.label;
        end if;
        v_rows := '[]'::jsonb;
        for v_row in select * from jsonb_array_elements(v_val) loop
          if jsonb_typeof(v_row) <> 'object' then
            raise exception '%: each row must be an object', v_field.label;
          end if;
          for v_key in select jsonb_object_keys(v_row) loop
            if not exists (select 1 from jsonb_array_elements(v_field.columns) c where c ->> 'key' = v_key) then
              raise exception '%: unknown column %', v_field.label, v_key;
            end if;
          end loop;
          v_row_out := '{}'::jsonb;
          for v_col in select * from jsonb_array_elements(v_field.columns) loop
            v_cell := v_row -> (v_col ->> 'key');
            if v_cell is not null and jsonb_typeof(v_cell) <> 'null' then
              v_cell := core.validate_scalar(
                v_field.label || ' · ' || (v_col ->> 'label'), (v_col ->> 'type')::core.field_type,
                (v_col ->> 'min')::numeric, (v_col ->> 'max')::numeric,
                coalesce(v_col -> 'options', '[]'::jsonb), v_cell);
            end if;
            if v_cell is not null and jsonb_typeof(v_cell) <> 'null' then
              v_row_out := v_row_out || jsonb_build_object(v_col ->> 'key', v_cell);
            end if;
          end loop;
          -- Una fila totalmente vacía se descarta; una fila con datos debe tener sus columnas obligatorias.
          if v_row_out <> '{}'::jsonb then
            for v_col in select * from jsonb_array_elements(v_field.columns) loop
              if coalesce((v_col ->> 'required')::boolean, false) and not v_row_out ? (v_col ->> 'key') then
                raise exception '%: % is required in every row', v_field.label, v_col ->> 'label';
              end if;
            end loop;
            v_rows := v_rows || jsonb_build_array(v_row_out);
          end if;
        end loop;
        if jsonb_array_length(v_rows) > 0 then
          v_norm := v_rows;
        end if;
      else
        v_norm := core.validate_scalar(v_field.label, v_field.type, v_field.min, v_field.max, v_field.options, v_val);
      end if;
    end if;

    if v_norm is null or jsonb_typeof(v_norm) = 'null' then
      if v_field.required then
        raise exception '%: required', v_field.label;
      end if;
    else
      v_out := v_out || jsonb_build_object(v_field.key, v_norm);
    end if;
  end loop;

  if v_out = '{}'::jsonb then
    raise exception 'the entry has no values';
  end if;
  return v_out;
end
$$;

---------------------------------------------------------------------------
-- Propuestas de Claude (el dueño aprueba en el dashboard)
---------------------------------------------------------------------------

create table core.proposal (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('area.save', 'form.save', 'field.save', 'form.archive', 'field.archive', 'note')),
  payload      jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_hash text not null,
  rationale    text not null check (length(btrim(rationale)) between 1 and 4000),
  status       text not null default 'pending' check (status in ('pending', 'rejected', 'applied', 'failed', 'expired')),
  actor        text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  decided_at   timestamptz,
  result       jsonb
);
create index proposal_status_idx on core.proposal (status, created_at desc);

create function core.proposal_guard() returns trigger
language plpgsql as
$$
begin
  if tg_op = 'DELETE' then
    if current_setting('lifeos.purge', true) = 'on' then
      return old;
    end if;
    raise exception 'proposals cannot be deleted';
  end if;
  if new.kind <> old.kind or new.payload <> old.payload or new.payload_hash <> old.payload_hash
     or new.rationale <> old.rationale or new.actor <> old.actor or new.created_at <> old.created_at then
    raise exception 'proposal content is immutable';
  end if;
  if old.status <> 'pending' then
    raise exception 'proposal already decided';
  end if;
  return new;
end
$$;
create trigger proposal_guard before update or delete on core.proposal
  for each row execute function core.proposal_guard();

create function core.hash_payload(p_kind text, p_payload jsonb) returns text
language sql immutable as
$$
  select encode(sha256(convert_to(p_kind || ':' || p_payload::text, 'UTF8')), 'hex');
$$;

---------------------------------------------------------------------------
-- Lectura (RLS: solo el dueño; Claude lee con el token del dueño)
---------------------------------------------------------------------------

alter table core.area enable row level security;
alter table core.form enable row level security;
alter table core.field enable row level security;
alter table core.entry enable row level security;
alter table core.proposal enable row level security;

create policy owner_read on core.area for select to authenticated using (core.is_owner());
create policy owner_read on core.form for select to authenticated using (core.is_owner());
create policy owner_read on core.field for select to authenticated using (core.is_owner());
create policy owner_read on core.entry for select to authenticated using (core.is_owner());
create policy owner_read on core.proposal for select to authenticated using (core.is_owner());

revoke all on core.app_owner, core.setting, core.area, core.form, core.field, core.entry, core.proposal from public;
grant select on core.area, core.form, core.field, core.entry, core.proposal to authenticated;

create view api.areas with (security_invoker = true) as
  select id, slug, name, description, icon, sort_order, status, created_at, updated_at, archived_at
  from core.area;

create view api.forms with (security_invoker = true) as
  select id, area_id, slug, name, description, cadence, sort_order, status, created_at, updated_at, archived_at
  from core.form;

create view api.fields with (security_invoker = true) as
  select id, form_id, key, label, help, type, unit, min, max, step, options, columns,
         required, on_overview, sort_order, status, created_at, updated_at
  from core.field;

-- Versión vigente de cada entrada (ni sustituida ni anulada).
create view api.entries with (security_invoker = true) as
  select e.id, e.form_id, f.area_id, e.occurred_at, e.local_date, e.data, e.note, e.source, e.quality,
         e.supersedes_id, e.actor, e.created_at
  from core.entry e
  join core.form f on f.id = e.form_id
  where not e.is_void
    and not exists (select 1 from core.entry n where n.supersedes_id = e.id);

-- Historia completa (todas las versiones), para auditoría.
create view api.entry_versions with (security_invoker = true) as
  select id, form_id, occurred_at, local_date, data, note, source, quality, supersedes_id, is_void, actor, created_at
  from core.entry;

create view api.proposals with (security_invoker = true) as
  select id, kind, payload, payload_hash, rationale, status, actor, created_at, expires_at, decided_at, result
  from core.proposal;

grant select on api.areas, api.forms, api.fields, api.entries, api.entry_versions, api.proposals to authenticated;

---------------------------------------------------------------------------
-- Escritura de estructura (solo la sesión del dueño)
---------------------------------------------------------------------------

create function api.save_area(
  p_id uuid, p_slug text, p_name text, p_description text default '', p_icon text default '', p_sort_order integer default 100
) returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_id uuid;
begin
  perform core.require_owner(false);
  if p_id is null then
    insert into core.area (slug, name, description, icon, sort_order)
    values (p_slug, btrim(p_name), coalesce(p_description, ''), coalesce(p_icon, ''), coalesce(p_sort_order, 100))
    returning id into v_id;
    perform core.audit('area.create', 'core.area', v_id::text, jsonb_build_object('slug', p_slug, 'name', p_name));
  else
    update core.area set slug = p_slug, name = btrim(p_name), description = coalesce(p_description, ''),
           icon = coalesce(p_icon, ''), sort_order = coalesce(p_sort_order, sort_order)
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'area not found';
    end if;
    perform core.audit('area.update', 'core.area', v_id::text, jsonb_build_object('slug', p_slug, 'name', p_name));
  end if;
  return v_id;
end
$$;

create function api.set_area_status(p_id uuid, p_status core.status) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(false);
  update core.area set status = p_status where id = p_id;
  if not found then
    raise exception 'area not found';
  end if;
  perform core.audit('area.' || p_status::text, 'core.area', p_id::text, '{}'::jsonb);
end
$$;

-- Borrado definitivo: el área debe estar archivada y el nombre debe coincidir exactamente.
create function api.purge_area(p_id uuid, p_confirm_name text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_area core.area%rowtype;
  v_forms integer;
  v_entries integer;
begin
  perform core.require_owner(false);
  select * into v_area from core.area where id = p_id;
  if not found then
    raise exception 'area not found';
  end if;
  if v_area.status <> 'archived' then
    raise exception 'archive the area before deleting it permanently';
  end if;
  if p_confirm_name is distinct from v_area.name then
    raise exception 'confirmation name does not match';
  end if;
  select count(*) into v_forms from core.form where area_id = p_id;
  select count(*) into v_entries from core.entry e join core.form f on f.id = e.form_id where f.area_id = p_id;
  perform set_config('lifeos.purge', 'on', true);
  delete from core.area where id = p_id;
  perform set_config('lifeos.purge', 'off', true);
  perform core.audit('area.purge', 'core.area', p_id::text,
    jsonb_build_object('slug', v_area.slug, 'name', v_area.name, 'forms', v_forms, 'entries', v_entries));
  return jsonb_build_object('forms', v_forms, 'entries', v_entries);
end
$$;

create function api.save_form(
  p_id uuid, p_area_id uuid, p_slug text, p_name text, p_description text default '',
  p_cadence core.cadence default 'free', p_sort_order integer default 100
) returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_id uuid;
begin
  perform core.require_owner(false);
  if p_id is null then
    insert into core.form (area_id, slug, name, description, cadence, sort_order)
    values (p_area_id, p_slug, btrim(p_name), coalesce(p_description, ''), coalesce(p_cadence, 'free'), coalesce(p_sort_order, 100))
    returning id into v_id;
    perform core.audit('form.create', 'core.form', v_id::text, jsonb_build_object('slug', p_slug, 'area_id', p_area_id));
  else
    update core.form set slug = p_slug, name = btrim(p_name), description = coalesce(p_description, ''),
           cadence = coalesce(p_cadence, cadence), sort_order = coalesce(p_sort_order, sort_order)
     where id = p_id and area_id = p_area_id returning id into v_id;
    if v_id is null then
      raise exception 'form not found in that area';
    end if;
    perform core.audit('form.update', 'core.form', v_id::text, jsonb_build_object('slug', p_slug));
  end if;
  return v_id;
end
$$;

create function api.set_form_status(p_id uuid, p_status core.status) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(false);
  update core.form set status = p_status where id = p_id;
  if not found then
    raise exception 'form not found';
  end if;
  perform core.audit('form.' || p_status::text, 'core.form', p_id::text, '{}'::jsonb);
end
$$;

create function api.save_field(
  p_id uuid, p_form_id uuid, p_key text, p_label text, p_type core.field_type,
  p_help text default '', p_unit text default '', p_min numeric default null, p_max numeric default null,
  p_step numeric default null, p_options jsonb default '[]', p_columns jsonb default '[]',
  p_required boolean default false, p_on_overview boolean default false, p_sort_order integer default 100
) returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_id uuid;
begin
  perform core.require_owner(false);
  if p_id is null then
    insert into core.field (form_id, key, label, help, type, unit, min, max, step, options, columns,
                            required, on_overview, sort_order)
    values (p_form_id, p_key, btrim(p_label), coalesce(p_help, ''), p_type, coalesce(p_unit, ''), p_min, p_max, p_step,
            coalesce(p_options, '[]'), coalesce(p_columns, '[]'), coalesce(p_required, false),
            coalesce(p_on_overview, false), coalesce(p_sort_order, 100))
    returning id into v_id;
    perform core.audit('field.create', 'core.field', v_id::text,
      jsonb_build_object('form_id', p_form_id, 'key', p_key, 'type', p_type));
  else
    update core.field set form_id = p_form_id, key = p_key, type = p_type, label = btrim(p_label),
           help = coalesce(p_help, ''), unit = coalesce(p_unit, ''), min = p_min, max = p_max, step = p_step,
           options = coalesce(p_options, '[]'), columns = coalesce(p_columns, '[]'),
           required = coalesce(p_required, false), on_overview = coalesce(p_on_overview, false),
           sort_order = coalesce(p_sort_order, sort_order)
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'field not found';
    end if;
    perform core.audit('field.update', 'core.field', v_id::text, jsonb_build_object('key', p_key));
  end if;
  return v_id;
end
$$;

create function api.set_field_status(p_id uuid, p_status core.status) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(false);
  update core.field set status = p_status where id = p_id;
  if not found then
    raise exception 'field not found';
  end if;
  perform core.audit('field.' || p_status::text, 'core.field', p_id::text, '{}'::jsonb);
end
$$;

---------------------------------------------------------------------------
-- Escritura de datos (dueño y Claude)
---------------------------------------------------------------------------

-- Idempotente por p_request_id: reintentar la misma petición devuelve la misma entrada.
create function api.add_entry(
  p_form_id uuid, p_values jsonb, p_request_id uuid,
  p_occurred_at timestamptz default null, p_local_date date default null,
  p_note text default '', p_quality text default 'manual', p_supersedes_id uuid default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_form core.form%rowtype;
  v_values jsonb;
  v_existing core.entry%rowtype;
  v_prev core.entry%rowtype;
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_id uuid;
begin
  perform core.require_owner(true);
  if p_request_id is null then
    raise exception 'request_id is required';
  end if;

  select * into v_existing from core.entry where request_id = p_request_id;
  if found then
    if v_existing.form_id <> p_form_id then
      raise exception 'request_id already used for another entry';
    end if;
    return v_existing.id;
  end if;

  select * into v_form from core.form where id = p_form_id;
  if not found then
    raise exception 'form not found';
  end if;
  if v_form.status <> 'active' or exists (select 1 from core.area where id = v_form.area_id and status <> 'active') then
    raise exception 'form or area is archived';
  end if;
  if coalesce(p_quality, 'manual') not in ('manual', 'estimated') then
    raise exception 'quality must be manual or estimated for dashboard and Claude entries';
  end if;
  if v_at > now() + interval '5 minutes' then
    raise exception 'occurred_at is in the future';
  end if;

  if p_supersedes_id is not null then
    select * into v_prev from core.entry where id = p_supersedes_id;
    if not found or v_prev.form_id <> p_form_id then
      raise exception 'supersedes_id must reference an entry of the same form';
    end if;
    if v_prev.is_void or exists (select 1 from core.entry where supersedes_id = p_supersedes_id) then
      raise exception 'only the current version of an entry can be corrected';
    end if;
  end if;

  v_values := core.validate_values(p_form_id, p_values);

  insert into core.entry (form_id, occurred_at, local_date, data, note, source, quality,
                          supersedes_id, request_id, actor)
  values (p_form_id, v_at, coalesce(p_local_date, (v_at at time zone core.timezone())::date), v_values,
          coalesce(btrim(p_note), ''), case when core.client_id() is null then 'dashboard' else 'claude' end,
          coalesce(p_quality, 'manual'), p_supersedes_id, p_request_id, core.actor())
  returning id into v_id;

  perform core.audit(case when p_supersedes_id is null then 'entry.create' else 'entry.correct' end,
                     'core.entry', v_id::text, jsonb_build_object('form_id', p_form_id));
  return v_id;
end
$$;

create function api.void_entry(p_entry_id uuid, p_request_id uuid, p_note text default '') returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_prev core.entry%rowtype;
  v_existing core.entry%rowtype;
  v_id uuid;
begin
  perform core.require_owner(true);
  select * into v_existing from core.entry where request_id = p_request_id;
  if found then
    return v_existing.id;
  end if;
  select * into v_prev from core.entry where id = p_entry_id;
  if not found then
    raise exception 'entry not found';
  end if;
  if v_prev.is_void or exists (select 1 from core.entry where supersedes_id = p_entry_id) then
    raise exception 'only the current version of an entry can be deleted';
  end if;
  insert into core.entry (form_id, occurred_at, local_date, data, note, source, quality,
                          supersedes_id, is_void, request_id, actor)
  values (v_prev.form_id, v_prev.occurred_at, v_prev.local_date, '{}'::jsonb, coalesce(btrim(p_note), ''),
          case when core.client_id() is null then 'dashboard' else 'claude' end,
          v_prev.quality, p_entry_id, true, p_request_id, core.actor())
  returning id into v_id;
  perform core.audit('entry.void', 'core.entry', v_id::text, jsonb_build_object('form_id', v_prev.form_id));
  return v_id;
end
$$;

---------------------------------------------------------------------------
-- Propuestas: crear (dueño o Claude) y decidir (solo la sesión del dueño)
---------------------------------------------------------------------------

create function api.create_proposal(p_kind text, p_payload jsonb, p_rationale text) returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_id uuid;
begin
  perform core.require_owner(true);
  insert into core.proposal (kind, payload, payload_hash, rationale, actor)
  values (p_kind, p_payload, core.hash_payload(p_kind, p_payload), btrim(p_rationale), core.actor())
  returning id into v_id;
  perform core.audit('proposal.create', 'core.proposal', v_id::text, jsonb_build_object('kind', p_kind));
  return v_id;
end
$$;

create function core.apply_proposal(p core.proposal) returns jsonb
language plpgsql as
$$
declare
  x jsonb := p.payload;
  v_id uuid;
begin
  case p.kind
    when 'area.save' then
      v_id := api.save_area((x ->> 'id')::uuid, x ->> 'slug', x ->> 'name', coalesce(x ->> 'description', ''),
                            coalesce(x ->> 'icon', ''), coalesce((x ->> 'sort_order')::integer, 100));
    when 'form.save' then
      v_id := api.save_form((x ->> 'id')::uuid, (x ->> 'area_id')::uuid, x ->> 'slug', x ->> 'name',
                            coalesce(x ->> 'description', ''), coalesce((x ->> 'cadence')::core.cadence, 'free'),
                            coalesce((x ->> 'sort_order')::integer, 100));
    when 'field.save' then
      v_id := api.save_field((x ->> 'id')::uuid, (x ->> 'form_id')::uuid, x ->> 'key', x ->> 'label',
                             (x ->> 'type')::core.field_type, coalesce(x ->> 'help', ''), coalesce(x ->> 'unit', ''),
                             (x ->> 'min')::numeric, (x ->> 'max')::numeric, (x ->> 'step')::numeric,
                             coalesce(x -> 'options', '[]'), coalesce(x -> 'columns', '[]'),
                             coalesce((x ->> 'required')::boolean, false), coalesce((x ->> 'on_overview')::boolean, false),
                             coalesce((x ->> 'sort_order')::integer, 100));
    when 'form.archive' then
      v_id := (x ->> 'id')::uuid;
      perform api.set_form_status(v_id, 'archived');
    when 'field.archive' then
      v_id := (x ->> 'id')::uuid;
      perform api.set_field_status(v_id, 'archived');
    when 'note' then
      return jsonb_build_object('acknowledged', true);
  end case;
  return jsonb_build_object('id', v_id);
end
$$;

-- p_payload_hash ata la aprobación al contenido que el dueño vio en pantalla.
create function api.decide_proposal(p_id uuid, p_approve boolean, p_payload_hash text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_p core.proposal%rowtype;
  v_result jsonb;
begin
  perform core.require_owner(false);
  select * into v_p from core.proposal where id = p_id for update;
  if not found then
    raise exception 'proposal not found';
  end if;
  if v_p.status <> 'pending' then
    raise exception 'proposal already decided';
  end if;
  if p_payload_hash is distinct from v_p.payload_hash
     or v_p.payload_hash <> core.hash_payload(v_p.kind, v_p.payload) then
    raise exception 'proposal content does not match what was approved';
  end if;
  if v_p.expires_at < now() then
    update core.proposal set status = 'expired', decided_at = now() where id = p_id;
    perform core.audit('proposal.expired', 'core.proposal', p_id::text, '{}'::jsonb);
    return jsonb_build_object('status', 'expired');
  end if;
  if not p_approve then
    update core.proposal set status = 'rejected', decided_at = now() where id = p_id;
    perform core.audit('proposal.rejected', 'core.proposal', p_id::text, '{}'::jsonb);
    return jsonb_build_object('status', 'rejected');
  end if;

  begin
    v_result := core.apply_proposal(v_p);
    update core.proposal set status = 'applied', decided_at = now(), result = v_result where id = p_id;
    perform core.audit('proposal.applied', 'core.proposal', p_id::text, v_result);
    return jsonb_build_object('status', 'applied', 'result', v_result);
  exception when others then
    update core.proposal set status = 'failed', decided_at = now(), result = jsonb_build_object('error', sqlerrm)
     where id = p_id;
    perform core.audit('proposal.failed', 'core.proposal', p_id::text, jsonb_build_object('error', sqlerrm));
    return jsonb_build_object('status', 'failed', 'error', sqlerrm);
  end;
end
$$;

-- Actividad reciente del dashboard y de Claude (sin valores personales).
create function api.recent_activity(p_limit integer default 50) returns table (
  ts timestamptz, actor text, action text, table_name text, row_id text, detail jsonb
)
language plpgsql stable security definer set search_path = pg_catalog, ops as
$$
begin
  perform core.require_owner(true);
  return query
    select a.ts, a.actor, a.action, a.table_name, a.row_id, a.detail
      from ops.audit_log a
     where a.table_name like 'core.%'
     order by a.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

-- Comprueba quién llama, para que el dashboard muestre "sin acceso" con claridad.
create function api.whoami() returns jsonb
language sql stable security definer set search_path = pg_catalog, core as
$$
  select jsonb_build_object('is_owner', core.is_owner(), 'actor', core.actor(), 'timezone', core.timezone());
$$;

---------------------------------------------------------------------------
-- Permisos de ejecución
---------------------------------------------------------------------------

revoke execute on all functions in schema core, api from public;

grant execute on function core.is_owner(), core.client_id(), core.actor() to authenticated;

grant execute on function
  api.save_area(uuid, text, text, text, text, integer),
  api.set_area_status(uuid, core.status),
  api.purge_area(uuid, text),
  api.save_form(uuid, uuid, text, text, text, core.cadence, integer),
  api.set_form_status(uuid, core.status),
  api.save_field(uuid, uuid, text, text, core.field_type, text, text, numeric, numeric, numeric, jsonb, jsonb, boolean, boolean, integer),
  api.set_field_status(uuid, core.status),
  api.add_entry(uuid, jsonb, uuid, timestamptz, date, text, text, uuid),
  api.void_entry(uuid, uuid, text),
  api.create_proposal(text, jsonb, text),
  api.decide_proposal(uuid, boolean, text),
  api.recent_activity(integer),
  api.whoami()
to authenticated;

grant usage on type core.status, core.cadence, core.field_type to authenticated;
