import { expect, test } from '@playwright/test';
import { ensureOwner, login, setOwnerPassword, sql } from './helpers';

test.beforeAll(async () => {
  await ensureOwner();
  await setOwnerPassword();
});

test('avisos: activar desde Ajustes y elegir horas y días', async ({ page }) => {
  await login(page);
  await page.goto('/ajustes');
  const card = page.locator('.push-card');
  await expect(card.getByRole('heading', { name: 'Avisos' })).toBeVisible();
  await expect(card.getByRole('button', { name: /Activar avisos en este/ })).toBeVisible();

  // Revisión semanal: domingo 17:00 por defecto; pasa a las 18:00 y también el sábado.
  await card.getByLabel('Hora de Revisión semanal').fill('18:00');
  await expect.poll(() => sql(`select to_char(at_time, 'HH24:MI') from core.push_reminder where key = 'semana'`)).toBe('18:00');
  await card.getByRole('group', { name: 'Días de Revisión semanal' }).getByRole('button', { name: 'S', exact: true }).click();
  await expect.poll(() => sql(`select days::text from core.push_reminder where key = 'semana'`)).toBe('{6,7}');
  await expect(card.getByRole('group', { name: 'Días de Revisión semanal' }).getByRole('button', { name: 'S', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Desactivar "Empezar el día".
  await card.getByRole('checkbox', { name: /Empezar el día/ }).uncheck();
  await expect.poll(() => sql(`select enabled::text from core.push_reminder where key = 'dia'`)).toBe('false');
  await expect(card.getByLabel('Hora de Empezar el día')).toBeDisabled();
});
