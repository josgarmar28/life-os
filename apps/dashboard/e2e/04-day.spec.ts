import { expect, test } from '@playwright/test';
import { login, sql } from './helpers';

// Un día pasado sin registros: los demás recorridos ya registran cosas hoy, y no se pueden borrar (solo se anulan).
const DAY = '2026-11-02';
const count = (slug: string) => sql(`select count(*) from api.entries e join core.form f on f.id = e.form_id where f.slug = '${slug}' and e.local_date = '${DAY}'`);

test('empezar el día: peso y registro de mañana seguidos, aviso de guardado y deshacer', async ({ page }) => {
  await page.clock.install({ time: new Date(`${DAY}T06:10:00+01:00`) });
  await login(page);
  await page.goto('/');
  await page.getByRole('link', { name: /Empezar el día/ }).click();

  await expect(page.getByRole('heading', { name: 'Peso' })).toBeVisible();
  await expect(page.getByText('al guardar pasas al siguiente registro')).toBeVisible();
  await page.getByRole('textbox', { name: /^Peso/ }).fill('77,8');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('status')).toContainText('Peso: guardado ✓');

  await expect(page.getByRole('heading', { name: 'Registro de mañana' })).toBeVisible();
  // A la vista solo las escalas, con lo que significa cada extremo; lo demás, en "Más detalles".
  await expect(page.getByRole('radiogroup', { name: '¿Tardaste más de 30 min en dormirte?' })).toBeHidden();
  await expect(page.locator('.scale-ends').first()).toContainText('1 peor');
  await page.getByRole('radiogroup', { name: 'Calidad del sueño' }).getByRole('radio', { name: '4' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('status')).toContainText('Registro de mañana: guardado ✓');
  expect(count('peso')).toBe('1');
  expect(count('manana')).toBe('1');

  // Deshacer: el registro deja de contar y Hoy vuelve a pedirlo.
  await page.getByRole('status').getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.getByRole('status')).toContainText('deshecho');
  expect(count('manana')).toBe('0');
  await expect(page.getByRole('link', { name: /Empezar el día/ })).toContainText('Registro de mañana');
});
