-- LIFE OS · P0 · Esquemas y roles de aplicación
-- Solo hacia delante: las correcciones se hacen con migraciones nuevas.
--
-- Los roles son NOLOGIN: representan permisos, no identidades. Las identidades
-- de ejecución (p. ej. la Edge Function de ingesta) se asociarán a un rol en una
-- migración posterior, cuando exista el componente que las use.

create schema if not exists raw;
create schema if not exists core;
create schema if not exists health;
create schema if not exists training;
create schema if not exists nutrition;
create schema if not exists body;
create schema if not exists knowledge;
create schema if not exists ops;

do $$
declare
  r text;
begin
  foreach r in array array['app_reader', 'ingest_writer', 'agent_writer', 'executor', 'approver']
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end
$$;

-- Los agentes pueden leer lo mismo que app_reader (herramientas de consulta),
-- pero no heredan permisos de escritura de ningún otro rol.
grant app_reader to agent_writer;

-- Nada es accesible por defecto.
revoke all on schema raw, core, health, training, nutrition, body, knowledge, ops from public;

grant usage on schema raw to ingest_writer;
grant usage on schema health to app_reader, ingest_writer, agent_writer;
grant usage on schema ops to app_reader, ingest_writer, agent_writer, executor, approver;

comment on schema raw is 'Datos originales inmutables tal como llegan de cada fuente.';
comment on schema core is 'Objetivos, KPIs, decisiones y notas (tablas en fases posteriores).';
comment on schema health is 'Observaciones de salud normalizadas con calidad y trazabilidad.';
comment on schema training is 'Entrenamiento y equipamiento (tablas en fase P3).';
comment on schema nutrition is 'Nutrición (tablas en fase P4).';
comment on schema body is 'Medidas corporales y estimaciones de composición (tablas en fase P1+).';
comment on schema knowledge is 'Registro de evidencia científica verificable (tablas en fase P3).';
comment on schema ops is 'Ejecuciones, propuestas, aprobaciones, auditoría y errores.';
