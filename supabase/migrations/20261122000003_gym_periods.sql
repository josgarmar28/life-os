-- LIFE OS · Periodos en otro gimnasio.
-- Periodos en otro gimnasio (p. ej. "en España del 23 al 26"): cada día dentro de un periodo usa
-- la rutina de ese gimnasio; fuera de ellos, la de casa. Sin solapes. Claude puede registrarlos.

create table core.gym_period (
  id         uuid primary key default gen_random_uuid(),
  gym        text not null check (gym ~ '^[a-z][a-z0-9_]{0,39}$'),
  date_from  date not null,
  date_to    date not null,
  note       text not null default '' check (length(note) <= 500),
  actor      text not null,
  created_at timestamptz not null default now(),
  check (date_to >= date_from and date_to - date_from <= 366)
);
create index gym_period_from_idx on core.gym_period (date_from);

create function api.save_gym_period(p_gym text, p_from date, p_to date, p_note text default '', p_id uuid default null) returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_id uuid;
begin
  perform core.require_owner(true);
  perform pg_advisory_xact_lock(hashtext('core.gym_period'));
  if exists (select 1 from core.gym_period g
              where g.id is distinct from p_id and g.date_from <= p_to and g.date_to >= p_from) then
    raise exception 'gym period overlaps another one';
  end if;
  if p_id is null then
    insert into core.gym_period (gym, date_from, date_to, note, actor)
    values (p_gym, p_from, p_to, coalesce(btrim(p_note), ''), core.actor())
    returning id into v_id;
  else
    update core.gym_period
       set gym = p_gym, date_from = p_from, date_to = p_to, note = coalesce(btrim(p_note), ''), actor = core.actor()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'gym period not found';
    end if;
  end if;
  perform core.audit('gym_period.save', 'core.gym_period', v_id::text,
    jsonb_build_object('gym', p_gym, 'from', p_from, 'to', p_to));
  return v_id;
end
$$;

create function api.delete_gym_period(p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(true);
  delete from core.gym_period where id = p_id;
  if not found then
    raise exception 'gym period not found';
  end if;
  perform core.audit('gym_period.delete', 'core.gym_period', p_id::text, '{}'::jsonb);
end
$$;

alter table core.gym_period enable row level security;
create policy owner_read on core.gym_period for select to authenticated using (core.is_owner());
revoke all on core.gym_period from public;
grant select on core.gym_period to authenticated;

create view api.gym_periods with (security_invoker = true) as
  select id, gym, date_from, date_to, note, actor, created_at from core.gym_period;
grant select on api.gym_periods to authenticated;

revoke execute on function api.save_gym_period(text, date, date, text, uuid), api.delete_gym_period(uuid) from public;
grant execute on function api.save_gym_period(text, date, date, text, uuid), api.delete_gym_period(uuid) to authenticated;
