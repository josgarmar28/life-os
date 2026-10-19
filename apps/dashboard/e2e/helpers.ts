import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

export const env = {
  url: process.env.E2E_URL!,
  service: process.env.E2E_SERVICE!,
  db: process.env.E2E_DB!,
};
export const OWNER = 'owner@example.test';
export const PASSWORD = 'frase-larga-de-prueba-e2e';

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${env.url}/auth/v1${path}`, {
    ...init,
    headers: { apikey: env.service, Authorization: `Bearer ${env.service}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

/** SQL directo contra la base LOCAL desechable (lo que en producción hace el workflow bootstrap). */
export const sql = (q: string) => execFileSync('psql', [env.db, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();

/** Igual que bootstrap: usuario sin contraseña y registrado como dueño único. */
export async function ensureOwner(email = OWNER) {
  const r = await admin('/admin/users', { method: 'POST', body: JSON.stringify({ email, email_confirm: true }) });
  if (![200, 201, 422].includes(r.status)) throw new Error(`admin/users ${r.status} ${await r.text()}`);
  sql(`insert into core.app_owner (user_id) select id from auth.users where email = '${email}'
       on conflict (singleton) do update set user_id = excluded.user_id`);
}

/** Pone la contraseña por la API de administración (atajo para las pruebas que no prueban el alta). */
export async function setOwnerPassword(email = OWNER, password = PASSWORD) {
  const id = sql(`select id from auth.users where email = '${email}'`);
  const r = await admin(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ password }) });
  if (r.status !== 200) throw new Error(`set password ${r.status} ${await r.text()}`);
}

/** El código de 6 dígitos del correo (aquí no hay SMTP: se pide a la API de administración). */
export async function emailCode(email = OWNER): Promise<string> {
  const r = await admin('/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) });
  const j = await r.json();
  if (!j.email_otp) throw new Error(`generate_link ${r.status} ${JSON.stringify(j)}`);
  return j.email_otp as string;
}

export async function login(page: Page, email = OWNER, password = PASSWORD) {
  await page.goto('/');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy' })).toBeVisible();
}

/** Tarjeta (section.card) que contiene un encabezado con ese texto. */
export const card = (page: Page, heading: string | RegExp) =>
  page.locator('section.card').filter({ has: page.getByRole('heading', { name: heading }) });
