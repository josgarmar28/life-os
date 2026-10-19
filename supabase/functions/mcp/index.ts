// Edge Function "mcp": conector remoto de LIFE OS para Claude (claude.ai, app de iPhone, Claude Code).
//
// Autenticación: OAuth 2.1 del propio Supabase Auth (servidor OAuth, en beta). Claude se registra
// solo (registro dinámico de clientes), el dueño inicia sesión y da su consentimiento en el dashboard
// (/oauth/consent), y Claude llama aquí con un token de acceso del dueño que incluye `client_id`.
// Cada consulta corre COMO EL DUEÑO con RLS; la BD limita lo que puede hacer un agente.
//
// Se despliega con --no-verify-jwt: la verificación la hace esta función, para poder devolver el
// 401 con `WWW-Authenticate` que Claude necesita para descubrir el servidor de autorización.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import type { Api } from './handler.ts';
import { handleBody } from './handler.ts';
import type { Area, Entry, Field, Form, Proposal } from '../_shared/model.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// Clave pública: los proyectos nuevos solo tienen claves "publishable" (SUPABASE_PUBLISHABLE_KEYS,
// un JSON con la clave en "default"); los antiguos, la "anon" heredada.
function publicKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<string, string>;
    if (keys.default) return keys.default;
  } catch { /* formato inesperado: probamos la heredada */ }
  const legacy = Deno.env.get('SUPABASE_ANON_KEY');
  if (!legacy) throw new Error('Sin clave pública en el entorno de la función');
  return legacy;
}
const ANON_KEY = publicKey();
// URL exacta que se pega en Claude al añadir el conector.
const RESOURCE = Deno.env.get('MCP_PUBLIC_URL') ?? `${SUPABASE_URL}/functions/v1/mcp`;
const METADATA_URL = `${RESOURCE}/.well-known/oauth-protected-resource`;

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function unauthorized(error?: string) {
  const parts = [`Bearer resource_metadata="${METADATA_URL}"`];
  if (error) parts.push(`error="${error}"`);
  return json(401, { error: error ?? 'unauthorized' }, { 'www-authenticate': parts.join(', ') });
}

function decodeClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')));
  } catch {
    return {};
  }
}

function makeApi(db: SupabaseClient): Api {
  const api = db.schema('api');
  const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data as T;
  };
  let tz: string | undefined;
  return {
    areas: async () => must<Area[]>(await api.from('areas').select('*')),
    forms: async () => must<Form[]>(await api.from('forms').select('*')),
    fields: async () => must<Field[]>(await api.from('fields').select('*')),
    async entries(q) {
      let query = api.from('entries').select('*').order('local_date', { ascending: false }).order('occurred_at', { ascending: false }).limit(q.limit);
      if (q.ids) query = query.in('id', q.ids);
      if (q.formIds) query = query.in('form_id', q.formIds.length ? q.formIds : ['00000000-0000-0000-0000-000000000000']);
      if (q.from) query = query.gte('local_date', q.from);
      if (q.to) query = query.lte('local_date', q.to);
      return must<Entry[]>(await query);
    },
    async proposals(q) {
      let query = api.from('proposals').select('*').order('created_at', { ascending: false }).limit(q.limit);
      if (q.status) query = query.eq('status', q.status);
      return must<Proposal[]>(await query);
    },
    rpc: async <T>(fn: string, args: Record<string, unknown>) => must<T>(await api.rpc(fn, args)),
    async timezone() {
      if (!tz) tz = (must<{ timezone: string }>(await api.rpc('whoami', {}))).timezone;
      return tz;
    },
  };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return json(200, {
      resource: RESOURCE,
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ['header'],
      resource_name: 'LIFE OS',
    }, { 'cache-control': 'public, max-age=3600' });
  }

  if (req.method !== 'POST') {
    // Sin SSE: este servidor responde siempre JSON a POST.
    return json(405, { error: 'method not allowed' }, { allow: 'POST' });
  }

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return unauthorized();

  // Solo tokens emitidos por el servidor OAuth (llevan client_id). Una sesión del dashboard no sirve aquí,
  // así que las restricciones de agente de la BD se aplican siempre a este conector.
  if (!decodeClaims(token).client_id) return unauthorized('invalid_token');

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) return unauthorized('invalid_token');

  const api = makeApi(db);
  const who = await api.rpc<{ is_owner: boolean }>('whoami', {}).catch(() => ({ is_owner: false }));
  if (!who.is_owner) return json(403, { error: 'forbidden: not the LIFE OS owner' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }

  const result = await handleBody(body, { api, now: new Date(), newId: () => crypto.randomUUID() });
  if (result === null) return new Response(null, { status: 202 });
  return json(200, result);
});
