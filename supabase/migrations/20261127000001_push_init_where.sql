-- Arreglo: en Supabase, las llamadas por la API llevan pg_safeupdate, que rechaza cualquier UPDATE
-- sin WHERE ("UPDATE requires a WHERE clause"). push_init actualizaba la fila única sin WHERE, así
-- que la función de avisos nunca llegaba a guardar sus claves. Misma lógica, con WHERE.
create or replace function api.push_init(p_public_key text, p_private_jwk jsonb, p_function_url text, p_site_url text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, core as
$$
begin
  update core.push_config
     set public_key = coalesce(public_key, p_public_key),
         private_jwk = coalesce(private_jwk, p_private_jwk),
         function_url = coalesce(p_function_url, function_url),
         site_url = coalesce(p_site_url, site_url)
   where singleton;
  return (select jsonb_build_object('public_key', public_key, 'private_jwk', private_jwk, 'cron_secret', cron_secret,
      'site_url', site_url) from core.push_config);
end
$$;
