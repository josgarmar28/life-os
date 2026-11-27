import { expect, test, type Page } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';
import { ensureOwner, env, login, setOwnerPassword, sql } from './helpers';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await ensureOwner();
  await setOwnerPassword();
});

/** PNG RGBA sintético (sin dependencias). */
function png(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y);
      raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Recorte (como el de «Levantar sujeto»): prenda 180×300 opaca dentro de un lienzo transparente de 300×500.
const CUTOUT = png(300, 500, (x, y) => (x >= 60 && x < 240 && y >= 100 && y < 400 ? [40, 80, 160, 255] : [0, 0, 0, 0]));
// Foto normal, opaca, 600×400.
const PHOTO = png(600, 400, (x, y) => [x % 256, y % 256, 120, 255]);

const attach = (page: Page, nth: number, name: string, buffer: Buffer) =>
  page.locator('input[type=file]').nth(nth).setInputFiles({ name, mimeType: 'image/png', buffer });

/** Capturas para revisar el aspecto: solo si se define E2E_SHOTS (carpeta de salida). */
const shot = async (page: Page, name: string) => {
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: false });
};

const chip = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test('armario: añadir con recorte normalizado, ráfaga, buscar y filtrar', async ({ page }) => {
  await login(page);
  await page.goto('/armario');
  await expect(page.getByText('Aún no hay prendas')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Suiza/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^España/ })).toBeVisible();

  // 1) Una prenda con el recorte: se normaliza a 800×800 con transparencia.
  await page.getByRole('link', { name: '+ Añadir prenda' }).click();
  await expect(chip(page, 'Suiza')).toHaveAttribute('aria-pressed', 'true');
  await attach(page, 0, 'camisa.png', CUTOUT);
  await expect(page.locator('.photo-box.main img')).toBeVisible();
  await chip(page, 'Camisa').click();
  await chip(page, 'Azul').click();
  await page.getByLabel('Precio', { exact: true }).fill('79,90');
  await page.getByLabel('Tienda', { exact: true }).fill('Zara');
  await page.getByRole('button', { name: 'Guardar prenda' }).click();
  await expect(page.getByRole('heading', { name: 'Camisa azul' })).toBeVisible();
  await shot(page, 'prenda');
  expect(sql(`select g.name || ':' || g.price || ':' || g.store || ':' || c.slug || ':' || g.currency from core.garment g join core.closet c on c.id = g.closet_id`)).toBe('Camisa azul:79.90:Zara:suiza:CHF');
  expect(sql(`select kind || ':' || width || 'x' || height || ':' || (path like '%.png') || ':' || (bytes < 900000) from core.garment_photo`)).toBe('main:800x800:true:true');
  await expect.poll(() => page.locator('.thumb.full img, .photo-box.main img').first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(800);

  // 2) Ráfaga: una foto normal (queda en 600×400 JPEG) y otra prenda sin foto; el tipo y la tienda se conservan.
  await page.goto('/armario/nueva');
  await page.getByLabel(/Seguir añadiendo/).check();
  await attach(page, 0, 'vaquero.png', PHOTO);
  await chip(page, 'Vaquero').click();
  await chip(page, 'Azul marino').click();
  await page.getByLabel('Tienda', { exact: true }).fill('Uniqlo');
  await page.getByRole('button', { name: 'Guardar y siguiente' }).click();
  await expect(page.getByText('Guardada: Vaquero azul marino.').first()).toBeVisible();
  await expect(page.getByText(/1 guardadas en esta tanda/)).toBeVisible();
  await expect(chip(page, 'Vaquero')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Tienda', { exact: true })).toHaveValue('Uniqlo');
  await expect(page.locator('.photo-box.main img')).toHaveCount(0);
  await chip(page, 'Camiseta').click();
  await chip(page, 'Blanco').click();
  await page.getByRole('button', { name: 'Guardar y siguiente' }).click();
  await expect(page.getByText(/2 guardadas en esta tanda/)).toBeVisible();
  expect(sql(`select count(*) from core.garment`)).toBe('3');
  expect(sql(`select kind || ':' || width || 'x' || height || ':' || (path like '%.jpg') from core.garment_photo where kind = 'main' and path like '%.jpg'`)).toBe('main:600x400:true');
  expect(sql(`select count(*) from core.garment_photo`)).toBe('2');
  const stored = await (await fetch(`${env.url}/storage/v1/_count`, { headers: { Authorization: 'Bearer x' } })).json();
  expect(stored.count).toBe(4); // dos fotos, cada una con su miniatura

  // 3) Buscar y filtrar.
  await page.goto('/armario');
  await expect(page.getByText('3 prendas', { exact: true })).toBeVisible();
  await shot(page, 'armario');
  await expect.poll(() => page.locator('.wgrid img').first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const search = page.getByLabel('Buscar prendas');
  await search.fill('ZARA');
  await expect(page.getByText('1 prenda', { exact: true })).toBeVisible();
  await search.fill('uniqlo');
  await expect(page.getByText('2 prendas', { exact: true })).toBeVisible();
  await search.fill('camíseta blanco');
  await expect(page.locator('.wgrid li')).toHaveCount(1);
  await search.fill('');
  await page.getByRole('button', { name: /^Filtros/ }).click();
  await shot(page, 'filtros');
  await page.locator('section.filters').getByRole('button', { name: 'Vaquero', exact: true }).click();
  await expect(page.locator('.wgrid li')).toHaveCount(1);
  await expect(page.locator('.wgrid li')).toContainText('Vaquero azul marino');
  await page.getByRole('button', { name: 'Borrar filtros' }).click();
  await page.locator('section.filters').getByRole('button', { name: /^Uniqlo/ }).click();
  await expect(page.locator('.wgrid li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Borrar filtros' }).click();
  await page.getByLabel('Precio desde').fill('50');
  await expect(page.locator('.wgrid li')).toHaveCount(1);
  await page.getByLabel('Precio desde').fill('');
  await expect(page.locator('.wgrid li')).toHaveCount(3);
});

test('armario: mover entre armarios, marcar usada y lavar', async ({ page }) => {
  await login(page);
  await page.goto('/armario');
  await page.getByRole('button', { name: 'Seleccionar' }).click();
  await page.getByRole('button', { name: /^Elegir Camisa azul/ }).click();
  await page.getByRole('button', { name: /^Elegir Vaquero/ }).click();
  await expect(page.getByText('2 elegidas')).toBeVisible();
  await shot(page, 'seleccion');
  await page.getByRole('button', { name: 'Mover a España' }).click();
  await expect(page.getByText('2 prendas movidas a España.')).toBeVisible();
  expect(sql(`select string_agg(c.slug || ':' || n, ',' order by c.slug) from (select closet_id, count(*) n from core.garment group by closet_id) x join core.closet c on c.id = x.closet_id`)).toBe('espana:2,suiza:1');
  expect(sql(`select count(*) from core.garment_move where note = '' and from_closet is not null`)).toBe('2');
  await expect(page.getByRole('button', { name: /^España\s*2/ })).toBeVisible();
  await page.getByRole('button', { name: /^España/ }).click();
  await expect(page.locator('.wgrid li')).toHaveCount(2);

  // Usadas en España → lista de lavado de España.
  await page.getByRole('button', { name: 'Seleccionar' }).click();
  await page.getByRole('button', { name: /^Elegir las 2/ }).click();
  await page.getByRole('button', { name: 'Marcar usada' }).click();
  await expect(page.getByText('2 prendas marcadas como usada.')).toBeVisible();
  expect(sql(`select count(*) from core.garment where worn`)).toBe('2');
  await page.getByRole('link', { name: /^Lavado/ }).click();
  await page.getByRole('button', { name: 'España', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Sin datos de lavado/ })).toBeVisible();
  await expect(page.getByText('Revisa la etiqueta')).toBeVisible();
  await shot(page, 'lavado');

  // Rellenar el cuidado de una prenda la saca de «Sin datos» y la pone en su tanda.
  await page.getByRole('link', { name: /Vaquero azul marino/ }).click();
  await page.getByRole('button', { name: 'Lavadora 40 °C', exact: true }).click();
  await page.getByRole('button', { name: 'Tendedero', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Guardado.').first()).toBeVisible();
  expect(sql(`select care_program || ':' || care_dry from core.garment where name = 'Vaquero azul marino'`)).toBe('lavadora_40:tendedero');
  await page.goto('/armario/lavado');
  await expect(page.getByRole('heading', { name: /Lavadora 40 °C · oscuros/ })).toBeVisible();
  await expect(page.getByText('Sin secadora: Vaquero azul marino.')).toBeVisible();
  await shot(page, 'lavado-tandas');
  await page.getByRole('region', { name: /Lavadora 40 °C/ }).getByRole('button', { name: 'Ya está lavada' }).click();
  await expect(page.getByText(/1 prenda lavada/)).toBeVisible();
  expect(sql(`select count(*) from core.garment where worn`)).toBe('1');
  await page.getByRole('button', { name: 'Ya está lavada' }).click();
  await expect(page.getByText('Nada marcado como usado')).toBeVisible();
  expect(sql(`select count(*) from core.garment where worn`)).toBe('0');
});

test('armario: cambiar la foto borra la anterior, archivar y recuperar, armarios', async ({ page }) => {
  await login(page);
  await page.goto('/armario');
  await page.getByRole('link', { name: /Camisa azul/ }).click();
  await expect(page.getByRole('heading', { name: 'Camisa azul' })).toBeVisible();
  const before = sql(`select path from core.garment_photo where kind = 'main' and path like '%.png'`);
  await attach(page, 0, 'otra.png', PHOTO);
  await expect(page.getByText('Foto guardada.')).toBeVisible();
  const after = sql(`select path from core.garment_photo where garment_id = (select id from core.garment where name = 'Camisa azul') and kind = 'main'`);
  expect(after).not.toBe(before);
  const stored = await (await fetch(`${env.url}/storage/v1/_count`, { headers: { Authorization: 'Bearer x' } })).json();
  expect(stored.keys).not.toContain(`wardrobe/${before}`);
  expect(stored.count).toBe(4);

  // Archivar no borra: sale de la lista y se recupera con el filtro de estado.
  await page.getByRole('button', { name: /^Archivar/ }).click();
  await expect(page.getByText('Prenda archivada.')).toBeVisible();
  expect(sql(`select status || ':' || (archived_at is not null) from core.garment where name = 'Camisa azul'`)).toBe('archived:true');
  await page.goto('/armario');
  await expect(page.getByText('2 prendas', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Filtros/ }).click();
  await page.locator('section.filters').getByRole('button', { name: 'Archivada', exact: true }).click();
  await page.locator('.wgrid li').getByText('Camisa azul').click();
  await page.getByRole('button', { name: 'Recuperar prenda' }).click();
  await expect(page.getByText('Prenda recuperada.')).toBeVisible();
  expect(sql(`select status from core.garment where name = 'Camisa azul'`)).toBe('active');

  // Armarios: crear uno, no se archiva con prendas, sí vacío.
  await page.goto('/armario/armarios');
  await page.getByLabel('Nombre del armario').fill('Maleta');
  await page.getByRole('button', { name: 'Crear' }).click();
  await expect(page.getByText('Armario creado.')).toBeVisible();
  expect(sql(`select slug from core.closet where name = 'Maleta'`)).toBe('maleta');
  await expect(page.locator('[data-closet]').filter({ hasText: '2 prendas' }).getByRole('button', { name: 'Archivar' })).toBeDisabled();
  await page.locator('[data-closet]').filter({ hasText: '0 prendas' }).last().getByRole('button', { name: 'Archivar' }).click();
  await expect(page.getByText('Armario archivado.')).toBeVisible();
  expect(sql(`select status from core.closet where slug = 'maleta'`)).toBe('archived');
});
