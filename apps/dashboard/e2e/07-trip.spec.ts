import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { card, ensureOwner, login, setOwnerPassword, sql } from './helpers';

// Modo viaje: de unas fechas a gimnasio, días fuera y teletrabajo aplicados de golpe, y deshechos al cancelar.
const PLANS = fileURLToPath(new URL('./fixtures/planes-prueba.json', import.meta.url));
const TRAVEL = fileURLToPath(new URL('./fixtures/planes-viaje.json', import.meta.url));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await ensureOwner();
  await setOwnerPassword();
  sql(`delete from core.trip; delete from core.gym_period; delete from core.week_plan`);
});

test('viaje: vista previa, preparar de golpe, cambios a mano que sobreviven y cancelar', async ({ page }) => {
  // Reloj fijo: el lunes 11 de enero de 2027 (las fechas del formulario no pueden estar en el pasado).
  await page.clock.install({ time: new Date('2027-01-11T08:00:00+01:00') });
  await login(page);

  // Los planes de otras pruebas ya pueden estar; si no, se importan aquí.
  if (sql(`select count(*) from core.plan`) === '0') {
    await page.goto('/ajustes');
    const planes = card(page, 'Planes');
    await planes.getByLabel('Importar archivo de planes (.json)').setInputFiles(PLANS);
    await planes.getByRole('button', { name: 'Guardar 3 planes' }).click();
    await expect(planes.getByText(/^Guardado:/)).toBeVisible();
  }
  if (sql(`select count(*) from core.plan where content->>'gym' = 'la_zona'`) === '0') {
    await page.goto('/ajustes');
    const planes = card(page, 'Planes');
    await planes.getByLabel('Importar archivo de planes (.json)').setInputFiles(TRAVEL);
    await planes.getByRole('button', { name: 'Guardar 1 plan' }).click();
    await expect(planes.getByText(/^Guardado:/)).toBeVisible();
  }

  // Desde Más → Viaje.
  await page.goto('/');
  await page.locator('nav.tabs').getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: /^Viaje/ }).click();
  await expect(page.getByText('Aún no hay viajes.')).toBeVisible();
  await page.getByRole('link', { name: /Me voy a España/ }).click();

  // Viernes 15 (sale de Pully a las 13:00) a domingo 17 (sale de España a las 11:30, en casa a las 18:30).
  await page.getByLabel('Salgo de Pully').fill('2027-01-15');
  await page.getByLabel('Hora', { exact: true }).first().fill('13:00');
  await page.getByLabel('Salgo de España (hora)').fill('11:30');
  await page.getByLabel('Llego a Pully').fill('2027-01-17');
  await page.getByLabel('Hora', { exact: true }).nth(1).fill('18:30');

  const preview = page.getByRole('region', { name: 'Vista previa' });
  await expect(preview).toContainText('Entreno en La Zona');
  await expect(page.getByRole('button', { name: /sáb.*fuera de casa/i })).toHaveAttribute('aria-pressed', 'true');
  // Sin vacaciones, a mano: el sábado se queda "en casa" aunque el viaje lo dé por fuera.
  await page.getByRole('button', { name: /sáb.*fuera de casa/i }).click();
  await expect(page.getByRole('button', { name: /sáb.*fuera de casa/i })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: /sáb.*fuera de casa/i }).click();

  await page.getByRole('button', { name: 'Preparar viaje' }).click();
  await expect(page.getByRole('heading', { name: 'Viaje a España' })).toBeVisible();
  await expect(card(page, 'Checklist')).toContainText('Migros');

  expect(sql(`select kind || ':' || status || ':' || date_from || ':' || date_to || ':' || gym from core.trip`)).toBe('espana:planned:2027-01-15:2027-01-17:la_zona');
  // Gimnasio de allí desde el primer día que duerme fuera.
  expect(sql(`select gym || ':' || date_from || ':' || date_to from core.gym_period`)).toBe('la_zona:2027-01-16:2027-01-17');
  expect(sql(`select count(*) from core.week_plan where week_start = '2027-01-11'`)).toBe('1');
  expect(sql(`select away::text from core.week_plan where week_start = '2027-01-11'`)).toContain('5');
  expect(sql(`select gym_period_id is not null from core.trip`)).toBe('t');

  // En el horario, el viernes sale como día fuera de casa.
  await page.goto('/horario/2027-01-15');
  await expect(page.locator('.week-settings')).toContainText('Fuera');

  // Cancelar deshace solo lo que añadió el viaje.
  await page.goto('/viaje');
  await page.getByRole('link', { name: /Viaje a España/ }).click();
  await page.getByRole('button', { name: 'Cancelar el viaje' }).click();
  await page.getByRole('button', { name: 'Sí, cancelar el viaje' }).click();
  await expect(page).toHaveURL(/\/viaje$/);
  expect(sql(`select status from core.trip`)).toBe('cancelled');
  expect(sql(`select count(*) from core.gym_period`)).toBe('0');
  expect(sql(`select count(*) from core.week_plan where week_start = '2027-01-11'`)).toBe('0');
});
