// Cálculos puros de la normalización de fotos (sin DOM, para poder probarlos).

/** Cabe en un cuadro de `maxLong` píxeles de lado largo sin ampliar. */
export function fitSize(w: number, h: number, maxLong: number): { w: number; h: number } {
  const k = Math.min(1, maxLong / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Proporción de píxeles (0 a 1) con transparencia notable: una foto normal no tiene ninguno. */
export function transparentRatio(rgba: Uint8ClampedArray, threshold = 250): number {
  const n = rgba.length / 4;
  if (!n) return 0;
  let t = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < threshold) t++;
  return t / n;
}

/** Una foto con transparencia es un recorte: al menos el 2 % de sus píxeles son transparentes. */
export function isCutout(rgba: Uint8ClampedArray): boolean {
  return transparentRatio(rgba) >= 0.02;
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** Rectángulo mínimo que contiene los píxeles con opacidad mayor que `threshold` (x1 e y1 exclusivos). */
export function alphaBounds(rgba: Uint8ClampedArray, w: number, h: number, threshold = 16): Box | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (rgba[row + x * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Coloca el recorte en un cuadrado de `size` píxeles, centrado, con `margin` (fracción del lado) en cada borde.
 * Todas las prendas quedan con el mismo margen y el lado largo ocupa el mismo espacio.
 */
export function squareLayout(boxW: number, boxH: number, size: number, margin = 0.06): { dx: number; dy: number; dw: number; dh: number } {
  const inner = size * (1 - 2 * margin);
  const k = inner / Math.max(boxW, boxH);
  const dw = Math.round(boxW * k);
  const dh = Math.round(boxH * k);
  return { dx: Math.round((size - dw) / 2), dy: Math.round((size - dh) / 2), dw, dh };
}
