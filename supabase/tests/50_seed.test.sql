-- La semilla de áreas es válida contra el esquema e idempotente, y respeta los cambios del dueño.
\set ON_ERROR_STOP on
\ir _helpers.sql

\ir ../seed/areas-iniciales.sql
select pg_temp.assert_eq('areas', (select count(*) from core.area), 8::bigint);

update core.field set label = 'Mi etiqueta' where key = 'calidad';
\ir ../seed/areas-iniciales.sql
select pg_temp.assert_eq('areas after rerun', (select count(*) from core.area), 8::bigint);
select pg_temp.assert_eq('fields stable', (select count(*) from core.field), (select count(distinct (form_id, key)) from core.field));
select pg_temp.assert_eq('owner change kept', (select label from core.field where key = 'calidad'), 'Mi etiqueta');
select pg_temp.assert_eq('every form has a field',
  (select count(*) from core.form f where not exists (select 1 from core.field x where x.form_id = f.id)), 0::bigint);
