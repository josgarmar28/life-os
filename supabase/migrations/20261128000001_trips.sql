-- LIFE OS · Modo viaje (ADR-0004).
-- Un viaje (a España, o "viene ella") junta en una sola operación lo que antes eran pasos sueltos:
--   * el periodo en otro gimnasio (core.gym_period),
--   * los días fuera de casa y de teletrabajo de cada semana (core.week_plan),
--   * el checklist del viaje (marcas guardadas aquí).
-- El cálculo (qué días están fuera, qué gimnasio, qué teletrabajo) lo hace TypeScript compartido
-- (_shared/trip.ts) y llega aquí ya resuelto; la base de datos valida, aplica todo en una transacción y
-- guarda QUÉ añadió a cada semana, para que cancelar revierta solo eso y no pise lo que él haya elegido.
-- Nada se borra: cancelar deja el viaje con estado 'cancelled'.

create table core.trip (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('espana', 'visita')),
  date_from         date not null,
  date_to           date not null,
  leave_time        time,
  return_leave_time time,
  return_home_time  time,
  vacation_from     date,
  vacation_to       date,
  gym               text check (gym is null or gym ~ '^[a-z][a-z0-9_]{0,39}$'),
  gym_opens         time,
  commute_min       smallint check (commute_min is null or commute_min between 0 and 180),
  gym_from          date,
  gym_to            date,
  gym_period_id     uuid references core.gym_period (id) on delete set null,
  away_dates        date[] not null default '{}',
  remote_dates      date[] not null default '{}',
  night_dates       date[] not null default '{}',
  -- Lo que este viaje añadió a cada semana: { "2027-01-04": { "telework": [..], "away": [..], "created": bool, "base": [..] } }
  added             jsonb not null default '{}'::jsonb,
  checklist         jsonb not null default '{}'::jsonb,
  note              text not null default '' check (length(note) <= 500),
  status            text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  request_id        uuid not null unique,
  actor             text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (date_to >= date_from and date_to - date_from <= 60),
  check ((vacation_from is null) = (vacation_to is null)),
  check (vacation_from is null or (vacation_to >= vacation_from and vacation_from >= date_from and vacation_to <= date_to)),
  check ((gym is null) = (gym_from is null) and (gym is null) = (gym_to is null)),
  check (gym_from is null or (gym_to >= gym_from and gym_from >= date_from and gym_to <= date_to)),
  check (kind = 'espana' or gym is null)
);
create index trip_from_idx on core.trip (date_from) where status <> 'cancelled';

create trigger trip_touch before update on core.trip for each row execute function core.touch();

---------------------------------------------------------------------------
-- Revertir lo que un viaje añadió (uso interno)
---------------------------------------------------------------------------

create function core.trip_revert(p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  t core.trip;
  w record;
  v_cur core.week_plan;
  v_tele smallint[];
  v_away smallint[];
  v_base smallint[];
begin
  select * into t from core.trip where id = p_id for update;
  if not found then
    raise exception 'trip not found';
  end if;
  for w in select key as week_start, value as a from jsonb_each(t.added) loop
    select * into v_cur from core.week_plan where week_start = w.week_start::date for update;
    if not found then
      continue;
    end if;
    v_tele := array(select (x)::smallint from jsonb_array_elements_text(coalesce(w.a -> 'telework', '[]'::jsonb)) x);
    v_away := array(select (x)::smallint from jsonb_array_elements_text(coalesce(w.a -> 'away', '[]'::jsonb)) x);
    v_base := array(select (x)::smallint from jsonb_array_elements_text(coalesce(w.a -> 'base', '[]'::jsonb)) x);
    if coalesce((w.a ->> 'created')::boolean, false)
       and v_cur.note = ''
       and v_cur.telework = array(select distinct d from unnest(v_base || v_tele) d order by d)
       and v_cur.away = array(select distinct d from unnest(v_away) d order by d) then
      -- La semana la creó el viaje y nadie la ha tocado: vuelve a "sin elegir" (teletrabajo por defecto).
      delete from core.week_plan where week_start = w.week_start::date;
    else
      update core.week_plan
         set telework = array(select d from unnest(telework) d where d <> all (v_tele) order by d),
             away = array(select d from unnest(away) d where d <> all (v_away) order by d),
             actor = core.actor(), updated_at = now()
       where week_start = w.week_start::date;
    end if;
  end loop;
  if t.gym_period_id is not null then
    delete from core.gym_period where id = t.gym_period_id;
  end if;
  update core.trip set added = '{}'::jsonb, gym_period_id = null where id = p_id;
end
$$;

---------------------------------------------------------------------------
-- Guardar un viaje (crear o editar) y cancelarlo
---------------------------------------------------------------------------

create function api.save_trip(p_trip jsonb, p_request_id uuid, p_id uuid default null) returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_id        uuid;
  v_kind      text := p_trip ->> 'kind';
  v_from      date := (p_trip ->> 'date_from')::date;
  v_to        date := (p_trip ->> 'date_to')::date;
  v_gym       text := nullif(p_trip ->> 'gym', '');
  v_gym_from  date := (p_trip ->> 'gym_from')::date;
  v_gym_to    date := (p_trip ->> 'gym_to')::date;
  v_away      date[];
  v_remote    date[];
  v_nights    date[];
  v_period    uuid;
  v_added     jsonb := '{}'::jsonb;
  v_status    text;
  w           jsonb;
  v_ws        date;
  v_base      smallint[];
  v_add_t     smallint[];
  v_add_a     smallint[];
  v_cur       core.week_plan;
  v_new_t     smallint[];
  v_new_a     smallint[];
begin
  perform core.require_owner(true);
  perform pg_advisory_xact_lock(hashtext('core.trip'));

  if p_id is null then
    select id into v_id from core.trip where request_id = p_request_id;
    if found then
      return v_id;
    end if;
  else
    select status into v_status from core.trip where id = p_id;
    if not found then
      raise exception 'trip not found';
    end if;
    if v_status <> 'planned' then
      raise exception 'only a planned trip can be edited';
    end if;
  end if;

  if v_kind is null or v_from is null or v_to is null then
    raise exception 'trip needs kind, date_from and date_to';
  end if;
  v_away := array(select (x)::date from jsonb_array_elements_text(coalesce(p_trip -> 'away_dates', '[]'::jsonb)) x);
  v_remote := array(select (x)::date from jsonb_array_elements_text(coalesce(p_trip -> 'remote_dates', '[]'::jsonb)) x);
  v_nights := array(select (x)::date from jsonb_array_elements_text(coalesce(p_trip -> 'night_dates', '[]'::jsonb)) x);
  if exists (select 1 from unnest(v_away || v_remote || v_nights) d where d < v_from or d > v_to) then
    raise exception 'trip dates outside the trip range';
  end if;

  if p_id is not null then
    perform core.trip_revert(p_id);
  end if;

  if exists (select 1 from core.trip t
              where t.status <> 'cancelled' and t.id is distinct from p_id and t.date_from <= v_to and t.date_to >= v_from) then
    raise exception 'trip overlaps another one';
  end if;

  if v_gym is not null then
    if v_gym_from is null or v_gym_to is null then
      raise exception 'gym needs gym_from and gym_to';
    end if;
    if exists (select 1 from core.gym_period g where g.date_from <= v_gym_to and g.date_to >= v_gym_from) then
      raise exception 'gym period overlaps another one';
    end if;
    insert into core.gym_period (gym, date_from, date_to, note, actor)
    values (v_gym, v_gym_from, v_gym_to, 'Viaje', core.actor())
    returning id into v_period;
  end if;

  -- Semanas: se añade (unión) a lo que hubiera; si no había fila, se parte del teletrabajo por defecto.
  for w in select value from jsonb_array_elements(coalesce(p_trip -> 'weeks', '[]'::jsonb)) loop
    v_ws := (w ->> 'week_start')::date;
    if extract(isodow from v_ws) <> 1 then
      raise exception 'week_start must be a Monday';
    end if;
    if v_ws < v_from - 6 or v_ws > v_to then
      raise exception 'week outside the trip range';
    end if;
    v_base := array(select (x)::smallint from jsonb_array_elements_text(coalesce(w -> 'telework_base', '[]'::jsonb)) x);
    v_add_t := array(select (x)::smallint from jsonb_array_elements_text(coalesce(w -> 'add_telework', '[]'::jsonb)) x);
    v_add_a := array(select (x)::smallint from jsonb_array_elements_text(coalesce(w -> 'add_away', '[]'::jsonb)) x);
    select * into v_cur from core.week_plan where week_start = v_ws for update;
    if found then
      v_new_t := array(select distinct d from unnest(v_cur.telework || v_add_t) d order by d);
      v_new_a := array(select distinct d from unnest(v_cur.away || v_add_a) d order by d);
      v_added := v_added || jsonb_build_object(v_ws::text, jsonb_build_object(
        'created', false,
        'telework', to_jsonb(array(select d from unnest(v_add_t) d where d <> all (v_cur.telework) order by d)),
        'away', to_jsonb(array(select d from unnest(v_add_a) d where d <> all (v_cur.away) order by d))));
      update core.week_plan set telework = v_new_t, away = v_new_a, actor = core.actor(), updated_at = now()
       where week_start = v_ws;
    else
      v_new_t := array(select distinct d from unnest(v_base || v_add_t) d order by d);
      v_new_a := array(select distinct d from unnest(v_add_a) d order by d);
      v_added := v_added || jsonb_build_object(v_ws::text, jsonb_build_object(
        'created', true, 'base', to_jsonb(array(select distinct d from unnest(v_base) d order by d)),
        'telework', to_jsonb(v_add_t), 'away', to_jsonb(v_add_a)));
      insert into core.week_plan (week_start, telework, away, note, actor) values (v_ws, v_new_t, v_new_a, '', core.actor());
    end if;
  end loop;

  if p_id is null then
    insert into core.trip (kind, date_from, date_to, leave_time, return_leave_time, return_home_time, vacation_from, vacation_to,
                           gym, gym_opens, commute_min, gym_from, gym_to, gym_period_id, away_dates, remote_dates, night_dates,
                           added, note, request_id, actor)
    values (v_kind, v_from, v_to, (p_trip ->> 'leave_time')::time, (p_trip ->> 'return_leave_time')::time, (p_trip ->> 'return_home_time')::time,
            (p_trip ->> 'vacation_from')::date, (p_trip ->> 'vacation_to')::date,
            v_gym, (p_trip ->> 'gym_opens')::time, (p_trip ->> 'commute_min')::smallint, v_gym_from, v_gym_to, v_period,
            v_away, v_remote, v_nights, v_added, coalesce(btrim(p_trip ->> 'note'), ''), p_request_id, core.actor())
    returning id into v_id;
  else
    update core.trip
       set kind = v_kind, date_from = v_from, date_to = v_to,
           leave_time = (p_trip ->> 'leave_time')::time, return_leave_time = (p_trip ->> 'return_leave_time')::time,
           return_home_time = (p_trip ->> 'return_home_time')::time,
           vacation_from = (p_trip ->> 'vacation_from')::date, vacation_to = (p_trip ->> 'vacation_to')::date,
           gym = v_gym, gym_opens = (p_trip ->> 'gym_opens')::time, commute_min = (p_trip ->> 'commute_min')::smallint,
           gym_from = v_gym_from, gym_to = v_gym_to, gym_period_id = v_period,
           away_dates = v_away, remote_dates = v_remote, night_dates = v_nights, added = v_added,
           note = coalesce(btrim(p_trip ->> 'note'), ''), actor = core.actor()
     where id = p_id
    returning id into v_id;
  end if;

  perform core.audit('trip.save', 'core.trip', v_id::text,
    jsonb_build_object('kind', v_kind, 'from', v_from, 'to', v_to, 'gym', v_gym, 'edit', p_id is not null));
  return v_id;
end
$$;

create function api.cancel_trip(p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_status text;
begin
  perform core.require_owner(true);
  perform pg_advisory_xact_lock(hashtext('core.trip'));
  select status into v_status from core.trip where id = p_id;
  if not found then
    raise exception 'trip not found';
  end if;
  if v_status = 'cancelled' then
    return;
  end if;
  perform core.trip_revert(p_id);
  update core.trip set status = 'cancelled', actor = core.actor() where id = p_id;
  perform core.audit('trip.cancel', 'core.trip', p_id::text, '{}'::jsonb);
end
$$;

-- "Ya he vuelto": cierra el viaje sin deshacer nada (los días pasados quedan como estaban).
create function api.finish_trip(p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(false);
  update core.trip set status = 'done', actor = core.actor() where id = p_id and status = 'planned';
  if not found and not exists (select 1 from core.trip where id = p_id) then
    raise exception 'trip not found';
  end if;
  perform core.audit('trip.finish', 'core.trip', p_id::text, '{}'::jsonb);
end
$$;

-- Marca o desmarca un paso del checklist (solo él, desde el dashboard).
create function api.set_trip_item(p_id uuid, p_key text, p_done boolean) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(false);
  if p_key is null or p_key !~ '^[a-z][a-z0-9_-]{0,39}$' then
    raise exception 'invalid checklist key';
  end if;
  update core.trip
     set checklist = case when p_done then checklist || jsonb_build_object(p_key, true) else checklist - p_key end
   where id = p_id and status <> 'cancelled';
  if not found then
    raise exception 'trip not found';
  end if;
end
$$;

---------------------------------------------------------------------------
-- Lectura y permisos
---------------------------------------------------------------------------

alter table core.trip enable row level security;
create policy owner_read on core.trip for select to authenticated using (core.is_owner());
revoke all on core.trip from public;
grant select on core.trip to authenticated;

create view api.trips with (security_invoker = true) as
  select id, kind, date_from, date_to, leave_time, return_leave_time, return_home_time, vacation_from, vacation_to,
         gym, gym_opens, commute_min, gym_from, gym_to, away_dates, remote_dates, night_dates, checklist, note, status,
         actor, created_at, updated_at
    from core.trip;
grant select on api.trips to authenticated;

revoke execute on function
  core.trip_revert(uuid),
  api.save_trip(jsonb, uuid, uuid),
  api.cancel_trip(uuid),
  api.finish_trip(uuid),
  api.set_trip_item(uuid, text, boolean)
from public;

grant execute on function
  api.save_trip(jsonb, uuid, uuid),
  api.cancel_trip(uuid),
  api.finish_trip(uuid),
  api.set_trip_item(uuid, text, boolean)
to authenticated;
