import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS, activeFilterCount, closetCounts, facetCounts, filterGarments, laundryGroups, norm, sortGarments,
  spent, storageUsage, totalPieces, type Closet, type Garment,
} from '@shared/wardrobe.ts';

let n = 0;
const g = (o: Partial<Garment>): Garment => ({
  id: `g${++n}`, name: 'Prenda', category: 'camiseta', subtype: '', colors: ['negro'], pattern: null, material: '', fit: null,
  size: '', quantity: 1, brand: '', store: '', price: null, currency: 'CHF', purchased_on: null, status: 'active', seasons: [],
  formality: null, warmth: null, care_program: null, care_dry: null, care_iron: null, care_note: '', notes: '', closet_id: 'ch',
  worn: false, worn_at: null, analysis: null, analysis_at: null, analysis_by: null,
  created_at: `2026-11-${String(10 + n).padStart(2, '0')}T10:00:00Z`, updated_at: '2026-11-27T10:00:00Z', ...o,
});

const closets: Closet[] = [
  { id: 'ch', slug: 'suiza', name: 'Suiza', country: 'CH', note: '', sort_order: 10, status: 'active' },
  { id: 'es', slug: 'espana', name: 'España', country: 'ES', note: '', sort_order: 20, status: 'active' },
];

const list: Garment[] = [
  g({ name: 'Camisa Oxford azul', category: 'camisa', colors: ['azul'], store: 'Zara', brand: 'Zara', price: 79.9, seasons: ['primavera', 'otono'], formality: 3, purchased_on: '2026-10-01' }),
  g({ name: 'Vaquero recto', category: 'vaquero', colors: ['azul-marino'], store: 'Uniqlo', brand: 'Levi’s', price: 110, closet_id: 'es', formality: 2 }),
  g({ name: 'Camiseta básica', category: 'camiseta', colors: ['blanco'], store: 'Uniqlo', price: 15, seasons: ['verano'], worn: true, analysis: { style: 'básico' } }),
  g({ name: 'Abrigo de lana', category: 'abrigo', colors: ['gris'], store: 'COS', price: 250, seasons: ['invierno'], closet_id: null, status: 'repair' }),
  g({ name: 'Jersey antiguo', category: 'jersey', colors: ['marron'], status: 'archived' }),
];

describe('búsqueda y filtros', () => {
  it('sin filtros enseña todo menos lo archivado', () => {
    expect(filterGarments(list, EMPTY_FILTERS).map((x) => x.name)).toEqual(['Camisa Oxford azul', 'Vaquero recto', 'Camiseta básica', 'Abrigo de lana']);
  });
  it('el texto ignora mayúsculas y acentos y exige todas las palabras', () => {
    expect(norm('Camíseta  ÁZUL')).toBe('camiseta azul');
    expect(filterGarments(list, { ...EMPTY_FILTERS, q: 'camisa AZUL' }).map((x) => x.name)).toEqual(['Camisa Oxford azul']);
    expect(filterGarments(list, { ...EMPTY_FILTERS, q: 'zara' })).toHaveLength(1);
    expect(filterGarments(list, { ...EMPTY_FILTERS, q: 'verano' }).map((x) => x.name)).toEqual(['Camiseta básica']);
    expect(filterGarments(list, { ...EMPTY_FILTERS, q: 'zzz' })).toHaveLength(0);
  });
  it('armario, tránsito, tipo, color, estación, tienda y marca', () => {
    expect(filterGarments(list, { ...EMPTY_FILTERS, closet: 'es' }).map((x) => x.name)).toEqual(['Vaquero recto']);
    expect(filterGarments(list, { ...EMPTY_FILTERS, closet: 'transit' }).map((x) => x.name)).toEqual(['Abrigo de lana']);
    expect(filterGarments(list, { ...EMPTY_FILTERS, categories: ['camisa', 'camiseta'] })).toHaveLength(2);
    expect(filterGarments(list, { ...EMPTY_FILTERS, colors: ['azul-marino', 'blanco'] })).toHaveLength(2);
    expect(filterGarments(list, { ...EMPTY_FILTERS, seasons: ['otono', 'invierno'] })).toHaveLength(2);
    expect(filterGarments(list, { ...EMPTY_FILTERS, stores: ['uniqlo'] })).toHaveLength(2);
    expect(filterGarments(list, { ...EMPTY_FILTERS, brands: ['LEVI’S'] }).map((x) => x.name)).toEqual(['Vaquero recto']);
  });
  it('estado, formalidad, usada y análisis pendiente', () => {
    expect(filterGarments(list, { ...EMPTY_FILTERS, statuses: ['archived'] }).map((x) => x.name)).toEqual(['Jersey antiguo']);
    expect(filterGarments(list, { ...EMPTY_FILTERS, statuses: ['repair'] })).toHaveLength(1);
    expect(filterGarments(list, { ...EMPTY_FILTERS, formality: [3] })).toHaveLength(1);
    expect(filterGarments(list, { ...EMPTY_FILTERS, worn: 'worn' }).map((x) => x.name)).toEqual(['Camiseta básica']);
    expect(filterGarments(list, { ...EMPTY_FILTERS, worn: 'clean' })).toHaveLength(3);
    expect(filterGarments(list, { ...EMPTY_FILTERS, analysis: 'pending' })).toHaveLength(3);
    expect(filterGarments(list, { ...EMPTY_FILTERS, analysis: 'done' })).toHaveLength(1);
  });
  it('precio: las prendas sin precio quedan fuera de un rango', () => {
    expect(filterGarments(list, { ...EMPTY_FILTERS, priceMin: 100 }).map((x) => x.name)).toEqual(['Vaquero recto', 'Abrigo de lana']);
    expect(filterGarments(list, { ...EMPTY_FILTERS, priceMax: 20 }).map((x) => x.name)).toEqual(['Camiseta básica']);
  });
  it('combina filtros y cuenta los activos', () => {
    const f = { ...EMPTY_FILTERS, q: 'uniqlo', closet: 'ch', worn: 'worn' as const };
    expect(filterGarments(list, f).map((x) => x.name)).toEqual(['Camiseta básica']);
    expect(activeFilterCount(f)).toBe(2);
    expect(activeFilterCount({ ...EMPTY_FILTERS, priceMin: 1, priceMax: 5 })).toBe(1);
  });
});

describe('orden y cuentas', () => {
  it('ordena por precio con las sin precio al final y por fecha de compra', () => {
    expect(sortGarments(list, 'price_desc').map((x) => x.name).slice(0, 3)).toEqual(['Abrigo de lana', 'Vaquero recto', 'Camisa Oxford azul']);
    expect(sortGarments(list, 'price_asc').map((x) => x.name).slice(0, 2)).toEqual(['Camiseta básica', 'Camisa Oxford azul']);
    expect(sortGarments(list, 'purchase')[0].name).toBe('Camisa Oxford azul');
    expect(sortGarments(list, 'recent')[0].name).toBe('Jersey antiguo');
    expect(sortGarments(list, 'name')[0].name).toBe('Abrigo de lana');
  });
  it('tiendas y marcas distintas, juntando mayúsculas', () => {
    expect(facetCounts([...list, g({ store: 'UNIQLO' })], (x) => x.store)).toEqual([{ value: 'Uniqlo', count: 3 }, { value: 'COS', count: 1 }, { value: 'Zara', count: 1 }]);
  });
  it('prendas por armario, con las que viajan', () => {
    expect(closetCounts(list, closets)).toEqual([
      { id: 'ch', name: 'Suiza', count: 2 }, { id: 'es', name: 'España', count: 1 }, { id: 'transit', name: 'En tránsito', count: 1 },
    ]);
  });
  it('piezas y gasto cuentan los lotes y se separan por moneda', () => {
    const l = [g({ quantity: 5, price: 3, name: 'Calcetines' }), g({ price: 40, currency: 'EUR' }), g({ price: 100, status: 'archived' })];
    expect(totalPieces(l)).toBe(6);
    expect(spent(l)).toEqual([{ currency: 'CHF', total: 15 }, { currency: 'EUR', total: 40 }]);
  });
});

describe('lavado', () => {
  const w = (o: Partial<Garment>) => g({ worn: true, ...o });
  it('solo cuenta las usadas y agrupa por programa y tono, de menos a más delicado', () => {
    const groups = laundryGroups([
      w({ name: 'Camiseta blanca', colors: ['blanco'], care_program: 'lavadora_30', care_dry: 'secadora' }),
      w({ name: 'Camiseta negra', colors: ['negro'], care_program: 'lavadora_30', care_dry: 'tendedero' }),
      w({ name: 'Polo azul', colors: ['azul'], care_program: 'lavadora_30' }),
      w({ name: 'Camisa', colors: ['blanco'], care_program: 'lavadora_40' }),
      w({ name: 'Jersey lana', colors: ['gris'], care_program: 'mano', care_dry: 'plano' }),
      w({ name: 'Americana', colors: ['negro'], care_program: 'tintoreria' }),
      w({ name: 'Sin etiqueta', care_program: null }),
      g({ name: 'Limpia', care_program: 'lavadora_30' }),
      w({ name: 'Archivada', status: 'archived', care_program: 'lavadora_30' }),
    ]);
    expect(groups.map((x) => x.title)).toEqual([
      'Lavadora 30 °C · claros', 'Lavadora 30 °C · de color', 'Lavadora 30 °C · oscuros', 'Lavadora 40 °C · claros', 'A mano', 'Tintorería', 'Sin datos de lavado',
    ]);
    expect(groups[0].items.map((x) => x.name)).toEqual(['Camiseta blanca']);
    expect(groups[2].noDryer.map((x) => x.name)).toEqual(['Camiseta negra']);
    expect(groups[2].hint).toContain('revés');
    expect(groups[4].noDryer).toHaveLength(1);
  });
  it('sin prendas usadas no hay lista', () => {
    expect(laundryGroups(list.map((x) => ({ ...x, worn: false })))).toEqual([]);
  });
});

describe('almacenamiento', () => {
  it('estima el uso con las miniaturas y avisa al 70 %', () => {
    expect(storageUsage([{ bytes: 250_000_000 }]).warn).toBe(false);
    const big = storageUsage(Array.from({ length: 2500 }, () => ({ bytes: 250_000 })));
    expect(big.bytes).toBe(700_000_000);
    expect(Math.round(big.pct)).toBe(70);
    expect(big.warn).toBe(true);
  });
});
