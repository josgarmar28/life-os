import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { card, ensureOwner, login, setOwnerPassword, sql } from './helpers';

// Planes sintéticos (los reales viven en la carpeta privada del dueño, nunca en el repositorio).
const PLANS = fileURLToPath(new URL('./fixtures/planes-prueba.json', import.meta.url));
const TRAVEL = fileURLToPath(new URL('./fixtures/planes-viaje.json', import.meta.url));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await ensureOwner();
  await setOwnerPassword();
});

test('planes: importar el archivo, revisar y guardar versiones', async ({ page }) => {
  await login(page);
  await page.locator('nav.tabs').getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: /^Ajustes/ }).click();
  const planes = card(page, 'Planes');
  await expect(planes.getByText('Sin importar.')).toHaveCount(3);
  await planes.getByLabel('Importar archivo de planes (.json)').setInputFiles(PLANS);
  await expect(planes.getByText('Lunes: Torso · 2 ejercicios, 4 series')).toBeVisible();
  await planes.getByRole('button', { name: 'Guardar 3 planes' }).click();
  await expect(planes.getByText('Guardado: Horario, Rutina de entreno, Menú y compra.')).toBeVisible();
  await expect(planes.getByText('v1 · Rutina de prueba')).toBeVisible();
  expect(sql(`select string_agg(kind || ':' || version || ':' || source, ',' order by kind) from core.plan`)).toBe('meals:1:dashboard,schedule:1:dashboard,training:1:dashboard');
});

test('horario: el día con sus comidas, el ahora en Hoy y la semana de teletrabajo', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('region', { name: 'Ahora' })).toBeVisible();

  await page.goto('/horario/2027-01-11');
  await expect(page.getByRole('heading', { name: /Lunes 11/ })).toContainText('oficina');
  const agenda = page.locator('ol.agenda');
  await expect(agenda).toContainText('Autobús al trabajo');
  await expect(agenda.locator('li', { hasText: 'Comida' })).toContainText('Pasta con tomate');
  await expect(agenda.locator('li', { hasText: 'Gimnasio' })).toContainText('Torso');

  // Por defecto teletrabajo X y V; esta semana, J y V: la cocina corta pasa al jueves.
  await expect(page.locator('.week-settings')).toContainText('X, V (por defecto)');
  await page.getByRole('button', { name: 'Cambiar' }).click();
  const tele = page.getByRole('group', { name: 'Teletrabajo' });
  await tele.getByRole('button', { name: 'X' }).click();
  await tele.getByRole('button', { name: 'J' }).click();
  await page.getByRole('group', { name: 'Fuera de casa' }).getByRole('button', { name: 'D' }).click();
  await page.getByRole('button', { name: 'Guardar semana' }).click();
  await expect(page.locator('.week-settings')).toContainText('Teletrabajo: J, V');
  await expect(page.locator('.week-settings')).toContainText('Fuera: D');
  expect(sql(`select telework::text || away::text from core.week_plan where week_start = '2027-01-11'`)).toBe('{4,5}{7}');

  await page.getByRole('navigation', { name: 'Día' }).getByRole('link', { name: 'Jueves' }).click();
  await expect(page).toHaveURL(/\/horario\/2027-01-14$/);
  await expect(agenda.locator('li', { hasText: 'Cocina corta' })).toContainText('Pasta con tomate × 2');
  await page.getByRole('navigation', { name: 'Día' }).getByRole('link', { name: 'Miércoles' }).click();
  await expect(agenda).toContainText('Autobús al trabajo');
  await expect(agenda).not.toContainText('Cocina corta');
});

test('modo entreno: cuestionario, series con descanso y molestia, y la última vez en la siguiente', async ({ page }) => {
  await login(page);
  await page.locator('nav.tabs').getByRole('link', { name: 'Entreno' }).click();
  await page.getByText('Hacer otra sesión (cambio de día)').click();
  await page.getByRole('button', { name: 'L · Torso' }).click();

  for (const q of ['Sueño', 'Estrés (5 = nada)', 'Dolor muscular (5 = nada)', 'Energía', 'Motivación']) {
    await page.getByRole('radiogroup', { name: q }).getByRole('radio', { name: '4' }).click();
  }
  await expect(page.getByText('Primera vez: calibra la carga')).toBeVisible();
  await page.getByLabel('Serie 1 kg').fill('40');
  await page.getByLabel('Serie 1 reps').fill('10');
  await page.getByLabel('Serie 1 RIR').fill('2');
  await page.getByRole('button', { name: 'Serie 1 hecha' }).click();
  await expect(page.getByRole('timer')).toContainText('Descanso');
  await page.getByRole('button', { name: 'Saltar' }).click();
  await expect(page.getByLabel('Serie 2 kg')).toHaveValue('40'); // arrastra la carga
  await page.getByLabel('Serie 2 reps').fill('9');
  await page.getByLabel('Serie 2 RIR').fill('2');
  await page.getByLabel('Serie 2 molestia 0-10').fill('3');
  await page.getByLabel('Serie 2 zona de la molestia').fill('hombro dcho.');
  await page.getByRole('button', { name: 'Serie 2 hecha' }).click();
  // Pasa solo al siguiente ejercicio (crunch).
  await page.getByLabel('Serie 1 reps').fill('12');
  await page.getByRole('button', { name: 'Serie 1 hecha' }).click();

  // El borrador sobrevive a recargar la página (bloqueo del móvil, app cerrada).
  await page.reload();
  await expect(page.getByRole('button', { name: /Crunch en máquina.*1\/2/ })).toBeVisible();

  await page.getByRole('button', { name: 'Terminar y guardar' }).click();
  await expect(page).toHaveURL(/\/a\/entreno$/);
  expect(sql(`select string_agg(r->>'linea' || ':' || coalesce(r->>'carga_kg', '-') || 'x' || (r->>'reps') || ':' || coalesce(r->>'zona', ''), ',' order by n)
    from api.entries e join core.form f on f.id = e.form_id, jsonb_array_elements(e.data->'series') with ordinality as t(r, n)
    where f.slug = 'sesion' and e.note like 'Torso%'`)).toBe('press_pecho:40x10:,press_pecho:40x9:hombro dcho.,crunch:-x12:');
  expect(sql(`select data->>'pre_energia' from api.entries e join core.form f on f.id = e.form_id where f.slug = 'sesion' and e.note like 'Torso%'`)).toBe('4');

  // Siguiente vez: la última sesión y la molestia ámbar guían la sugerencia.
  await page.goto('/entreno');
  await page.getByText('Hacer otra sesión (cambio de día)').click();
  await page.getByRole('button', { name: 'J · Torso' }).click();
  await expect(page.getByText(/Última vez .*40×10 @2 · 40×9 @2/)).toBeVisible();
  await expect(page.locator('.suggestion').first()).toContainText('Molestia ámbar');
});

test('otro gimnasio: periodo de viaje, mantenimiento con historial aparte y excepción por sesión', async ({ page }) => {
  await login(page);
  await page.locator('nav.tabs').getByRole('link', { name: 'Más' }).click();
  await page.getByRole('link', { name: /^Ajustes/ }).click();
  const planes = card(page, 'Planes');
  await planes.getByLabel('Importar archivo de planes (.json)').setInputFiles(TRAVEL);
  await expect(planes.getByText('Gimnasio: La Zona · mantenimiento (sin subir cargas ni escalones)')).toBeVisible();
  await planes.getByRole('button', { name: 'Guardar 1 plan' }).click();
  expect(sql(`select string_agg(version || ':' || coalesce(content->>'gym', '-'), ',' order by version) from core.plan where kind = 'training'`)).toBe('1:-,2:la_zona');

  // Sin periodo: el de casa. Al marcar "en La Zona" hoy, el entreno sale de su rutina.
  await page.locator('nav.tabs').getByRole('link', { name: 'Entreno' }).click();
  const gyms = page.getByRole('radiogroup', { name: 'Gimnasio' });
  await expect(gyms.getByRole('radio', { name: 'Elevate' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Añadir periodo en La Zona' }).click();
  await page.getByRole('button', { name: 'Guardar periodo' }).click();
  await expect(gyms.getByRole('radio', { name: 'La Zona' })).toHaveAttribute('aria-checked', 'true');
  await expect(card(page, 'En otro gimnasio')).toContainText('La Zona:');
  expect(sql(`select gym || ':' || (date_to - date_from) from core.gym_period`)).toBe('la_zona:0');

  await page.getByText('Hacer otra sesión (cambio de día)').click();
  await page.getByRole('button', { name: 'L · Torso (La Zona)' }).click();
  await expect(page.getByText('Primera vez aquí: calibra con RIR 3')).toBeVisible(); // la línea de casa no cuenta aquí
  await page.getByLabel('Serie 1 kg').fill('30');
  await page.getByLabel('Serie 1 reps').fill('8');
  await page.getByLabel('Serie 1 RIR').fill('3');
  await page.getByRole('button', { name: 'Serie 1 hecha' }).click();
  await page.getByRole('button', { name: 'Saltar' }).click();
  await page.getByRole('button', { name: 'Terminar y guardar' }).click();
  await expect(page).toHaveURL(/\/a\/entreno$/);
  expect(sql(`select (data->>'gimnasio') || ':' || (data->'series'->0->>'linea') from api.entries e join core.form f on f.id = e.form_id where f.slug = 'sesion' and e.note like '%La Zona%'`))
    .toBe('la_zona:es_press_pecho');

  // Siguiente vez allí: mantiene la carga; con otra máquina, avisa.
  await page.goto('/entreno');
  await page.getByText('Hacer otra sesión (cambio de día)').click();
  await page.getByRole('button', { name: 'J · Torso (La Zona)' }).click();
  await expect(page.locator('.suggestion').first()).toContainText('Mantén 30 kg');
  await page.getByLabel('Máquina').first().fill('Otra prensa');
  await expect(page.getByText(/La última vez usaste otra máquina \(Máquina de viaje\)/)).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Descartar' }).click();

  // Excepción para una sesión suelta: el día sigue siendo de La Zona.
  await gyms.getByRole('radio', { name: 'Elevate' }).click();
  await expect(page.getByText('Cambio solo para esta sesión: este día es de La Zona.')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await card(page, 'En otro gimnasio').getByRole('button', { name: /^Borrar el periodo/ }).click();
  await expect(card(page, 'En otro gimnasio')).not.toContainText('La Zona:');
  expect(sql(`select count(*) from core.gym_period`)).toBe('0');
});

test('compra: contar la despensa, lista de lo que falta, pedir y recibir', async ({ page }) => {
  await login(page);
  await page.locator('nav.tabs').getByRole('link', { name: 'Compra' }).click();
  await page.getByRole('navigation', { name: 'Compra' }).getByRole('link', { name: 'Despensa' }).click();
  await expect(card(page, 'Despensa')).toContainText('sin contar');
  await page.getByRole('button', { name: 'Contar la despensa' }).click();
  await page.getByLabel(/^Pasta/).fill('2');
  await page.getByLabel(/^Yogur/).fill('4');
  await page.getByRole('button', { name: 'Guardar recuento' }).click();
  await expect(page.getByText('Recuento guardado (2 productos).')).toBeVisible();
  expect(sql(`select string_agg(product || '=' || qty::int, ',' order by product) from core.stock_move where kind = 'count'`)).toBe('pasta=1000,yogur=500');
  await expect(card(page, 'Despensa').locator('li', { hasText: 'Pasta' })).toContainText(/contado el/);

  await page.getByRole('navigation', { name: 'Compra' }).getByRole('link', { name: 'Lista' }).click();
  const falta = card(page, 'Falta');
  await expect(falta).toContainText('Tomate triturado');
  await expect(page.getByRole('heading', { name: 'Otras tiendas (pedido aparte)' })).toBeVisible();
  const tomate = page.getByRole('group', { name: 'Tomate triturado' });
  const before = Number(await tomate.locator('.qty').textContent());
  await page.getByRole('button', { name: 'Más Tomate triturado' }).click();
  await expect(tomate.locator('.qty')).toHaveText(String(before + 1));
  await page.getByRole('button', { name: 'He hecho el pedido' }).click();
  await expect(page.getByText(/Pedido guardado para el/)).toBeVisible();
  expect(sql(`select (items @> '[{"product":"tomate","packages":${before + 1}}]')::text || status from core.shopping_order`)).toBe('trueordered');

  await page.getByRole('navigation', { name: 'Compra' }).getByRole('link', { name: /Pedidos/ }).click();
  await page.getByRole('checkbox', { name: 'Tomate triturado' }).uncheck();
  await page.getByRole('button', { name: 'Recibido' }).click();
  await expect(page.getByText('No hay pedidos en camino.', { exact: false })).toBeVisible();
  expect(sql(`select status from core.shopping_order`)).toBe('received');
  expect(sql(`select count(*) from core.stock_move where kind = 'purchase' and product = 'tomate'`)).toBe('0');
  expect(Number(sql(`select count(*) from core.stock_move where kind = 'purchase'`))).toBeGreaterThan(0);
});
