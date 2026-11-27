import { describe, expect, it } from 'vitest';
import { alphaBounds, fitSize, isCutout, squareLayout, transparentRatio } from '../src/wardrobe/imageMath';

/** Imagen RGBA de w×h con un rectángulo opaco (x0..x1, y0..y1) y el resto transparente. */
function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number, alphaOutside = 0): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = x >= x0 && x < x1 && y >= y0 && y < y1 ? 255 : alphaOutside;
  return d;
}

describe('normalización de fotos', () => {
  it('reduce al lado largo sin ampliar', () => {
    expect(fitSize(4032, 3024, 1024)).toEqual({ w: 1024, h: 768 });
    expect(fitSize(3024, 4032, 1024)).toEqual({ w: 768, h: 1024 });
    expect(fitSize(500, 400, 1024)).toEqual({ w: 500, h: 400 });
  });
  it('distingue un recorte de una foto normal', () => {
    expect(isCutout(rect(10, 10, 3, 3, 7, 7))).toBe(true);
    expect(transparentRatio(rect(10, 10, 0, 0, 10, 10))).toBe(0);
    expect(isCutout(rect(10, 10, 0, 0, 10, 10))).toBe(false);
    // Un solo píxel transparente (1 %) no hace un recorte.
    const almost = rect(10, 10, 0, 0, 10, 10);
    almost[3] = 0;
    expect(isCutout(almost)).toBe(false);
  });
  it('encuentra la caja de la prenda e ignora el ruido casi invisible', () => {
    expect(alphaBounds(rect(20, 10, 4, 2, 15, 9), 20, 10)).toEqual({ x0: 4, y0: 2, x1: 15, y1: 9 });
    expect(alphaBounds(rect(20, 10, 4, 2, 15, 9, 8), 20, 10)).toEqual({ x0: 4, y0: 2, x1: 15, y1: 9 });
    expect(alphaBounds(rect(5, 5, 0, 0, 0, 0), 5, 5)).toBeNull();
  });
  it('centra el recorte en el cuadrado con margen fijo y mismo lado largo', () => {
    const wide = squareLayout(400, 200, 800);
    expect(wide).toEqual({ dx: 48, dy: 224, dw: 704, dh: 352 });
    const tall = squareLayout(200, 400, 800);
    expect(tall).toEqual({ dx: 224, dy: 48, dw: 352, dh: 704 });
    // Cualquier tamaño de prenda deja el mismo margen en el lado largo.
    expect(squareLayout(37, 90, 800).dy).toBe(48);
    expect(squareLayout(900, 900, 800)).toEqual({ dx: 48, dy: 48, dw: 704, dh: 704 });
  });
});
