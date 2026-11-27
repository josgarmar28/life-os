-- Armario: armarios, prendas, fotos, traslados, marcas de uso, análisis y políticas del almacenamiento privado.
\set ON_ERROR_STOP on
\ir _helpers.sql

create function pg_temp.as_owner() returns void language sql as
$$ select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) $$;
create function pg_temp.as_agent() returns void language sql as
$$ select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","client_id":"claude-test"}', false) $$;
create function pg_temp.as_stranger() returns void language sql as
$$ select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false) $$;

delete from core.app_owner;
insert into core.app_owner (user_id) values ('11111111-1111-1111-1111-111111111111');

-- Los dos armarios de partida existen y el cubo es privado.
select pg_temp.as_owner();
select pg_temp.assert_eq('two closets', pg_temp.run_as('authenticated', $$(select string_agg(slug, ',' order by sort_order) from api.closets)$$), 'suiza,espana');
select pg_temp.assert_eq('bucket private', (select public from storage.buckets where id = 'wardrobe'), false);

-- Alta con armario: queda el traslado de alta; repetir la misma petición no duplica.
select pg_temp.run_as('authenticated', $$api.save_garment(
  jsonb_build_object('name', 'Camisa Oxford azul', 'category', 'camisa', 'colors', jsonb_build_array('azul'), 'price', 79.9,
    'store', 'Zara', 'seasons', jsonb_build_array('primavera', 'otono'), 'formality', 3, 'care_program', 'lavadora_40',
    'closet_id', (select id from api.closets where slug = 'suiza')),
  null, '99999999-0000-0000-0000-000000000001')$$);
select set_config('t.g1', (select id::text from core.garment where name = 'Camisa Oxford azul'), false);
select pg_temp.assert_eq('one garment', (select count(*) from core.garment), 1::bigint);
select pg_temp.assert_eq('alta move', (select count(*) from core.garment_move where note = 'alta'), 1::bigint);
select pg_temp.assert_eq('idempotent create', pg_temp.run_as('authenticated', $$api.save_garment('{"name":"x","category":"camisa"}'::jsonb, null, '99999999-0000-0000-0000-000000000001')$$), current_setting('t.g1'));
select pg_temp.assert_eq('still one', (select count(*) from core.garment), 1::bigint);
select pg_temp.assert_eq('defaults', (select currency || ':' || worn::text || ':' || (analysis is null)::text from core.garment), 'CHF:false:true');

-- Validación determinista.
select pg_temp.assert_fails('authenticated', $$select api.save_garment('{"name":"x","category":"camisa","oops":1}'::jsonb)$$, '%unknown garment fields: oops%');
select pg_temp.assert_fails('authenticated', $$select api.save_garment('{"name":"x"}'::jsonb)$$, '%name and category are required%');
select pg_temp.assert_fails('authenticated', $$select api.save_garment('{"name":"x","category":"camisa","care_program":"fuego"}'::jsonb)$$, '%garment_care_program_check%');
select pg_temp.assert_fails('authenticated', $$select api.save_garment('{"name":"x","category":"camisa","colors":["a","b","c","d"]}'::jsonb)$$, '%garment_colors_check%');
select pg_temp.assert_fails('authenticated', $$select api.save_garment('{"name":"x","category":"camisa","formality":7}'::jsonb)$$, '%garment_formality_check%');
select pg_temp.assert_fails('authenticated', $$select api.save_garment('{"name":"x","category":"camisa","price":-1}'::jsonb)$$, '%garment_price_check%');
select pg_temp.assert_fails('authenticated', $$select api.save_garment('{"name":"x","category":"camisa","seasons":["lluvia"]}'::jsonb)$$, '%garment_seasons_check%');
select pg_temp.assert_fails('authenticated', $$select api.save_garment('{"name":"x","category":"camisa","closet_id":"00000000-0000-0000-0000-000000000000"}'::jsonb)$$, '%closet not found%');
select pg_temp.assert_eq('nothing created by failures', (select count(*) from core.garment), 1::bigint);

-- Editar cambia solo lo enviado; el armario no se cambia por aquí.
select pg_temp.run_as('authenticated', $$api.save_garment('{"price":69.9,"notes":"rebajada","pattern":null}'::jsonb, current_setting('t.g1')::uuid)$$);
select pg_temp.assert_eq('edited', (select name || ':' || price::text || ':' || notes from core.garment), 'Camisa Oxford azul:69.90:rebajada');
select pg_temp.assert_fails('authenticated', $$select api.save_garment(jsonb_build_object('closet_id', (select id from api.closets where slug = 'espana')), current_setting('t.g1')::uuid)$$, '%move_garments%');
select pg_temp.assert_fails('authenticated', $$select api.save_garment('{"name":"y"}'::jsonb, gen_random_uuid())$$, '%garment not found%');

-- Claude no crea ni edita la ficha, pero sí mueve, marca el uso y guarda el análisis.
select pg_temp.as_agent();
select pg_temp.assert_fails('authenticated', $$select api.save_garment('{"name":"z","category":"camisa"}'::jsonb)$$, '%agents cannot do this%');
select pg_temp.assert_fails('authenticated', $$select api.set_garment_photo(current_setting('t.g1')::uuid, 'main', current_setting('t.g1') || '/a.png', current_setting('t.g1') || '/a-t.png', 10, 10, 100)$$, '%agents cannot do this%');
select pg_temp.assert_fails('authenticated', $$select api.save_closet('Maleta')$$, '%agents cannot do this%');

select pg_temp.assert_eq('agent moves', pg_temp.run_as('authenticated', $$api.move_garments(array[current_setting('t.g1')::uuid], (select id from api.closets where slug = 'espana'), '99999999-0000-0000-0000-000000000002', 'viaje')$$), '1');
select pg_temp.assert_eq('now in espana', (select c.slug from core.garment g join core.closet c on c.id = g.closet_id), 'espana');
select pg_temp.assert_eq('move logged', (select count(*) from core.garment_move where actor = 'agent:claude-test' and from_closet is not null), 1::bigint);
select pg_temp.assert_eq('replayed move does nothing', pg_temp.run_as('authenticated', $$api.move_garments(array[current_setting('t.g1')::uuid], (select id from api.closets where slug = 'espana'), '99999999-0000-0000-0000-000000000002')$$), '0');
select pg_temp.assert_eq('same closet does nothing', pg_temp.run_as('authenticated', $$api.move_garments(array[current_setting('t.g1')::uuid], (select id from api.closets where slug = 'espana'), '99999999-0000-0000-0000-000000000003')$$), '0');
select pg_temp.assert_fails('authenticated', $$select api.move_garments(array[]::uuid[], null, gen_random_uuid())$$, '%between 1 and 200%');
select pg_temp.assert_fails('authenticated', $$select api.move_garments(array[current_setting('t.g1')::uuid], gen_random_uuid(), gen_random_uuid())$$, '%closet not found%');

-- En tránsito (sin armario) y de vuelta.
select pg_temp.assert_eq('in transit', pg_temp.run_as('authenticated', $$api.move_garments(array[current_setting('t.g1')::uuid], null, gen_random_uuid(), 'maleta')$$), '1');
select pg_temp.assert_eq('no closet', (select closet_id is null from core.garment), true);
select pg_temp.assert_eq('back', pg_temp.run_as('authenticated', $$api.move_garments(array[current_setting('t.g1')::uuid], (select id from api.closets where slug = 'suiza'), gen_random_uuid())$$), '1');
select pg_temp.assert_eq('history', (select count(*) from core.garment_move), 4::bigint);

-- Usada / limpia.
select pg_temp.assert_eq('mark worn', pg_temp.run_as('authenticated', $$api.mark_worn(array[current_setting('t.g1')::uuid], true)$$), '1');
select pg_temp.assert_eq('worn', (select worn and worn_at is not null from core.garment), true);
select pg_temp.assert_eq('already worn', pg_temp.run_as('authenticated', $$api.mark_worn(array[current_setting('t.g1')::uuid], true)$$), '0');
select pg_temp.run_as('authenticated', $$api.mark_worn(array[current_setting('t.g1')::uuid], false)$$);
select pg_temp.assert_eq('clean', (select not worn and worn_at is null from core.garment), true);

-- Análisis: siempre un objeto, con autor y fecha.
select pg_temp.run_as('authenticated', $$api.save_garment_analysis(current_setting('t.g1')::uuid, '{"style":"smart casual","pairs_with":["chinos"],"confidence":"media"}'::jsonb)$$);
select pg_temp.assert_eq('analysis saved', (select analysis ->> 'style' || ':' || analysis_by from core.garment), 'smart casual:agent:claude-test');
select pg_temp.assert_fails('authenticated', $$select api.save_garment_analysis(current_setting('t.g1')::uuid, '[1]'::jsonb)$$, '%analysis must be a JSON object%');
select pg_temp.assert_fails('authenticated', $$select api.save_garment_analysis(gen_random_uuid(), '{}'::jsonb)$$, '%garment not found%');

-- El historial de traslados no se edita ni se borra.
select pg_temp.assert_fails('authenticated', $$delete from core.garment_move$$, '%permission denied%');
select pg_temp.assert_eq('agent reads garments', pg_temp.run_as('authenticated', 'select count(*) from api.garments'), '1');

-- Fotos (el dueño): sustituir devuelve las rutas anteriores para borrarlas; no se sale de la carpeta de la prenda.
select pg_temp.as_owner();
select pg_temp.assert_eq('first photo', pg_temp.run_as('authenticated', $$api.set_garment_photo(current_setting('t.g1')::uuid, 'main', current_setting('t.g1') || '/p1.png', current_setting('t.g1') || '/p1-t.png', 800, 1000, 300000)$$), '{"old_path": null, "old_thumb": null}');
select pg_temp.assert_eq('replace photo', pg_temp.run_as('authenticated', $$api.set_garment_photo(current_setting('t.g1')::uuid, 'main', current_setting('t.g1') || '/p2.png', current_setting('t.g1') || '/p2-t.png', 800, 1000, 310000) ->> 'old_path'$$), current_setting('t.g1') || '/p1.png');
select pg_temp.run_as('authenticated', $$api.set_garment_photo(current_setting('t.g1')::uuid, 'label', current_setting('t.g1') || '/l1.jpg', current_setting('t.g1') || '/l1-t.jpg', 800, 600, 90000)$$);
select pg_temp.assert_eq('two photos', pg_temp.run_as('authenticated', $$(select count(*) from api.garment_photos)$$), '2');
select pg_temp.assert_fails('authenticated', $$select api.set_garment_photo(current_setting('t.g1')::uuid, 'back', current_setting('t.g1') || '/b.png', current_setting('t.g1') || '/b-t.png', 10, 10, 100)$$, '%garment_photo_kind_check%');
select pg_temp.assert_fails('authenticated', $$select api.set_garment_photo(current_setting('t.g1')::uuid, 'detail', gen_random_uuid() || '/b.png', current_setting('t.g1') || '/b-t.png', 10, 10, 100)$$, '%under the garment folder%');
select pg_temp.assert_fails('authenticated', $$select api.set_garment_photo(current_setting('t.g1')::uuid, 'detail', current_setting('t.g1') || '/../b.png', current_setting('t.g1') || '/b-t.png', 10, 10, 100)$$, '%garment_photo_path_check%');
select pg_temp.assert_eq('remove photo', pg_temp.run_as('authenticated', $$api.remove_garment_photo(current_setting('t.g1')::uuid, 'label') ->> 'old_thumb'$$), current_setting('t.g1') || '/l1-t.jpg');
select pg_temp.assert_fails('authenticated', $$select api.remove_garment_photo(current_setting('t.g1')::uuid, 'label')$$, '%photo not found%');

-- Armarios: crear, no archivar con prendas, archivar vacío.
select pg_temp.run_as('authenticated', $$api.save_closet('Maleta de viaje', null, 'Para los fines de semana')$$);
select pg_temp.assert_eq('slug from name', (select slug from core.closet where name = 'Maleta de viaje'), 'maleta-de-viaje');
select pg_temp.assert_fails('authenticated', $$select api.set_closet_status((select id from core.closet where slug = 'suiza'), 'archived')$$, '%still has garments%');
select pg_temp.run_as('authenticated', $$api.set_closet_status((select id from core.closet where slug = 'maleta-de-viaje'), 'archived')$$);
select pg_temp.assert_eq('archived closet', (select status::text from core.closet where slug = 'maleta-de-viaje'), 'archived');
select pg_temp.assert_fails('authenticated', $$select api.move_garments(array[current_setting('t.g1')::uuid], (select id from core.closet where slug = 'maleta-de-viaje'), gen_random_uuid())$$, '%closet not found or archived%');

-- Archivar una prenda no la borra y la saca de los movimientos.
select pg_temp.run_as('authenticated', $$api.save_garment('{"status":"archived"}'::jsonb, current_setting('t.g1')::uuid)$$);
select pg_temp.assert_eq('archived', (select status || ':' || (archived_at is not null)::text from core.garment), 'archived:true');
select pg_temp.assert_eq('archived is not moved', pg_temp.run_as('authenticated', $$api.move_garments(array[current_setting('t.g1')::uuid], (select id from api.closets where slug = 'espana'), gen_random_uuid())$$), '0');
select pg_temp.run_as('authenticated', $$api.save_garment('{"status":"active"}'::jsonb, current_setting('t.g1')::uuid)$$);
select pg_temp.assert_eq('restored', (select status || ':' || (archived_at is null)::text from core.garment), 'active:true');

-- Almacenamiento: el dueño sube; Claude solo lee; un desconocido nada.
set role authenticated;
insert into storage.objects (bucket_id, name) values ('wardrobe', current_setting('t.g1') || '/p2.png');
reset role;
select pg_temp.as_agent();
select pg_temp.assert_eq('agent reads photo', pg_temp.run_as('authenticated', 'select count(*) from storage.objects'), '1');
select pg_temp.assert_fails('authenticated', $$insert into storage.objects (bucket_id, name) values ('wardrobe', 'x/y.png')$$, '%row-level security%');
select pg_temp.as_stranger();
select pg_temp.assert_eq('stranger reads no photos', pg_temp.run_as('authenticated', 'select count(*) from storage.objects'), '0');
select pg_temp.assert_eq('stranger reads no garments', pg_temp.run_as('authenticated', 'select count(*) from api.garments'), '0');
select pg_temp.assert_fails('authenticated', $$insert into storage.objects (bucket_id, name) values ('wardrobe', 'x/y.png')$$, '%row-level security%');
select pg_temp.assert_fails('authenticated', $$select api.save_garment('{"name":"z","category":"camisa"}'::jsonb)$$, '%not authorized%');
select pg_temp.assert_fails('authenticated', $$select api.move_garments(array[gen_random_uuid()], null, gen_random_uuid())$$, '%not authorized%');
select pg_temp.assert_fails('anon', 'select count(*) from api.garments', '%permission denied%');
