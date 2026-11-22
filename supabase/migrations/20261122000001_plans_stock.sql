-- LIFE OS · Horario, rutina y menú como planes; despensa y pedidos de la compra.
--
--  * core.plan: documentos versionados (horario semanal, rutina de entreno, menú con recetas y
--    productos). Cada cambio es una versión nueva con fecha de inicio; la vigente en un día es la
--    activa con la fecha de inicio más reciente que no lo pase. El contenido detallado lo valida
--    el TypeScript compartido (supabase/functions/_shared/plans.ts) antes de guardar; aquí se
--    comprueba la forma mínima y el tamaño.
--    Solo la sesión del dueño guarda planes; Claude los propone (kind 'plan.save').
--  * core.week_plan: lo que cambia cada semana (días de teletrabajo, días fuera de casa).
--  * core.stock_move: despensa como libro de movimientos (recuento, compra, ajuste), solo inserción.
--    El stock estimado se calcula restando el consumo previsto por el menú (shopping.ts).
--  * core.shopping_order: pedidos de la compra; al recibirlos se anotan como compras.
-- Los planes con datos reales NO están en el repositorio: se importan desde el dashboard.

---------------------------------------------------------------------------
-- Planes
---------------------------------------------------------------------------

create table core.plan (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('schedule', 'training', 'meals')),
  version     integer not null,
  name        text not null check (length(btrim(name)) between 1 and 120),
  valid_from  date not null,
  content     jsonb not null check (jsonb_typeof(content) = 'object'),
  status      core.status not null default 'active',
  source      text not null check (source in ('dashboard', 'claude', 'import')),
  actor       text not null,
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (kind, version)
);
create index plan_kind_from_idx on core.plan (kind, valid_from desc, version desc);

create function core.check_plan_content(p_kind text, p_content jsonb) returns void
language plpgsql immutable as
$$
declare
  v_key text;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'plan content must be a JSON object';
  end if;
  if pg_column_size(p_content) > 300000 then
    raise exception 'plan content is too large';
  end if;
  foreach v_key in array case p_kind
      when 'schedule' then array['blocks']
      when 'training' then array['days']
      when 'meals' then array['products', 'recipes', 'days']
      else array[]::text[] end
  loop
    if jsonb_typeof(p_content -> v_key) is distinct from 'array' then
      raise exception '% plan needs an array "%"', p_kind, v_key;
    end if;
  end loop;
end
$$;

-- Solo cambia el estado (archivar o reactivar); el contenido de una versión no se edita.
create function core.plan_guard() returns trigger
language plpgsql as
$$
begin
  if tg_op = 'DELETE' then
    raise exception 'plans cannot be deleted; archive them';
  end if;
  if new.kind <> old.kind or new.version <> old.version or new.name <> old.name or new.valid_from <> old.valid_from
     or new.content <> old.content or new.source <> old.source or new.actor <> old.actor or new.created_at <> old.created_at then
    raise exception 'a plan version is immutable; save a new version';
  end if;
  new.archived_at := case when new.status = 'archived' then coalesce(old.archived_at, now()) end;
  return new;
end
$$;
create trigger plan_guard before update or delete on core.plan for each row execute function core.plan_guard();

create function api.save_plan(p_kind text, p_name text, p_valid_from date, p_content jsonb) returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_id uuid;
  v_version integer;
begin
  perform core.require_owner(false);
  perform core.check_plan_content(p_kind, p_content);
  if p_valid_from is null then
    raise exception 'valid_from is required';
  end if;
  perform pg_advisory_xact_lock(hashtext('core.plan:' || coalesce(p_kind, '')));
  select coalesce(max(version), 0) + 1 into v_version from core.plan where kind = p_kind;
  insert into core.plan (kind, version, name, valid_from, content, source, actor)
  values (p_kind, v_version, btrim(p_name), p_valid_from, p_content,
          case when current_setting('lifeos.via_proposal', true) = 'on' then 'claude' else 'dashboard' end, core.actor())
  returning id into v_id;
  perform core.audit('plan.save', 'core.plan', v_id::text,
    jsonb_build_object('kind', p_kind, 'version', v_version, 'valid_from', p_valid_from));
  return v_id;
end
$$;

create function api.set_plan_status(p_id uuid, p_status core.status) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(false);
  update core.plan set status = p_status where id = p_id;
  if not found then
    raise exception 'plan not found';
  end if;
  perform core.audit('plan.' || p_status::text, 'core.plan', p_id::text, '{}'::jsonb);
end
$$;

---------------------------------------------------------------------------
-- Semana: teletrabajo y días fuera
---------------------------------------------------------------------------

create table core.week_plan (
  week_start date primary key check (extract(isodow from week_start) = 1),
  telework   smallint[] not null default '{}' check (telework <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  away       smallint[] not null default '{}' check (away <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  note       text not null default '' check (length(note) <= 500),
  actor      text not null,
  updated_at timestamptz not null default now()
);

create function api.save_week(p_week_start date, p_telework smallint[], p_away smallint[], p_note text default '') returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(true);
  -- Días ordenados y sin repetir, para que la semana se lea igual venga de donde venga.
  p_telework := array(select distinct d from unnest(coalesce(p_telework, '{}')) d order by d);
  p_away := array(select distinct d from unnest(coalesce(p_away, '{}')) d order by d);
  insert into core.week_plan (week_start, telework, away, note, actor)
  values (p_week_start, p_telework, p_away, coalesce(btrim(p_note), ''), core.actor())
  on conflict (week_start) do update
    set telework = excluded.telework, away = excluded.away, note = excluded.note,
        actor = excluded.actor, updated_at = now();
  perform core.audit('week.save', 'core.week_plan', p_week_start::text,
    jsonb_build_object('telework', p_telework, 'away', p_away));
end
$$;

---------------------------------------------------------------------------
-- Despensa: movimientos (solo inserción)
---------------------------------------------------------------------------

create table core.stock_move (
  id          uuid primary key default gen_random_uuid(),
  product     text not null check (product ~ '^[a-z][a-z0-9_]{0,39}$'),
  kind        text not null check (kind in ('count', 'purchase', 'adjust')),
  qty         numeric not null check (qty <> 'NaN'::numeric and abs(qty) < 1000000),
  note        text not null default '' check (length(note) <= 300),
  occurred_at timestamptz not null default now(),
  request_id  uuid not null,
  seq         integer not null,
  actor       text not null,
  created_at  timestamptz not null default now(),
  unique (request_id, seq),
  check (kind <> 'count' or qty >= 0),
  check (kind <> 'purchase' or qty > 0)
);
create index stock_move_product_idx on core.stock_move (product, occurred_at desc);
create trigger stock_move_append_only before update or delete on core.stock_move
  for each row execute function ops.deny_mutation();

-- p_moves: [{"product":"tofu","kind":"count","qty":600,"note":""}, ...] (cantidades en la unidad
-- del producto: g, ml o unidades). Idempotente por p_request_id.
create function api.record_stock(p_moves jsonb, p_request_id uuid, p_occurred_at timestamptz default null) returns integer
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_move jsonb;
  v_seq integer := 0;
  v_at timestamptz := coalesce(p_occurred_at, now());
begin
  perform core.require_owner(true);
  if p_request_id is null then
    raise exception 'request_id is required';
  end if;
  if exists (select 1 from core.stock_move where request_id = p_request_id) then
    return (select count(*) from core.stock_move where request_id = p_request_id);
  end if;
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) = 0 then
    raise exception 'moves must be a non-empty array';
  end if;
  if jsonb_array_length(p_moves) > 300 then
    raise exception 'too many moves';
  end if;
  if v_at > now() + interval '5 minutes' then
    raise exception 'occurred_at is in the future';
  end if;
  for v_move in select value from jsonb_array_elements(p_moves) loop
    v_seq := v_seq + 1;
    if jsonb_typeof(v_move -> 'qty') is distinct from 'number' then
      raise exception 'each move needs a numeric qty';
    end if;
    insert into core.stock_move (product, kind, qty, note, occurred_at, request_id, seq, actor)
    values (v_move ->> 'product', v_move ->> 'kind', (v_move ->> 'qty')::numeric, coalesce(btrim(v_move ->> 'note'), ''),
            v_at, p_request_id, v_seq, core.actor());
  end loop;
  perform core.audit('stock.record', 'core.stock_move', p_request_id::text, jsonb_build_object('moves', v_seq));
  return v_seq;
end
$$;

---------------------------------------------------------------------------
-- Pedidos de la compra
---------------------------------------------------------------------------

create table core.shopping_order (
  id            uuid primary key default gen_random_uuid(),
  status        text not null default 'ordered' check (status in ('ordered', 'received', 'cancelled')),
  delivery_date date not null,
  items         jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 300),
  total         numeric check (total is null or total >= 0),
  note          text not null default '' check (length(note) <= 500),
  request_id    uuid not null unique,
  actor         text not null,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index shopping_order_date_idx on core.shopping_order (delivery_date desc);

create function core.order_guard() returns trigger
language plpgsql as
$$
begin
  if tg_op = 'DELETE' then
    raise exception 'orders cannot be deleted; cancel them';
  end if;
  if old.status <> 'ordered' then
    raise exception 'order already closed';
  end if;
  if new.items <> old.items or new.request_id <> old.request_id or new.actor <> old.actor or new.created_at <> old.created_at then
    raise exception 'order content is immutable';
  end if;
  return new;
end
$$;
create trigger order_guard before update or delete on core.shopping_order for each row execute function core.order_guard();

-- p_items: [{"product":"tofu","packages":2,"amount":600,"price":2.3}] (amount = cantidad total en la unidad del producto).
create function api.save_order(p_delivery_date date, p_items jsonb, p_request_id uuid, p_total numeric default null, p_note text default '')
returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_id uuid;
  v_item jsonb;
begin
  perform core.require_owner(true);
  select id into v_id from core.shopping_order where request_id = p_request_id;
  if found then
    return v_id;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'an order needs at least one item';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item ->> 'product', '') !~ '^[a-z][a-z0-9_]{0,39}$'
       or jsonb_typeof(v_item -> 'packages') is distinct from 'number' or (v_item ->> 'packages')::numeric <= 0
       or jsonb_typeof(v_item -> 'amount') is distinct from 'number' or (v_item ->> 'amount')::numeric <= 0 then
      raise exception 'each item needs product, packages > 0 and amount > 0';
    end if;
  end loop;
  insert into core.shopping_order (delivery_date, items, total, note, request_id, actor)
  values (p_delivery_date, p_items, p_total, coalesce(btrim(p_note), ''), p_request_id, core.actor())
  returning id into v_id;
  perform core.audit('order.create', 'core.shopping_order', v_id::text,
    jsonb_build_object('delivery_date', p_delivery_date, 'items', jsonb_array_length(p_items)));
  return v_id;
end
$$;

-- Recibir: p_items = lo que llegó de verdad (mismo formato); cada artículo entra como compra.
create function api.receive_order(p_id uuid, p_items jsonb, p_request_id uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_order core.shopping_order%rowtype;
  v_moves jsonb;
  v_n integer;
begin
  perform core.require_owner(true);
  if exists (select 1 from core.stock_move where request_id = p_request_id) then
    return (select count(*) from core.stock_move where request_id = p_request_id);
  end if;
  select * into v_order from core.shopping_order where id = p_id for update;
  if not found then
    raise exception 'order not found';
  end if;
  if v_order.status <> 'ordered' then
    raise exception 'order already closed';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('product', i ->> 'product', 'kind', 'purchase',
                                               'qty', (i ->> 'amount')::numeric, 'note', 'pedido')), '[]')
    into v_moves
    from jsonb_array_elements(coalesce(p_items, '[]')) i
   where (i ->> 'amount')::numeric > 0;
  v_n := 0;
  if jsonb_array_length(v_moves) > 0 then
    v_n := api.record_stock(v_moves, p_request_id, now());
  end if;
  update core.shopping_order set status = 'received', decided_at = now() where id = p_id;
  perform core.audit('order.received', 'core.shopping_order', p_id::text, jsonb_build_object('moves', v_n));
  return v_n;
end
$$;

create function api.cancel_order(p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(true);
  update core.shopping_order set status = 'cancelled', decided_at = now() where id = p_id and status = 'ordered';
  if not found then
    raise exception 'order not found or already closed';
  end if;
  perform core.audit('order.cancelled', 'core.shopping_order', p_id::text, '{}'::jsonb);
end
$$;

---------------------------------------------------------------------------
-- Propuestas: Claude propone planes; el dueño los aprueba
---------------------------------------------------------------------------

alter table core.proposal drop constraint proposal_kind_check;
alter table core.proposal add constraint proposal_kind_check
  check (kind in ('area.save', 'form.save', 'field.save', 'form.archive', 'field.archive', 'note', 'plan.save'));

create or replace function core.apply_proposal(p core.proposal) returns jsonb
language plpgsql as
$$
declare
  x jsonb := p.payload;
  v_id uuid;
  v_area uuid;
  v_fields jsonb := '[]';
  f jsonb;
  i integer := 0;
begin
  case p.kind
    when 'area.save' then
      v_id := coalesce((x ->> 'id')::uuid, (select id from core.area where slug = x ->> 'slug'));
      v_id := api.save_area(v_id, x ->> 'slug', x ->> 'name', coalesce(x ->> 'description', ''),
                            coalesce(x ->> 'icon', ''), coalesce((x ->> 'sort_order')::integer, 100));
    when 'form.save' then
      v_area := core.proposal_area_id(x);
      v_id := coalesce((x ->> 'id')::uuid, (select id from core.form where area_id = v_area and slug = x ->> 'slug'));
      v_id := api.save_form(v_id, v_area, x ->> 'slug', x ->> 'name',
                            coalesce(x ->> 'description', ''), coalesce((x ->> 'cadence')::core.cadence, 'free'),
                            coalesce((x ->> 'sort_order')::integer, 100));
      if jsonb_typeof(x -> 'fields') = 'array' then
        for f in select value from jsonb_array_elements(x -> 'fields')
        loop
          i := i + 1;
          v_fields := v_fields || to_jsonb(core.proposal_save_field(v_id, f, i * 10));
        end loop;
      end if;
      return jsonb_build_object('id', v_id, 'fields', v_fields);
    when 'field.save' then
      v_id := core.proposal_save_field(core.proposal_form_id(x), x, 100);
    when 'form.archive' then
      v_id := coalesce((x ->> 'id')::uuid, core.proposal_form_id(x || jsonb_build_object('form', coalesce(x ->> 'form', x ->> 'slug'))));
      perform api.set_form_status(v_id, 'archived');
    when 'field.archive' then
      v_id := coalesce((x ->> 'id')::uuid,
                       (select id from core.field where form_id = core.proposal_form_id(x) and key = x ->> 'key'));
      if v_id is null then raise exception 'field "%" not found', x ->> 'key'; end if;
      perform api.set_field_status(v_id, 'archived');
    when 'plan.save' then
      perform set_config('lifeos.via_proposal', 'on', true);
      v_id := api.save_plan(x ->> 'kind', x ->> 'name', (x ->> 'valid_from')::date, x -> 'content');
      perform set_config('lifeos.via_proposal', 'off', true);
    when 'note' then
      return jsonb_build_object('acknowledged', true);
  end case;
  return jsonb_build_object('id', v_id);
end
$$;

---------------------------------------------------------------------------
-- Registro por serie: columna "linea" para enlazar cada serie con su ejercicio del plan
---------------------------------------------------------------------------

update core.field fd
   set columns = fd.columns || '[{"key":"linea","label":"Línea del plan","type":"text"}]'::jsonb
  from core.form f, core.area a
 where fd.form_id = f.id and f.area_id = a.id and a.slug = 'entreno' and f.slug = 'sesion' and fd.key = 'series'
   and not exists (select 1 from jsonb_array_elements(fd.columns) c where c ->> 'key' = 'linea');

---------------------------------------------------------------------------
-- Lectura y permisos
---------------------------------------------------------------------------

alter table core.plan enable row level security;
alter table core.week_plan enable row level security;
alter table core.stock_move enable row level security;
alter table core.shopping_order enable row level security;

create policy owner_read on core.plan for select to authenticated using (core.is_owner());
create policy owner_read on core.week_plan for select to authenticated using (core.is_owner());
create policy owner_read on core.stock_move for select to authenticated using (core.is_owner());
create policy owner_read on core.shopping_order for select to authenticated using (core.is_owner());

revoke all on core.plan, core.week_plan, core.stock_move, core.shopping_order from public;
grant select on core.plan, core.week_plan, core.stock_move, core.shopping_order to authenticated;

create view api.plans with (security_invoker = true) as
  select id, kind, version, name, valid_from, content, status, source, actor, created_at, archived_at from core.plan;
create view api.weeks with (security_invoker = true) as
  select week_start, telework, away, note, actor, updated_at from core.week_plan;
create view api.stock_moves with (security_invoker = true) as
  select id, product, kind, qty, note, occurred_at, request_id, seq, actor, created_at from core.stock_move;
create view api.shopping_orders with (security_invoker = true) as
  select id, status, delivery_date, items, total, note, actor, created_at, decided_at from core.shopping_order;
grant select on api.plans, api.weeks, api.stock_moves, api.shopping_orders to authenticated;

revoke execute on function
  core.check_plan_content(text, jsonb),
  api.save_plan(text, text, date, jsonb),
  api.set_plan_status(uuid, core.status),
  api.save_week(date, smallint[], smallint[], text),
  api.record_stock(jsonb, uuid, timestamptz),
  api.save_order(date, jsonb, uuid, numeric, text),
  api.receive_order(uuid, jsonb, uuid),
  api.cancel_order(uuid)
from public;

grant execute on function
  api.save_plan(text, text, date, jsonb),
  api.set_plan_status(uuid, core.status),
  api.save_week(date, smallint[], smallint[], text),
  api.record_stock(jsonb, uuid, timestamptz),
  api.save_order(date, jsonb, uuid, numeric, text),
  api.receive_order(uuid, jsonb, uuid),
  api.cancel_order(uuid)
to authenticated;
