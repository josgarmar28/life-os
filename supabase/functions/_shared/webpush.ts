// Avisos web push sin dependencias: firma VAPID (RFC 8292) y cifrado aes128gcm (RFC 8188 y 8291)
// con WebCrypto, que tienen tanto Deno (la función de Supabase) como Node (las pruebas).

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** Copia con un ArrayBuffer propio: lo que pide WebCrypto en los tipos de TypeScript recientes. */
const bs = (u: Uint8Array): BufferSource => new Uint8Array(u);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', bs(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, bs(data)));
}

/** HKDF de un solo bloque (todas las longitudes que usa web push caben en 32 bytes). */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, len);
}

export interface VapidKeys {
  /** Clave pública sin comprimir (65 bytes) en base64url: la que usa el navegador al suscribirse. */
  publicKey: string;
  /** Clave privada en JWK (se guarda en la base de datos, solo legible por la función). */
  privateJwk: JsonWebKey;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: b64url(raw), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
}

/** Cabecera Authorization VAPID para un servicio de avisos (Apple, Google, Mozilla). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto devuelve la firma ya en formato r||s (64 bytes), el que pide JWT.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bs(enc.encode(`${header}.${claims}`))));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

export interface Subscription {
  endpoint: string;
  /** Clave pública del navegador (base64url). */
  p256dh: string;
  /** Secreto de autenticación del navegador (base64url). */
  auth: string;
}

/** Cifra el mensaje para un navegador (RFC 8291, un único registro aes128gcm). */
export async function encryptPayload(sub: Pick<Subscription, 'p256dh' | 'auth'>, plaintext: Uint8Array, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<Uint8Array> {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', bs(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', bs(cek), 'AES-GCM', false, ['encrypt']);
  // Último (y único) registro: el mensaje seguido del delimitador 0x02.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bs(nonce) }, key, bs(concat(plaintext, new Uint8Array([2])))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export interface PushMessage {
  title: string;
  body: string;
  /** Pantalla que abre el aviso ("/", "/semana"). */
  url: string;
  /** Avisos con la misma etiqueta se sustituyen en lugar de acumularse. */
  tag?: string;
}

export interface PushResult {
  endpoint: string;
  status: number;
  /** El navegador dio de baja la suscripción: hay que borrarla. */
  gone: boolean;
}

/** Envía un aviso a un navegador. Nunca lanza: devuelve el estado para decidir qué hacer. */
export async function sendPush(sub: Subscription, msg: PushMessage, keys: VapidKeys, subject: string, ttl = 6 * 3600): Promise<PushResult> {
  try {
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(msg)));
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuthorization(sub.endpoint, keys, subject),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(ttl),
        urgency: 'normal',
        ...(msg.tag ? { topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
      },
      body: bs(body),
    });
    await res.body?.cancel();
    return { endpoint: sub.endpoint, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { endpoint: sub.endpoint, status: 0, gone: false };
  }
}
