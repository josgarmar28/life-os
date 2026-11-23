// Edge Function "push": avisos en el iPhone (web push) sin servicios de pago.
//
// - pg_cron la llama cada 5 minutos con la cabecera x-cron-secret: pide a la base de datos qué avisos
//   tocan (api.push_claim) y los envía a cada navegador suscrito.
// - El dashboard la llama con la sesión del dueño: {"action":"key"} devuelve la clave pública VAPID
//   (y la crea la primera vez); {"action":"test"} envía un aviso de prueba.
//
// Se despliega con --no-verify-jwt porque pg_cron no tiene sesión: la función comprueba ella misma
// el secreto de pg_cron o que la sesión sea del dueño (no de Claude).
import { generateVapidKeys, sendPush, type PushMessage, type Subscription, type VapidKeys } from '../_shared/webpush.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/push`;

// Claves: los proyectos nuevos tienen claves "publishable"/"secret" (JSON con "default"); los antiguos, anon/service_role.
function envKey(json: string, legacy: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(json) ?? '{}') as Record<string, string>;
    if (keys.default) return keys.default;
  } catch { /* formato inesperado: probamos la heredada */ }
  const k = Deno.env.get(legacy);
  if (!k) throw new Error(`Falta ${legacy} en el entorno de la función`);
  return k;
}
const PUBLIC_KEY = envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const SERVICE_KEY = envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
}

/** Llama a una función de la base de datos (esquema api) con la clave dada o con un token de usuario. */
async function rpc<T>(fn: string, args: Record<string, unknown>, token?: string): Promise<T> {
  const key = token ? PUBLIC_KEY : SERVICE_KEY;
  const bearer = token ?? (SERVICE_KEY.startsWith('eyJ') ? SERVICE_KEY : undefined);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      'content-type': 'application/json',
      'content-profile': 'api',
      'accept-profile': 'api',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

interface Config {
  public_key: string | null;
  private_jwk: JsonWebKey | null;
  cron_secret: string;
  site_url: string | null;
  subscriptions?: Subscription[];
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const subject = (c: Config) => c.site_url ?? 'mailto:avisos@lifeos.invalid';
const keysOf = (c: Config): VapidKeys => ({ publicKey: c.public_key!, privateJwk: c.private_jwk! });

async function deliver(c: Config, messages: PushMessage[]) {
  const results = [];
  for (const msg of messages) {
    for (const sub of c.subscriptions ?? []) {
      const r = await sendPush(sub, msg, keysOf(c), subject(c));
      await rpc('push_report', { p_endpoint: r.endpoint, p_status: r.status, p_gone: r.gone });
      results.push({ tag: msg.tag, status: r.status });
    }
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  try {
    // 1) pg_cron
    const cron = req.headers.get('x-cron-secret');
    if (cron) {
      const c = await rpc<Config>('push_config', {});
      if (!sameSecret(cron, c.cron_secret)) return json(401, { error: 'unauthorized' });
      if (!c.public_key || !c.private_jwk || !c.subscriptions?.length) return json(200, { sent: [] });
      const messages = await rpc<PushMessage[]>('push_claim', {});
      return json(200, { sent: await deliver(c, messages) });
    }

    // 2) El dashboard, con la sesión del dueño.
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return json(401, { error: 'unauthorized' });
    const who = await rpc<{ is_owner: boolean; actor: string }>('whoami', {}, token).catch(() => null);
    if (!who?.is_owner || who.actor !== 'owner') return json(403, { error: 'forbidden' });

    const { action } = await req.json().catch(() => ({})) as { action?: string };
    const origin = req.headers.get('origin');
    const site = origin && /^https:\/\//.test(origin) ? origin : null;
    if (action === 'key') {
      let c = await rpc<Config>('push_config', {});
      const fresh = c.public_key ? null : await generateVapidKeys();
      c = await rpc<Config>('push_init', {
        p_public_key: fresh?.publicKey ?? null,
        p_private_jwk: fresh?.privateJwk ?? null,
        p_function_url: FUNCTION_URL,
        p_site_url: site,
      });
      return json(200, { public_key: c.public_key });
    }
    if (action === 'test') {
      const c = await rpc<Config>('push_config', {});
      if (!c.public_key || !c.private_jwk) return json(409, { error: 'sin claves: activa los avisos primero' });
      const sent = await deliver(c, [{ title: 'LIFE OS', body: 'Avisos activados ✓', url: '/ajustes', tag: 'prueba' }]);
      return json(200, { sent });
    }
    return json(400, { error: 'acción desconocida' });
  } catch (e) {
    console.error(e);
    return json(500, { error: 'error interno' });
  }
});
