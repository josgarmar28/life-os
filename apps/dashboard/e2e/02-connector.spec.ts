import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { card, ensureOwner, env, setOwnerPassword, sql } from './helpers';

// Recorre lo que hace Claude al añadir el conector: descubrimiento (RFC 9728 / 8414), registro
// dinámico, autorización con PKCE y consentimiento en el dashboard, token y llamadas MCP.
const MCP = () => `${env.url}/functions/v1/mcp`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

async function mcp(token: string, method: string, params: unknown = {}, id = 1) {
  const r = await fetch(MCP(), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return { status: r.status, body: r.status === 200 ? await r.json() : await r.text() };
}
const tool = async (token: string, name: string, args: Record<string, unknown> = {}) => {
  const r = await mcp(token, 'tools/call', { name, arguments: args });
  expect(r.status).toBe(200);
  return r.body.result as { isError: boolean; content: { text: string }[] };
};

test('conector de Claude: OAuth con consentimiento, lectura, registro y propuesta aprobada', async ({ page }) => {
  await ensureOwner();
  await setOwnerPassword();

  // 1. Sin token: 401 con la pista de metadatos.
  const r401 = await fetch(MCP(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(r401.status).toBe(401);
  const metaUrl = r401.headers.get('www-authenticate')!.match(/resource_metadata="([^"]+)"/)![1];
  const meta = await (await fetch(metaUrl)).json();
  expect(meta.resource).toBe(MCP());
  const issuer = meta.authorization_servers[0];
  expect(issuer).toBe(`${env.url}/auth/v1`);

  // 2. Metadatos del servidor de autorización (inserción de ruta de RFC 8414) y registro dinámico.
  const as = await (await fetch(`${env.url}/.well-known/oauth-authorization-server/auth/v1`)).json();
  expect(as.issuer).toBe(issuer);
  expect(as.code_challenge_methods_supported).toContain('S256');
  const abs = (u: string) => (u.startsWith('http') ? u : `${issuer}${u}`);
  const reg = await (await fetch(abs(as.registration_endpoint), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  })).json();
  expect(reg.client_id).toBeTruthy();

  // 3. Autorización: Supabase manda al dashboard (/oauth/consent); entro y apruebo.
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorize = new URL(abs(as.authorization_endpoint));
  Object.entries({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st4te', resource: MCP() })
    .forEach(([k, v]) => authorize.searchParams.set(k, v));
  let code = '';
  await page.route('https://claude.ai/**', async (route) => {
    const u = new URL(route.request().url());
    expect(u.searchParams.get('state')).toBe('st4te');
    code = u.searchParams.get('code') ?? '';
    await route.fulfill({ status: 200, body: 'ok' });
  });
  await page.goto(authorize.toString());
  await expect(page).toHaveURL(/\/oauth\/consent\?authorization_id=/);
  await page.getByLabel('Correo').fill('owner@example.test');
  await page.getByLabel('Contraseña').fill('frase-larga-de-prueba-e2e');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('quiere acceder a tu LIFE OS')).toBeVisible();
  await expect(page.getByText('claude.ai', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Permitir' }).click();
  await expect.poll(() => code).not.toBe('');

  // 4. Token (formulario, como Claude) con client_id en los claims.
  const tok = await (await fetch(abs(as.token_endpoint), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT }),
  })).json();
  expect(tok.access_token).toBeTruthy();
  const claims = JSON.parse(Buffer.from(tok.access_token.split('.')[1], 'base64url').toString());
  expect(claims.client_id).toBe(reg.client_id);

  // 5. MCP con el token del conector.
  const init = await mcp(tok.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  expect(init.status).toBe(200);
  expect(init.body.result.serverInfo.name).toBeTruthy();
  const list = await mcp(tok.access_token, 'tools/list');
  expect(list.body.result.tools.map((t: { name: string }) => t.name)).toContain('lifeos_add_entry');

  const structure = JSON.parse((await tool(tok.access_token, 'lifeos_structure')).content[0].text);
  expect(structure.map((a: { area: string }) => a.area)).toContain('sueno');

  const add = await tool(tok.access_token, 'lifeos_add_entry', { area: 'cuerpo', form: 'peso', data: { peso: 72.9 }, note: 'dicho por chat' });
  expect(add.isError).toBe(false);
  expect(sql(`select source || ':' || (data->>'peso') from api.entries e join core.form f on f.id = e.form_id where f.slug = 'peso' and e.source = 'claude'`)).toBe('claude:72.9');
  const bad = await tool(tok.access_token, 'lifeos_add_entry', { area: 'cuerpo', form: 'peso', data: { peso: 9999 } });
  expect(bad.isError).toBe(true);

  // El token del conector NO puede cambiar la estructura aunque llame a la API directamente.
  const direct = await fetch(`${env.url}/rest/v1/rpc/save_area`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok.access_token}`, apikey: tok.access_token, 'content-type': 'application/json', 'content-profile': 'api' },
    body: JSON.stringify({ p_id: null, p_slug: 'hackeo', p_name: 'Hackeo', p_description: '', p_icon: '', p_sort_order: 1 }),
  });
  expect(direct.status).toBeGreaterThanOrEqual(400);
  expect(sql(`select count(*) from core.area where slug = 'hackeo'`)).toBe('0');

  // 6. Propone un cuestionario nuevo; lo apruebo en el dashboard y queda aplicado.
  const prop = await tool(tok.access_token, 'lifeos_propose_change', {
    kind: 'form.save',
    payload: { area: 'cuerpo', slug: 'cintura-rapida', name: 'Cintura rápida', cadence: 'weekly', fields: [{ key: 'cintura', label: 'Cintura', type: 'number', unit: 'cm', min: 40, max: 200 }] },
    rationale: 'Seguimiento semanal de cintura en 10 s.',
  });
  expect(prop.isError, prop.content[0].text).toBe(false);
  await page.goto('/propuestas');
  const pending = page.locator('section.card').filter({ hasText: 'Seguimiento semanal de cintura' });
  await expect(pending).toBeVisible();
  await pending.getByRole('button', { name: 'Aprobar' }).click();
  await expect(page.getByText('No hay nada pendiente.')).toBeVisible();
  expect(sql(`select status from core.proposal order by created_at desc limit 1`)).toBe('applied');
  await page.goto('/a/cuerpo');
  await expect(card(page, 'Cintura rápida')).toBeVisible();
});
