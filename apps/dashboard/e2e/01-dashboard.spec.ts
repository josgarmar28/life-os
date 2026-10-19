import { expect, test } from '@playwright/test';
import { card, emailCode, ensureOwner, login, OWNER, PASSWORD, setOwnerPassword, sql } from './helpers';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await ensureOwner();
});

test('primer acceso: código por correo, crear contraseña y volver a entrar con ella', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Primera vez u olvidé la contraseña' }).click();
  await page.getByLabel('Correo').fill(OWNER);
  await page.getByRole('button', { name: 'Enviarme un enlace' }).click();
  await expect(page.getByLabel('Código')).toBeVisible(); // el envío terminó: ahora sí, pido el código vigente
  const code = await emailCode();
  await page.getByLabel('Código').fill(code);
  await page.getByRole('button', { name: 'Entrar con el código' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy' })).toBeVisible();

  await page.getByRole('link', { name: 'Ajustes' }).click();
  await page.getByLabel('Nueva contraseña').fill(PASSWORD);
  await page.getByLabel('Repítela').fill(PASSWORD);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByText('Contraseña guardada')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  await login(page);
  for (const area of ['Sueño', 'Entrenamiento', 'Cuerpo', 'Nutrición', 'Planificación', 'Proyectos', 'Finanzas', 'Pelo']) {
    await expect(card(page, new RegExp(area))).toBeVisible();
  }
});

test('un desconocido no entra aunque tenga cuenta', async ({ page }) => {
  // Cuenta creada a mano (el registro está cerrado) pero que no es la dueña: RLS no le deja ver nada.
  await ensureOwner('intruso@example.test').catch(() => undefined);
  sql(`insert into core.app_owner (user_id) select id from auth.users where email = '${OWNER}'
       on conflict (singleton) do update set user_id = excluded.user_id`);
  await setOwnerPassword('intruso@example.test', 'intruso-intruso-123');
  await page.goto('/');
  await page.getByLabel('Correo').fill('intruso@example.test');
  await page.getByLabel('Contraseña').fill('intruso-intruso-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hoy' })).toHaveCount(0);
});

test('registro de mañana: validar, guardar, corregir y borrar', async ({ page }) => {
  await login(page);
  await page.goto('/a/sueno/manana/nuevo');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Calidad del sueño: es obligatorio')).toBeVisible();

  await page.getByRole('radiogroup', { name: 'Calidad del sueño' }).getByRole('radio', { name: '4' }).click();
  await page.getByLabel('Despertares').fill('2');
  await page.getByRole('radiogroup', { name: '¿Tardaste más de 30 min en dormirte?' }).getByRole('radio', { name: 'No' }).click();
  await page.getByRole('group', { name: 'Algo distinto' }).getByRole('button', { name: 'Ruido' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page).toHaveURL(/\/a\/sueno$/);
  const manana = card(page, 'Registro de mañana');
  await expect(manana.locator('li.entry')).toHaveCount(1);
  await expect(manana.locator('li.entry')).toContainText('Calidad del sueño');
  await expect(manana.locator('li.entry')).toContainText('Ruido');

  await manana.getByRole('link', { name: 'Editar' }).click();
  await expect(page.getByText('Estás corrigiendo un registro')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Calidad del sueño' }).getByRole('radio', { name: '4' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radiogroup', { name: 'Calidad del sueño' }).getByRole('radio', { name: '5' }).click();
  await page.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(page).toHaveURL(/\/a\/sueno$/);
  await expect(manana.locator('li.entry')).toHaveCount(1);
  expect(sql(`select count(*) from core.entry e join core.form f on f.id = e.form_id where f.slug = 'manana'`)).toBe('2');
  expect(sql(`select data->>'calidad' from api.entries e join core.form f on f.id = e.form_id where f.slug = 'manana'`)).toBe('5');

  page.once('dialog', (d) => void d.accept());
  await manana.getByRole('button', { name: 'Borrar' }).click();
  await expect(manana.locator('li.entry')).toHaveCount(0);
  expect(sql(`select count(*) from core.entry e join core.form f on f.id = e.form_id where f.slug = 'manana'`)).toBe('3');
});

test('sesión de pesas con series en tabla', async ({ page }) => {
  await login(page);
  await page.goto('/a/entreno/sesion/nuevo');
  await page.getByRole('radiogroup', { name: 'Antes: energía' }).getByRole('radio', { name: '4' }).click();
  await page.getByRole('button', { name: 'Añadir fila' }).click();
  const row1 = page.locator('.trow').nth(0);
  await row1.getByLabel('Ejercicio').fill('Prensa');
  await row1.getByLabel('Carga (kg)').fill('140');
  await row1.getByLabel('Reps').fill('10');
  await row1.getByLabel('RIR').fill('2');
  await page.getByRole('button', { name: 'Duplicar la última' }).click();
  await page.locator('.trow').nth(1).getByLabel('Reps').fill('9');
  await page.getByRole('button', { name: 'Añadir fila' }).click(); // fila vacía: se ignora al guardar
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page).toHaveURL(/\/a\/entreno$/);
  const sesion = card(page, 'Sesión de pesas');
  await expect(sesion.locator('ul.rows li')).toHaveCount(2);
  await expect(sesion.locator('ul.rows li').nth(1)).toContainText('Reps: 9');
  expect(sql(`select jsonb_array_length(data->'series') from api.entries e join core.form f on f.id = e.form_id where f.slug = 'sesion'`)).toBe('2');

  // Siguiente sesión: partir de las series de la última vez y ajustar.
  await page.goto('/a/entreno/sesion/nuevo');
  await page.getByRole('button', { name: /Copiar de la última vez .*2 filas/ }).click();
  await expect(page.locator('.trow')).toHaveCount(2);
  await expect(page.locator('.trow').nth(0).getByLabel('Ejercicio')).toHaveValue('Prensa');
  await page.locator('.trow').nth(0).getByLabel('Carga (kg)').fill('145');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page).toHaveURL(/\/a\/entreno$/);
  expect(sql(`select string_agg(r->>'carga_kg', ',' order by e.occurred_at, r->>'reps') from api.entries e join core.form f on f.id = e.form_id,
    jsonb_array_elements(e.data->'series') r where f.slug = 'sesion'`)).toBe('140,140,145,140');
});

test('gestión: crear área, cuestionario y campo; registrar; archivar y borrar para siempre', async ({ page }) => {
  await login(page);
  await page.goto('/gestion');
  const nueva = card(page, 'Nueva área');
  await nueva.getByLabel('Icono').fill('🧪');
  await nueva.getByLabel('Nombre').fill('Prueba e2e');
  await nueva.getByRole('button', { name: 'Crear' }).click();
  await expect(page).toHaveURL(/\/gestion\/prueba-e2e$/);

  const nuevo = card(page, 'Nuevo cuestionario');
  await nuevo.getByLabel('Nombre').fill('Diario');
  await nuevo.getByLabel('Frecuencia').selectOption('daily');
  await nuevo.getByRole('button', { name: 'Añadir cuestionario' }).click();

  const diario = card(page, 'Diario');
  await diario.getByRole('button', { name: 'Editar' }).click();
  await diario.getByRole('button', { name: 'Añadir campo' }).click();
  await diario.getByLabel('Pregunta o nombre').fill('Nivel de prueba');
  await diario.locator('.field-editor > .row').first().getByLabel('Tipo').selectOption('integer');
  await diario.getByLabel('Mín.').fill('0');
  await diario.getByLabel('Máx.').fill('10');
  await diario.getByLabel('Obligatorio').check();
  await diario.getByRole('button', { name: 'Guardar campo' }).click();
  await expect(diario.getByText('Nivel de prueba')).toBeVisible();

  // Campo tabla con el editor de columnas (sin JSON).
  await diario.getByRole('button', { name: 'Añadir campo' }).click();
  await diario.getByLabel('Pregunta o nombre').fill('Tareas');
  await diario.locator('.field-editor > .row').first().getByLabel('Tipo').selectOption('table');
  await diario.getByRole('button', { name: 'Añadir columna' }).click();
  await diario.getByLabel('Columna 1').fill('Tarea');
  await diario.getByLabel('Obligatoria en cada fila').check();
  await diario.getByRole('button', { name: 'Añadir columna' }).click();
  await diario.getByLabel('Columna 2').fill('Minutos');
  await diario.locator('.col-draft').nth(1).getByLabel('Tipo').selectOption('integer');
  await diario.getByRole('button', { name: 'Guardar campo' }).click();
  await expect(diario.getByText(/Tareas.*Tabla/)).toBeVisible();
  // El segundo campo nuevo no hereda mín., máx. ni "obligatorio" del anterior.
  expect(sql(`select concat_ws(',', required, min, max) from core.field where key = 'tareas'`)).toBe('f');
  expect(sql(`select columns::text from core.field where key = 'tareas'`)).toBe('[{"key": "tarea", "type": "text", "label": "Tarea", "required": true}, {"key": "minutos", "type": "integer", "label": "Minutos"}]');

  await page.goto('/a/prueba-e2e/diario/nuevo');
  await page.getByLabel('Nivel de prueba').fill('11');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(/Nivel de prueba: debe estar entre 0 y 10/)).toBeVisible();
  await page.getByLabel('Nivel de prueba').fill('7');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(card(page, 'Diario').locator('li.entry')).toContainText('7');

  await page.goto('/gestion/prueba-e2e');
  await page.getByRole('button', { name: 'Archivar área' }).click();
  await expect(page.getByRole('heading', { name: 'Área archivada' })).toBeVisible();
  const borrar = page.getByRole('button', { name: 'Borrar para siempre' });
  await page.getByLabel('Nombre del área').fill('Prueba');
  await expect(borrar).toBeDisabled();
  await page.getByLabel('Nombre del área').fill('Prueba e2e');
  await borrar.click();
  await expect(page).toHaveURL(/\/gestion$/);
  await expect(page.getByRole('link', { name: /Prueba e2e/ })).toHaveCount(0);
  expect(sql(`select count(*) from core.area where slug = 'prueba-e2e'`)).toBe('0');
});

test('sin cobertura: la app abre, registra en el teléfono y lo envía al volver la red', async ({ page, context }) => {
  await login(page);
  // Con red: la app guarda su carcasa (service worker) y la estructura de los cuestionarios.
  await page.goto('/a/cuerpo');
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15_000 });

  await context.setOffline(true);
  await page.reload(); // abrir la app sin red
  await expect(page.getByText('Sin conexión: puedes registrar')).toBeVisible();
  await page.getByRole('link', { name: 'Registrar' }).first().click();
  await expect(page.getByRole('heading', { name: 'Peso' })).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByLabel('Peso').fill('73,4');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('1 registro pendiente de enviar')).toBeVisible();
  expect(sql(`select count(*) from api.entries e join core.form f on f.id = e.form_id where f.slug = 'peso' and e.source = 'dashboard'`)).toBe('0');

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('1 registro pendiente de enviar')).toHaveCount(0, { timeout: 15_000 });
  expect(sql(`select data->>'peso' from api.entries e join core.form f on f.id = e.form_id where f.slug = 'peso' and e.source = 'dashboard'`)).toBe('73.4');
});

test('semana: indicadores de todas las áreas día a día', async ({ page }) => {
  await login(page);
  await page.locator('nav.tabs').getByRole('link', { name: 'Semana', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Semana', exact: true })).toBeVisible();
  const grid = page.getByRole('table', { name: 'Indicadores por día' });
  await expect(grid).toBeVisible();
  await expect(grid.locator('.wblock').filter({ hasText: 'Peso' })).toContainText('73,4');
  await expect(card(page, 'Registros de la semana')).toContainText('Sesión de pesas');
  await page.getByRole('link', { name: 'Semana anterior' }).click();
  await expect(page).toHaveURL(/\/semana\/\d{4}-\d{2}-\d{2}$/);
  await expect(grid.locator('.wblock').filter({ hasText: 'Peso' })).not.toContainText('73,4');
});
