-- LIFE OS · Propuestas más fáciles de redactar para Claude.
--
-- Antes, una propuesta tenía que llevar los uuid internos (area_id, form_id) y un cuestionario nuevo
-- con campos necesitaba varias propuestas encadenadas. Ahora:
--   · area.save / form.save / field.save / *.archive aceptan identificadores legibles
--     (area, form, key) además de los uuid; si ya existe, la propuesta lo modifica.
--   · form.save admite "fields": [...] y crea o modifica el cuestionario y sus campos de una vez
--     (todo o nada: si un campo falla, no se aplica nada).
-- El dueño sigue viendo en Propuestas exactamente el contenido que aprueba (hash).

create function core.proposal_area_id(x jsonb) returns uuid
language plpgsql stable as
$$
declare
  v uuid := (x ->> 'area_id')::uuid;
begin
  if v is null and x ? 'area' then
    select id into v from core.area where slug = x ->> 'area';
    if v is null then raise exception 'area "%" not found', x ->> 'area'; end if;
  end if;
  if v is null then raise exception 'payload needs "area" (slug) or "area_id"'; end if;
  return v;
end
$$;

create function core.proposal_form_id(x jsonb) returns uuid
language plpgsql stable as
$$
declare
  v uuid := (x ->> 'form_id')::uuid;
begin
  if v is null and x ? 'form' then
    select f.id into v from core.form f where f.area_id = core.proposal_area_id(x) and f.slug = x ->> 'form';
    if v is null then raise exception 'form "%/%" not found', x ->> 'area', x ->> 'form'; end if;
  end if;
  if v is null then raise exception 'payload needs "area" + "form" (slugs) or "form_id"'; end if;
  return v;
end
$$;

create function core.proposal_save_field(p_form_id uuid, x jsonb, p_default_sort integer) returns uuid
language plpgsql as
$$
declare
  v_id uuid := coalesce((x ->> 'id')::uuid, (select id from core.field where form_id = p_form_id and key = x ->> 'key'));
begin
  return api.save_field(v_id, p_form_id, x ->> 'key', x ->> 'label',
                        (x ->> 'type')::core.field_type, coalesce(x ->> 'help', ''), coalesce(x ->> 'unit', ''),
                        (x ->> 'min')::numeric, (x ->> 'max')::numeric, (x ->> 'step')::numeric,
                        coalesce(x -> 'options', '[]'), coalesce(x -> 'columns', '[]'),
                        coalesce((x ->> 'required')::boolean, false), coalesce((x ->> 'on_overview')::boolean, false),
                        coalesce((x ->> 'sort_order')::integer, p_default_sort));
end
$$;

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
    when 'note' then
      return jsonb_build_object('acknowledged', true);
  end case;
  return jsonb_build_object('id', v_id);
end
$$;

revoke all on function core.proposal_area_id(jsonb), core.proposal_form_id(jsonb), core.proposal_save_field(uuid, jsonb, integer) from public;
