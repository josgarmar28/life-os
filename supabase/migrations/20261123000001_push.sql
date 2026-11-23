-- LIFE OS · Avisos en el iPhone (web push), gratis y sin servicios de terceros.
--
-- El navegador del dueño se suscribe desde Ajustes; la Edge Function "push" firma y cifra los avisos
-- (VAPID, con claves que genera ella y guarda aquí) y los envía al servicio de avisos de Apple o Google.
-- pg_cron (incluido en el plan gratuito) llama a la función cada 5 minutos; qué avisar lo decide
-- api.push_claim con la hora local, y cada aviso sale como mucho una vez al día.

create table core.push_subscription (
  id          uuid primary key default gen_random_uuid(),
  endpoint    text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh      text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth        text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  label       text not null default '' check (length(label) <= 80),
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fail_count  integer not null default 0
);

create table core.push_reminder (
  key        text primary key check (key in ('dia', 'semana')),
  enabled    boolean not null default true,
  at_time    time not null,
  -- Días ISO: 1 lunes … 7 domingo.
  days       smallint[] not null check (days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[] and cardinality(days) between 1 and 7),
  updated_at timestamptz not null default now()
);
-- Por defecto: "Empezar el día" a las 05:30 si falta el peso o el registro de mañana; la revisión
-- semanal, el domingo a las 17:00 (su hueco en la semana tipo).
insert into core.push_reminder (key, at_time, days) values
  ('dia', '05:30', array[1, 2, 3, 4, 5, 6, 7]),
  ('semana', '17:00', array[7]);

create table core.push_log (
  key        text not null,
  local_date date not null,
  sent_at    timestamptz not null default now(),
  primary key (key, local_date)
);

-- Claves VAPID y secreto de pg_cron: solo los lee la función (service_role), nunca el navegador.
create table core.push_config (
  singleton    boolean primary key default true check (singleton),
  public_key   text,
  private_jwk  jsonb,
  cron_secret  text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  function_url text,
  site_url     text
);
insert into core.push_config default values;

alter table core.push_subscription enable row level security;
alter table core.push_reminder enable row level security;
alter table core.push_log enable row level security;
alter table core.push_config enable row level security;
revoke all on core.push_subscription, core.push_reminder, core.push_log, core.push_config from public;

---------------------------------------------------------------------------
-- Dueño (dashboard). Claude no puede activar ni cambiar avisos.
---------------------------------------------------------------------------

create function api.push_settings() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(false);
  return jsonb_build_object(
    'public_key', (select public_key from core.push_config),
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'endpoint', endpoint, 'label', label,
        'created_at', created_at, 'last_ok_at', last_ok_at) order by created_at) from core.push_subscription), '[]'::jsonb),
    'reminders', (select jsonb_agg(jsonb_build_object('key', key, 'enabled', enabled, 'at', to_char(at_time, 'HH24:MI'),
        'days', days) order by key) from core.push_reminder));
end
$$;

create function api.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text default '') returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_id uuid;
begin
  perform core.require_owner(false);
  insert into core.push_subscription (endpoint, p256dh, auth, label)
  values (p_endpoint, p_p256dh, p_auth, left(coalesce(btrim(p_label), ''), 80))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, fail_count = 0
  returning id into v_id;
  perform core.audit('push.subscribe', 'core.push_subscription', v_id::text, jsonb_build_object('label', p_label));
  return v_id;
end
$$;

create function api.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(false);
  delete from core.push_subscription where endpoint = p_endpoint;
  perform core.audit('push.unsubscribe', 'core.push_subscription', null, '{}'::jsonb);
end
$$;

create function api.save_push_reminder(p_key text, p_enabled boolean, p_at time, p_days smallint[]) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(false);
  update core.push_reminder
     set enabled = p_enabled, at_time = p_at, days = (select array_agg(distinct d order by d) from unnest(p_days) d), updated_at = now()
   where key = p_key;
  if not found then
    raise exception 'reminder not found';
  end if;
  perform core.audit('push.reminder', 'core.push_reminder', p_key,
    jsonb_build_object('enabled', p_enabled, 'at', p_at, 'days', p_days));
end
$$;

---------------------------------------------------------------------------
-- Solo la función "push" (service_role).
---------------------------------------------------------------------------

-- Guarda las claves VAPID la primera vez (nunca las cambia: invalidaría las suscripciones) y las URL.
create function api.push_init(p_public_key text, p_private_jwk jsonb, p_function_url text, p_site_url text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  update core.push_config
     set public_key = coalesce(public_key, p_public_key),
         private_jwk = coalesce(private_jwk, p_private_jwk),
         function_url = coalesce(p_function_url, function_url),
         site_url = coalesce(p_site_url, site_url);
  return (select jsonb_build_object('public_key', public_key, 'private_jwk', private_jwk, 'cron_secret', cron_secret,
      'site_url', site_url) from core.push_config);
end
$$;

create function api.push_config() returns jsonb
language sql stable security definer set search_path = pg_catalog, core as
$$
  select jsonb_build_object('public_key', public_key, 'private_jwk', private_jwk, 'cron_secret', cron_secret,
    'site_url', site_url,
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth))
      from core.push_subscription), '[]'::jsonb))
  from core.push_config;
$$;

-- Avisos que tocan ahora. Cada uno se reserva en push_log antes de devolverlo: aunque pg_cron llame
-- dos veces, sale una sola vez al día. Ventana de 2 h por si la llamada llega tarde.
create function api.push_claim(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_local  timestamp := p_now at time zone core.timezone();
  v_date   date := v_local::date;
  v_out    jsonb := '[]'::jsonb;
  v_missing text;
  r        record;
begin
  for r in
    select * from core.push_reminder
     where enabled
       and extract(isodow from v_local)::smallint = any (days)
       and v_local >= v_date + at_time
       and v_local < v_date + at_time + interval '2 hours'
     order by key
  loop
    insert into core.push_log (key, local_date) values (r.key, v_date) on conflict do nothing;
    if not found then
      continue;
    end if;
    if r.key = 'dia' then
      -- Lo que falta de la mañana: peso y registro de mañana (si existen, están activos y son diarios).
      select string_agg(f.name, ' y ' order by m.o) into v_missing
        from (values (1, 'cuerpo', 'peso'), (2, 'sueno', 'manana')) m (o, area, form)
        join core.area a on a.slug = m.area and a.status = 'active'
        join core.form f on f.area_id = a.id and f.slug = m.form and f.status = 'active' and f.cadence = 'daily'
       where not exists (
         select 1 from core.entry e
          where e.form_id = f.id and e.local_date = v_date and not e.is_void
            and not exists (select 1 from core.entry n where n.supersedes_id = e.id));
      if v_missing is not null then
        v_out := v_out || jsonb_build_object('key', 'dia', 'title', 'Empezar el día', 'body', 'Falta: ' || v_missing || '.',
          'url', '/', 'tag', 'dia');
      end if;
    elsif r.key = 'semana' then
      v_out := v_out || jsonb_build_object('key', 'semana', 'title', 'Revisión semanal',
        'body', '30 min: hecho frente a planeado y la semana que viene.', 'url', '/semana', 'tag', 'semana');
    end if;
  end loop;
  delete from core.push_log where local_date < v_date - 30;
  return v_out;
end
$$;

-- Resultado de cada envío: un navegador dado de baja (404/410) se borra; 5 fallos seguidos, también.
create function api.push_report(p_endpoint text, p_status integer, p_gone boolean) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  if p_gone then
    delete from core.push_subscription where endpoint = p_endpoint;
  elsif p_status between 200 and 299 then
    update core.push_subscription set last_ok_at = now(), fail_count = 0 where endpoint = p_endpoint;
  else
    update core.push_subscription set fail_count = fail_count + 1 where endpoint = p_endpoint;
    delete from core.push_subscription where endpoint = p_endpoint and fail_count >= 5;
  end if;
end
$$;

grant usage on schema api to service_role;
revoke execute on function api.push_settings(), api.save_push_subscription(text, text, text, text),
  api.delete_push_subscription(text), api.save_push_reminder(text, boolean, time, smallint[]),
  api.push_init(text, jsonb, text, text), api.push_config(), api.push_claim(timestamptz),
  api.push_report(text, integer, boolean) from public;
grant execute on function api.push_settings(), api.save_push_subscription(text, text, text, text),
  api.delete_push_subscription(text), api.save_push_reminder(text, boolean, time, smallint[]) to authenticated;
grant execute on function api.push_init(text, jsonb, text, text), api.push_config(), api.push_claim(timestamptz),
  api.push_report(text, integer, boolean) to service_role;

---------------------------------------------------------------------------
-- Reloj: pg_cron llama a la función cada 5 minutos (solo en Supabase; en las pruebas no existe).
---------------------------------------------------------------------------

create function core.push_tick() returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  c core.push_config;
begin
  select * into c from core.push_config;
  if c.function_url is null or c.public_key is null or not exists (select 1 from core.push_subscription) then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := $2, timeout_milliseconds := 20000)'
    using c.function_url, jsonb_build_object('content-type', 'application/json', 'x-cron-secret', c.cron_secret);
end
$$;
revoke execute on function core.push_tick() from public;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'lifeos-push';
    perform cron.schedule('lifeos-push', '*/5 * * * *', 'select core.push_tick()');
  end if;
end
$$;
