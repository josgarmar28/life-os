-- LIFE OS · Armario virtual (fase 1): armarios, prendas, fotos y traslados.
--
-- Modelo (docs/adr/0003-armario-virtual.md):
--  * Tablas propias (el motor de áreas no maneja fotos ni relaciones). Mismo reparto que el resto:
--    escritura solo por funciones `api.*` (security definer), lectura por vistas `security_invoker` + RLS de dueño.
--  * Una prenda está en UN armario (o en tránsito: closet_id nulo). Cada traslado queda en core.garment_move.
--  * Nada se borra: una prenda se archiva (status = 'archived').
--  * Claude puede: mover prendas, marcar usadas/limpias y guardar el análisis. No crea ni edita la ficha.
--  * Fotos: bucket PRIVADO `wardrobe`, sin URL públicas (URL firmadas). Solo el dueño sube; Claude solo lee.
--    Las fotos corporales no entran nunca aquí (el sistema solo guarda ropa).

---------------------------------------------------------------------------
-- Armarios
---------------------------------------------------------------------------

create table core.closet (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 30),
  name        text not null check (length(btrim(name)) between 1 and 40),
  country     text check (country ~ '^[A-Z]{2}$'),
  note        text not null default '' check (length(note) <= 300),
  sort_order  integer not null default 100,
  status      core.status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);
create trigger closet_touch before update on core.closet for each row execute function core.touch();

-- Los dos armarios de partida (estructura, no datos personales). Se pueden renombrar y añadir más.
insert into core.closet (slug, name, country, sort_order) values
  ('suiza', 'Suiza', 'CH', 10),
  ('espana', 'España', 'ES', 20);

---------------------------------------------------------------------------
-- Prendas
---------------------------------------------------------------------------

create function core.is_slug_array(p text[], p_max integer) returns boolean
language sql immutable as
$$
  select p is not null and cardinality(p) <= p_max
     and not exists (select 1 from unnest(p) x where x is null or x !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(x) > 30);
$$;

create table core.garment (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 1 and 80),
  category     text not null check (category ~ '^[a-z][a-z0-9_]{0,29}$'),
  subtype      text not null default '' check (length(subtype) <= 40),
  colors       text[] not null default '{}' check (core.is_slug_array(colors, 3)),
  pattern      text check (pattern ~ '^[a-z][a-z0-9_]{0,29}$'),
  material     text not null default '' check (length(material) <= 160),
  fit          text check (fit in ('slim', 'regular', 'oversize')),
  size         text not null default '' check (length(size) <= 20),
  quantity     smallint not null default 1 check (quantity between 1 and 99),
  brand        text not null default '' check (length(brand) <= 60),
  store        text not null default '' check (length(store) <= 60),
  price        numeric(10, 2) check (price is null or price >= 0),
  currency     text not null default 'CHF' check (currency ~ '^[A-Z]{3}$'),
  purchased_on date,
  status       text not null default 'active' check (status in ('active', 'repair', 'donate', 'archived')),
  seasons      text[] not null default '{}' check (seasons <@ array['primavera', 'verano', 'otono', 'invierno']),
  formality    smallint check (formality between 1 and 5),
  warmth       smallint check (warmth between 1 and 5),
  care_program text check (care_program in ('lavadora_30', 'lavadora_40', 'lavadora_60', 'delicado', 'mano', 'tintoreria', 'sin_lavar')),
  care_dry     text check (care_dry in ('secadora', 'tendedero', 'plano', 'colgar')),
  care_iron    text check (care_iron in ('no', 'bajo', 'medio', 'alto')),
  care_note    text not null default '' check (length(care_note) <= 500),
  notes        text not null default '' check (length(notes) <= 1000),
  closet_id    uuid references core.closet (id),
  worn         boolean not null default false,
  worn_at      timestamptz,
  analysis     jsonb check (analysis is null or (jsonb_typeof(analysis) = 'object' and length(analysis::text) <= 8000)),
  analysis_at  timestamptz,
  analysis_by  text,
  request_id   uuid unique,
  actor        text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create index garment_closet_idx on core.garment (closet_id) where status <> 'archived';
create index garment_category_idx on core.garment (category);

create table core.garment_photo (
  id          uuid primary key default gen_random_uuid(),
  garment_id  uuid not null references core.garment (id),
  kind        text not null check (kind in ('main', 'label', 'detail')),
  path        text not null check (path ~ '^[0-9a-f-]{36}/[0-9a-z-]{1,60}\.(png|jpg)$'),
  thumb_path  text not null check (thumb_path ~ '^[0-9a-f-]{36}/[0-9a-z-]{1,60}\.(png|jpg)$'),
  width       integer not null check (width between 1 and 4096),
  height      integer not null check (height between 1 and 4096),
  bytes       integer not null check (bytes between 1 and 3000000),
  created_at  timestamptz not null default now(),
  unique (garment_id, kind)
);

create table core.garment_move (
  id          uuid primary key default gen_random_uuid(),
  garment_id  uuid not null references core.garment (id),
  from_closet uuid references core.closet (id),
  to_closet   uuid references core.closet (id),
  note        text not null default '' check (length(note) <= 300),
  request_id  uuid not null,
  actor       text not null,
  occurred_at timestamptz not null default now(),
  unique (request_id, garment_id)
);
create index garment_move_garment_idx on core.garment_move (garment_id, occurred_at desc);

-- Los traslados no se editan ni se borran.
create trigger garment_move_append_only before update or delete on core.garment_move
  for each row execute function core.deny_mutation_unless_purge();

---------------------------------------------------------------------------
-- Escritura (solo por estas funciones)
---------------------------------------------------------------------------

create function api.save_closet(p_name text, p_country text default null, p_note text default '', p_id uuid default null) returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_id uuid;
  v_slug text;
begin
  perform core.require_owner(false);
  if p_id is null then
    v_slug := regexp_replace(lower(translate(btrim(p_name), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^a-z0-9]+', '-', 'g');
    v_slug := btrim(left(v_slug, 30), '-');
    if v_slug = '' or exists (select 1 from core.closet where slug = v_slug) then
      v_slug := left(coalesce(nullif(v_slug, ''), 'armario'), 22) || '-' || substr(gen_random_uuid()::text, 1, 6);
    end if;
    insert into core.closet (slug, name, country, note, sort_order)
    values (v_slug, btrim(p_name), nullif(upper(btrim(p_country)), ''), coalesce(btrim(p_note), ''),
            100 + (select count(*)::integer from core.closet))
    returning id into v_id;
  else
    update core.closet
       set name = btrim(p_name), country = nullif(upper(btrim(p_country)), ''), note = coalesce(btrim(p_note), '')
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'closet not found';
    end if;
  end if;
  perform core.audit('closet.save', 'core.closet', v_id::text, jsonb_build_object('name', p_name));
  return v_id;
end
$$;

create function api.set_closet_status(p_id uuid, p_status core.status) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(false);
  if p_status = 'archived' and exists (select 1 from core.garment where closet_id = p_id and status <> 'archived') then
    raise exception 'closet still has garments; move them first';
  end if;
  update core.closet set status = p_status where id = p_id;
  if not found then
    raise exception 'closet not found';
  end if;
  perform core.audit('closet.status', 'core.closet', p_id::text, jsonb_build_object('status', p_status));
end
$$;

-- Crea o modifica la ficha de una prenda. p_data lleva solo las claves a cambiar.
-- El armario se fija al crear; luego solo se cambia con api.move_garments (queda el traslado).
create function api.save_garment(p_data jsonb, p_id uuid default null, p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_allowed text[] := array['name', 'category', 'subtype', 'colors', 'pattern', 'material', 'fit', 'size', 'brand', 'store',
    'price', 'currency', 'purchased_on', 'status', 'seasons', 'formality', 'warmth', 'care_program', 'care_dry', 'care_iron',
    'care_note', 'notes', 'closet_id', 'quantity'];
  v_bad text[];
  v_old core.garment;
  v_new core.garment;
  v_id uuid;
begin
  perform core.require_owner(false);
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'data must be a JSON object';
  end if;
  select array_agg(k) into v_bad from jsonb_object_keys(p_data) k where k <> all (v_allowed);
  if v_bad is not null then
    raise exception 'unknown garment fields: %', array_to_string(v_bad, ', ');
  end if;

  if p_id is null then
    if p_request_id is not null then
      select id into v_id from core.garment where request_id = p_request_id;
      if v_id is not null then
        return v_id;
      end if;
    end if;
    v_new := jsonb_populate_record(null::core.garment, p_data);
    if v_new.name is null or v_new.category is null then
      raise exception 'name and category are required';
    end if;
    if v_new.closet_id is not null and not exists (select 1 from core.closet where id = v_new.closet_id and status = 'active') then
      raise exception 'closet not found or archived';
    end if;
    insert into core.garment (name, category, subtype, colors, pattern, material, fit, size, quantity, brand, store, price, currency,
      purchased_on, status, seasons, formality, warmth, care_program, care_dry, care_iron, care_note, notes, closet_id,
      request_id, actor)
    values (btrim(v_new.name), v_new.category, coalesce(btrim(v_new.subtype), ''), coalesce(v_new.colors, '{}'), v_new.pattern,
      coalesce(btrim(v_new.material), ''), v_new.fit, coalesce(btrim(v_new.size), ''), coalesce(v_new.quantity, 1), coalesce(btrim(v_new.brand), ''),
      coalesce(btrim(v_new.store), ''), v_new.price, coalesce(v_new.currency, 'CHF'), v_new.purchased_on,
      coalesce(v_new.status, 'active'), coalesce(v_new.seasons, '{}'), v_new.formality, v_new.warmth, v_new.care_program,
      v_new.care_dry, v_new.care_iron, coalesce(btrim(v_new.care_note), ''), coalesce(btrim(v_new.notes), ''),
      v_new.closet_id, p_request_id, core.actor())
    returning id into v_id;
    if v_new.closet_id is not null then
      insert into core.garment_move (garment_id, from_closet, to_closet, note, request_id, actor)
      values (v_id, null, v_new.closet_id, 'alta', coalesce(p_request_id, gen_random_uuid()), core.actor());
    end if;
    perform core.audit('garment.create', 'core.garment', v_id::text, jsonb_build_object('name', v_new.name));
    return v_id;
  end if;

  if p_data ? 'closet_id' then
    raise exception 'closet is changed with move_garments';
  end if;
  select * into v_old from core.garment where id = p_id for update;
  if not found then
    raise exception 'garment not found';
  end if;
  v_new := jsonb_populate_record(v_old, p_data);
  update core.garment set
      name = btrim(v_new.name), category = v_new.category, subtype = coalesce(btrim(v_new.subtype), ''),
      colors = coalesce(v_new.colors, '{}'), pattern = v_new.pattern, material = coalesce(btrim(v_new.material), ''),
      fit = v_new.fit, size = coalesce(btrim(v_new.size), ''), quantity = coalesce(v_new.quantity, 1), brand = coalesce(btrim(v_new.brand), ''),
      store = coalesce(btrim(v_new.store), ''), price = v_new.price, currency = coalesce(v_new.currency, 'CHF'),
      purchased_on = v_new.purchased_on, status = coalesce(v_new.status, 'active'), seasons = coalesce(v_new.seasons, '{}'),
      formality = v_new.formality, warmth = v_new.warmth, care_program = v_new.care_program, care_dry = v_new.care_dry,
      care_iron = v_new.care_iron, care_note = coalesce(btrim(v_new.care_note), ''), notes = coalesce(btrim(v_new.notes), ''),
      archived_at = case when coalesce(v_new.status, 'active') = 'archived' then coalesce(archived_at, now()) else null end,
      updated_at = now()
    where id = p_id;
  perform core.audit('garment.update', 'core.garment', p_id::text,
    jsonb_build_object('fields', (select coalesce(array_agg(k), '{}') from jsonb_object_keys(p_data) k)));
  return p_id;
end
$$;

-- Mueve prendas a otro armario (p_to nulo = en tránsito). Idempotente por (request_id, prenda).
create function api.move_garments(p_ids uuid[], p_to uuid, p_request_id uuid, p_note text default '') returns integer
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_n integer := 0;
  g record;
  v_inserted integer;
begin
  perform core.require_owner(true);
  if p_ids is null or cardinality(p_ids) not between 1 and 200 then
    raise exception 'move between 1 and 200 garments at a time';
  end if;
  if p_to is not null and not exists (select 1 from core.closet where id = p_to and status = 'active') then
    raise exception 'closet not found or archived';
  end if;
  for g in select id, closet_id from core.garment where id = any (p_ids) and status <> 'archived' order by id for update loop
    if g.closet_id is not distinct from p_to then
      continue;
    end if;
    insert into core.garment_move (garment_id, from_closet, to_closet, note, request_id, actor)
    values (g.id, g.closet_id, p_to, coalesce(btrim(p_note), ''), p_request_id, core.actor())
    on conflict (request_id, garment_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted > 0 then
      update core.garment set closet_id = p_to, updated_at = now() where id = g.id;
      v_n := v_n + 1;
    end if;
  end loop;
  perform core.audit('garment.move', 'core.garment_move', p_request_id::text,
    jsonb_build_object('to', p_to, 'moved', v_n));
  return v_n;
end
$$;

-- Marca prendas como usadas (p_worn = true) o limpias (false, tras lavarlas).
create function api.mark_worn(p_ids uuid[], p_worn boolean) returns integer
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_n integer;
begin
  perform core.require_owner(true);
  if p_ids is null or cardinality(p_ids) not between 1 and 200 then
    raise exception 'mark between 1 and 200 garments at a time';
  end if;
  update core.garment
     set worn = p_worn, worn_at = case when p_worn then now() else null end, updated_at = now()
   where id = any (p_ids) and status <> 'archived' and worn is distinct from p_worn;
  get diagnostics v_n = row_count;
  perform core.audit('garment.worn', 'core.garment', null, jsonb_build_object('worn', p_worn, 'count', v_n));
  return v_n;
end
$$;

-- Guarda o sustituye la foto de un tipo (main, label, detail). Devuelve las rutas anteriores para borrarlas.
create function api.set_garment_photo(p_garment uuid, p_kind text, p_path text, p_thumb text, p_width integer, p_height integer, p_bytes integer)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_old core.garment_photo;
begin
  perform core.require_owner(false);
  if not exists (select 1 from core.garment where id = p_garment and status <> 'archived') then
    raise exception 'garment not found';
  end if;
  if left(p_path, 37) <> p_garment::text || '/' or left(p_thumb, 37) <> p_garment::text || '/' then
    raise exception 'photo path must live under the garment folder';
  end if;
  select * into v_old from core.garment_photo where garment_id = p_garment and kind = p_kind;
  if found then
    update core.garment_photo
       set path = p_path, thumb_path = p_thumb, width = p_width, height = p_height, bytes = p_bytes, created_at = now()
     where id = v_old.id;
  else
    insert into core.garment_photo (garment_id, kind, path, thumb_path, width, height, bytes)
    values (p_garment, p_kind, p_path, p_thumb, p_width, p_height, p_bytes);
  end if;
  perform core.audit('garment.photo', 'core.garment', p_garment::text, jsonb_build_object('kind', p_kind));
  return jsonb_build_object('old_path', v_old.path, 'old_thumb', v_old.thumb_path);
end
$$;

create function api.remove_garment_photo(p_garment uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, core as
$$
declare
  v_old core.garment_photo;
begin
  perform core.require_owner(false);
  delete from core.garment_photo where garment_id = p_garment and kind = p_kind returning * into v_old;
  if not found then
    raise exception 'photo not found';
  end if;
  perform core.audit('garment.photo_remove', 'core.garment', p_garment::text, jsonb_build_object('kind', p_kind));
  return jsonb_build_object('old_path', v_old.path, 'old_thumb', v_old.thumb_path);
end
$$;

-- Análisis de una prenda (lo escribe Claude desde el conector, o el dueño). Siempre estimado.
create function api.save_garment_analysis(p_id uuid, p_analysis jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  perform core.require_owner(true);
  if p_analysis is null or jsonb_typeof(p_analysis) <> 'object' then
    raise exception 'analysis must be a JSON object';
  end if;
  update core.garment
     set analysis = p_analysis, analysis_at = now(), analysis_by = core.actor(), updated_at = now()
   where id = p_id and status <> 'archived';
  if not found then
    raise exception 'garment not found';
  end if;
  perform core.audit('garment.analysis', 'core.garment', p_id::text, '{}'::jsonb);
end
$$;

---------------------------------------------------------------------------
-- Lectura y permisos
---------------------------------------------------------------------------

alter table core.closet enable row level security;
alter table core.garment enable row level security;
alter table core.garment_photo enable row level security;
alter table core.garment_move enable row level security;

create policy owner_read on core.closet for select to authenticated using (core.is_owner());
create policy owner_read on core.garment for select to authenticated using (core.is_owner());
create policy owner_read on core.garment_photo for select to authenticated using (core.is_owner());
create policy owner_read on core.garment_move for select to authenticated using (core.is_owner());

revoke all on core.closet, core.garment, core.garment_photo, core.garment_move from public;
grant select on core.closet, core.garment, core.garment_photo, core.garment_move to authenticated;

create view api.closets with (security_invoker = true) as
  select id, slug, name, country, note, sort_order, status, created_at, archived_at from core.closet;
create view api.garments with (security_invoker = true) as
  select id, name, category, subtype, colors, pattern, material, fit, size, quantity, brand, store, price, currency, purchased_on,
         status, seasons, formality, warmth, care_program, care_dry, care_iron, care_note, notes, closet_id, worn, worn_at,
         analysis, analysis_at, analysis_by, actor, created_at, updated_at, archived_at
    from core.garment;
create view api.garment_photos with (security_invoker = true) as
  select id, garment_id, kind, path, thumb_path, width, height, bytes, created_at from core.garment_photo;
create view api.garment_moves with (security_invoker = true) as
  select id, garment_id, from_closet, to_closet, note, actor, occurred_at from core.garment_move;
grant select on api.closets, api.garments, api.garment_photos, api.garment_moves to authenticated;

revoke execute on function
  core.is_slug_array(text[], integer),
  api.save_closet(text, text, text, uuid),
  api.set_closet_status(uuid, core.status),
  api.save_garment(jsonb, uuid, uuid),
  api.move_garments(uuid[], uuid, uuid, text),
  api.mark_worn(uuid[], boolean),
  api.set_garment_photo(uuid, text, text, text, integer, integer, integer),
  api.remove_garment_photo(uuid, text),
  api.save_garment_analysis(uuid, jsonb)
from public;

grant execute on function
  api.save_closet(text, text, text, uuid),
  api.set_closet_status(uuid, core.status),
  api.save_garment(jsonb, uuid, uuid),
  api.move_garments(uuid[], uuid, uuid, text),
  api.mark_worn(uuid[], boolean),
  api.set_garment_photo(uuid, text, text, text, integer, integer, integer),
  api.remove_garment_photo(uuid, text),
  api.save_garment_analysis(uuid, jsonb)
to authenticated;

---------------------------------------------------------------------------
-- Fotos: bucket privado y políticas
---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wardrobe', 'wardrobe', false, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png'];

-- Leer: el dueño y Claude (conector). Subir, sustituir y borrar: solo la sesión del dueño en el dashboard.
create policy wardrobe_read on storage.objects for select to authenticated
  using (bucket_id = 'wardrobe' and core.is_owner());
create policy wardrobe_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'wardrobe' and core.is_owner() and core.client_id() is null);
create policy wardrobe_update on storage.objects for update to authenticated
  using (bucket_id = 'wardrobe' and core.is_owner() and core.client_id() is null)
  with check (bucket_id = 'wardrobe' and core.is_owner() and core.client_id() is null);
create policy wardrobe_delete on storage.objects for delete to authenticated
  using (bucket_id = 'wardrobe' and core.is_owner() and core.client_id() is null);
