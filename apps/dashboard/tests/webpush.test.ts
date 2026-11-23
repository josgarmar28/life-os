// Avisos: el cifrado lo descifra un receptor que sigue el RFC 8291 y la firma VAPID es válida.
// (Además se comprobó una vez contra las librerías de referencia http_ece y web-push.)
import { describe, expect, it } from 'vitest';
import { b64url, encryptPayload, fromB64url, generateVapidKeys, vapidAuthorization } from '@shared/webpush.ts';

const enc = new TextEncoder();
const bs = (u: Uint8Array): BufferSource => new Uint8Array(u);
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', bs(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, bs(data)));
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: string | Uint8Array, len: number) {
  const i = typeof info === 'string' ? enc.encode(info) : info;
  const out = await hmac(await hmac(salt, ikm), new Uint8Array([...i, 1]));
  return out.slice(0, len);
}

/** Lo que hace el navegador al recibir el aviso. */
async function decrypt(body: Uint8Array, receiver: CryptoKeyPair, uaPublic: Uint8Array, auth: Uint8Array) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', bs(asPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, receiver.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]), 32);
  const cek = await hkdf(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = await hkdf(salt, ikm, 'Content-Encoding: nonce\0', 12);
  const key = await crypto.subtle.importKey('raw', bs(cek), 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bs(nonce) }, key, bs(cipher)));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe('web push', () => {
  it('cifra un aviso que el navegador puede descifrar', async () => {
    const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const msg = JSON.stringify({ title: 'Empezar el día', body: 'Falta: Peso.', url: '/' });
    const body = await encryptPayload({ p256dh: b64url(uaPublic), auth: b64url(auth) }, enc.encode(msg));
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(await decrypt(body, receiver, uaPublic, auth)).toBe(msg);
  });

  it('firma la cabecera VAPID para el origen del servicio de avisos', async () => {
    const keys = await generateVapidKeys();
    expect(fromB64url(keys.publicKey)).toHaveLength(65);
    const h = await vapidAuthorization('https://web.push.apple.com/QGFiYw', keys, 'https://life-os.example', Date.UTC(2027, 0, 11));
    const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [head, claims, sig] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(fromB64url(claims)))).toEqual({ aud: 'https://web.push.apple.com', exp: Date.UTC(2027, 0, 11) / 1000 + 43200, sub: 'https://life-os.example' });
    const pub = await crypto.subtle.importKey('raw', bs(fromB64url(keys.publicKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, bs(fromB64url(sig)), bs(enc.encode(`${head}.${claims}`)))).toBe(true);
  });
});
