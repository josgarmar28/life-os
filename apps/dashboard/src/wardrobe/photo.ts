// Fotos de prendas: se procesan en el teléfono antes de subirlas (nada sale sin comprimir ni sin limpiar).
//  * Recodificar en un canvas elimina los metadatos EXIF (ubicación incluida).
//  * Foto con fondo transparente (recorte de "Levantar sujeto" del iPhone): se normaliza = se recorta al borde de la
//    prenda, se centra en un cuadrado con margen fijo y se guarda en PNG con transparencia (collage).
//  * Foto normal: lado largo 1024 px, JPEG. Etiqueta y detalle siempre van así.
//  * Cada foto lleva su miniatura. Cubo privado: sin URL públicas, solo URL firmadas de corta duración.
import { rpc, supabase } from '../supabase';
import { alphaBounds, fitSize, isCutout, squareLayout } from './imageMath';

export type PhotoKind = 'main' | 'label' | 'detail';

export const BUCKET = 'wardrobe';
const FULL_LONG = 1024;
const CUT_SIZE = 800;
const THUMB_LONG = 320;
const THUMB_CUT = 240;
const MAX_BYTES = 1_800_000; // el cubo rechaza más de 2 MB

export interface Processed {
  full: Blob;
  thumb: Blob;
  ext: 'png' | 'jpg';
  width: number;
  height: number;
  cutout: boolean;
}

async function decode(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('No se pudo leer la foto. Prueba con otra o haz la captura de nuevo.');
  } finally {
    // Se libera tras decodificar: el <img> ya tiene los píxeles.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo comprimir la foto.'))), type, quality));
}

function draw(img: CanvasImageSource, sw: number, sh: number, w: number, h: number, opaque: boolean): HTMLCanvasElement {
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: false })!;
  ctx.imageSmoothingQuality = 'high';
  if (opaque) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(img, 0, 0, sw, sh, 0, 0, w, h);
  return c;
}

/** Procesa una foto elegida o hecha con la cámara. `cutAllowed` = false para etiqueta y detalle. */
export async function processPhoto(file: Blob, cutAllowed: boolean): Promise<Processed> {
  const img = await decode(file);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  if (!sw || !sh) throw new Error('La foto está vacía.');

  // ¿Es un recorte con transparencia? Solo los PNG pueden serlo; se mira en una versión pequeña.
  let cut = false;
  if (cutAllowed && file.type === 'image/png') {
    const probe = fitSize(sw, sh, 200);
    const pc = draw(img, sw, sh, probe.w, probe.h, false);
    cut = isCutout(pc.getContext('2d')!.getImageData(0, 0, probe.w, probe.h).data);
  }

  if (cut) {
    // Caja de la prenda en una versión de trabajo (≤1024 px) y luego recorte exacto desde el original.
    const work = fitSize(sw, sh, 1024);
    const wc = draw(img, sw, sh, work.w, work.h, false);
    const box = alphaBounds(wc.getContext('2d')!.getImageData(0, 0, work.w, work.h).data, work.w, work.h);
    if (!box) throw new Error('La foto recortada está vacía (todo transparente).');
    const kx = sw / work.w;
    const ky = sh / work.h;
    const sx = Math.floor(box.x0 * kx);
    const sy = Math.floor(box.y0 * ky);
    const bw = Math.min(sw - sx, Math.ceil((box.x1 - box.x0) * kx));
    const bh = Math.min(sh - sy, Math.ceil((box.y1 - box.y0) * ky));
    let size = CUT_SIZE;
    let full: Blob;
    for (;;) {
      const lay = squareLayout(bw, bh, size);
      const c = canvas(size, size);
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, bw, bh, lay.dx, lay.dy, lay.dw, lay.dh);
      full = await toBlob(c, 'image/png');
      if (full.size <= MAX_BYTES || size <= 480) {
        const t = canvas(THUMB_CUT, THUMB_CUT);
        const tctx = t.getContext('2d')!;
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(c, 0, 0, size, size, 0, 0, THUMB_CUT, THUMB_CUT);
        return { full, thumb: await toBlob(t, 'image/png'), ext: 'png', width: size, height: size, cutout: true };
      }
      size = Math.round(size * 0.8);
    }
  }

  const f = fitSize(sw, sh, FULL_LONG);
  const c = draw(img, sw, sh, f.w, f.h, true);
  const full = await toBlob(c, 'image/jpeg', 0.82);
  const t = fitSize(f.w, f.h, THUMB_LONG);
  const tc = draw(c, f.w, f.h, t.w, t.h, true);
  return { full, thumb: await toBlob(tc, 'image/jpeg', 0.75), ext: 'jpg', width: f.w, height: f.h, cutout: false };
}

/** Sube la foto procesada, la enlaza a la prenda y borra la anterior del mismo tipo. */
export async function uploadGarmentPhoto(garmentId: string, kind: PhotoKind, file: Blob): Promise<Processed> {
  const p = await processPhoto(file, kind === 'main');
  const id = crypto.randomUUID();
  const path = `${garmentId}/${id}.${p.ext}`;
  const thumb = `${garmentId}/${id}-t.${p.ext}`;
  const type = p.ext === 'png' ? 'image/png' : 'image/jpeg';
  const store = supabase.storage.from(BUCKET);
  const up1 = await store.upload(path, p.full, { contentType: type, cacheControl: '31536000', upsert: false });
  if (up1.error) throw new Error(`No se pudo subir la foto: ${up1.error.message}`);
  const up2 = await store.upload(thumb, p.thumb, { contentType: type, cacheControl: '31536000', upsert: false });
  if (up2.error) {
    await store.remove([path]);
    throw new Error(`No se pudo subir la miniatura: ${up2.error.message}`);
  }
  try {
    const old = await rpc<{ old_path: string | null; old_thumb: string | null }>('set_garment_photo', {
      p_garment: garmentId, p_kind: kind, p_path: path, p_thumb: thumb, p_width: p.width, p_height: p.height,
      p_bytes: p.full.size + p.thumb.size,
    });
    const gone = [old.old_path, old.old_thumb].filter((x): x is string => Boolean(x));
    if (gone.length) await store.remove(gone);
  } catch (e) {
    await store.remove([path, thumb]);
    throw e;
  }
  return p;
}

export async function removeGarmentPhoto(garmentId: string, kind: PhotoKind): Promise<void> {
  const old = await rpc<{ old_path: string; old_thumb: string }>('remove_garment_photo', { p_garment: garmentId, p_kind: kind });
  await supabase.storage.from(BUCKET).remove([old.old_path, old.old_thumb]);
}

// --- URL firmadas (el cubo es privado) --------------------------------------------------------

const TTL = 3600;
const cache = new Map<string, { url: string; exp: number }>();

export function clearSignedUrls() { cache.clear(); }

/** URL firmadas de varias rutas a la vez, con caché en memoria (se renuevan antes de caducar). */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const need: string[] = [];
  for (const p of paths) {
    const hit = cache.get(p);
    if (hit && hit.exp > now + 120_000) out[p] = hit.url;
    else need.push(p);
  }
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(chunk, TTL);
    if (error) throw new Error(error.message);
    for (const d of data ?? []) {
      if (d.path && d.signedUrl) {
        cache.set(d.path, { url: d.signedUrl, exp: now + TTL * 1000 });
        out[d.path] = d.signedUrl;
      }
    }
  }
  return out;
}
