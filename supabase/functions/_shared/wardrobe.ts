// Armario: tipos, vocabulario, búsqueda con filtros, lista de lavado y uso del almacenamiento.
// Lo usan el dashboard y (en la fase 2) el conector, para que él y Claude vean lo mismo.
// Código determinista: nada de esto necesita IA.

export interface Closet {
  id: string;
  slug: string;
  name: string;
  country: string | null;
  note: string;
  sort_order: number;
  status: 'active' | 'archived';
}

export type GarmentStatus = 'active' | 'repair' | 'donate' | 'archived';

export interface Garment {
  id: string;
  name: string;
  category: string;
  subtype: string;
  colors: string[];
  pattern: string | null;
  material: string;
  fit: 'slim' | 'regular' | 'oversize' | null;
  size: string;
  quantity: number;
  brand: string;
  store: string;
  price: number | null;
  currency: string;
  purchased_on: string | null;
  status: GarmentStatus;
  seasons: string[];
  formality: number | null;
  warmth: number | null;
  care_program: string | null;
  care_dry: string | null;
  care_iron: string | null;
  care_note: string;
  notes: string;
  closet_id: string | null;
  worn: boolean;
  worn_at: string | null;
  analysis: Record<string, unknown> | null;
  analysis_at: string | null;
  analysis_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GarmentPhoto {
  id: string;
  garment_id: string;
  kind: 'main' | 'label' | 'detail';
  path: string;
  thumb_path: string;
  width: number;
  height: number;
  bytes: number;
}

export interface GarmentMove {
  id: string;
  garment_id: string;
  from_closet: string | null;
  to_closet: string | null;
  note: string;
  actor: string;
  occurred_at: string;
}

// ---------------------------------------------------------------------------
// Vocabulario (la BD solo comprueba el formato; esta lista es lo que ofrece la interfaz)
// ---------------------------------------------------------------------------

export const CATEGORY_GROUPS = ['Arriba', 'Abajo', 'Exterior', 'Calzado', 'Complementos', 'Otros'] as const;

export const CATEGORIES: { key: string; label: string; group: (typeof CATEGORY_GROUPS)[number] }[] = [
  { key: 'camiseta', label: 'Camiseta', group: 'Arriba' },
  { key: 'camisa', label: 'Camisa', group: 'Arriba' },
  { key: 'polo', label: 'Polo', group: 'Arriba' },
  { key: 'jersey', label: 'Jersey', group: 'Arriba' },
  { key: 'sudadera', label: 'Sudadera', group: 'Arriba' },
  { key: 'pantalon', label: 'Pantalón', group: 'Abajo' },
  { key: 'vaquero', label: 'Vaquero', group: 'Abajo' },
  { key: 'short', label: 'Short', group: 'Abajo' },
  { key: 'chaqueta', label: 'Chaqueta', group: 'Exterior' },
  { key: 'abrigo', label: 'Abrigo', group: 'Exterior' },
  { key: 'traje', label: 'Traje / americana', group: 'Exterior' },
  { key: 'calzado', label: 'Calzado', group: 'Calzado' },
  { key: 'cinturon', label: 'Cinturón', group: 'Complementos' },
  { key: 'accesorio', label: 'Accesorio', group: 'Complementos' },
  { key: 'deporte', label: 'Ropa deportiva', group: 'Otros' },
  { key: 'calcetines', label: 'Calcetines (lote)', group: 'Otros' },
  { key: 'interior', label: 'Ropa interior (lote)', group: 'Otros' },
  { key: 'otro', label: 'Otro', group: 'Otros' },
];

export type Tone = 'claro' | 'oscuro' | 'color';

export const COLORS: { key: string; label: string; hex: string; tone: Tone }[] = [
  { key: 'blanco', label: 'Blanco', hex: '#f5f5f2', tone: 'claro' },
  { key: 'crema', label: 'Crema', hex: '#efe6d2', tone: 'claro' },
  { key: 'beige', label: 'Beige', hex: '#cdb894', tone: 'claro' },
  { key: 'gris-claro', label: 'Gris claro', hex: '#c4c6c9', tone: 'claro' },
  { key: 'gris', label: 'Gris', hex: '#8b8f94', tone: 'color' },
  { key: 'negro', label: 'Negro', hex: '#1d1d1f', tone: 'oscuro' },
  { key: 'azul-marino', label: 'Azul marino', hex: '#1f2f54', tone: 'oscuro' },
  { key: 'azul', label: 'Azul', hex: '#3c6fb4', tone: 'color' },
  { key: 'celeste', label: 'Celeste', hex: '#9cc3e6', tone: 'claro' },
  { key: 'verde', label: 'Verde', hex: '#4f8a5b', tone: 'color' },
  { key: 'caqui', label: 'Caqui', hex: '#7d7a4c', tone: 'color' },
  { key: 'marron', label: 'Marrón', hex: '#6b4a32', tone: 'oscuro' },
  { key: 'rojo', label: 'Rojo', hex: '#b5302f', tone: 'color' },
  { key: 'burdeos', label: 'Burdeos', hex: '#6d1f2e', tone: 'oscuro' },
  { key: 'rosa', label: 'Rosa', hex: '#e3a1b0', tone: 'claro' },
  { key: 'amarillo', label: 'Amarillo', hex: '#e2c04a', tone: 'claro' },
  { key: 'naranja', label: 'Naranja', hex: '#d9762b', tone: 'color' },
  { key: 'morado', label: 'Morado', hex: '#6f4a8e', tone: 'oscuro' },
  { key: 'multicolor', label: 'Multicolor', hex: '#999999', tone: 'color' },
];

export const PATTERNS = [
  { key: 'liso', label: 'Liso' },
  { key: 'rayas', label: 'Rayas' },
  { key: 'cuadros', label: 'Cuadros' },
  { key: 'estampado', label: 'Estampado' },
  { key: 'textura', label: 'Textura / punto' },
  { key: 'otro', label: 'Otro' },
];

export const SEASONS = [
  { key: 'primavera', label: 'Primavera' },
  { key: 'verano', label: 'Verano' },
  { key: 'otono', label: 'Otoño' },
  { key: 'invierno', label: 'Invierno' },
];

export const FITS = [
  { key: 'slim', label: 'Ajustado' },
  { key: 'regular', label: 'Normal' },
  { key: 'oversize', label: 'Holgado' },
];

export const STATUSES: { key: GarmentStatus; label: string }[] = [
  { key: 'active', label: 'En uso' },
  { key: 'repair', label: 'Para arreglar' },
  { key: 'donate', label: 'Para donar' },
  { key: 'archived', label: 'Archivada' },
];

export const FORMALITY_LABELS = ['', 'Deporte / casa', 'Informal', 'Casual arreglado', 'Elegante', 'Formal'];
export const WARMTH_LABELS = ['', 'Muy fresca', 'Fresca', 'Media', 'Abrigada', 'Muy abrigada'];

/** Programa de lavado, de menos a más delicado; "orden" fija el orden de la lista de lavado. */
export const CARE_PROGRAMS: { key: string; label: string; short: string; order: number; machine: boolean }[] = [
  { key: 'lavadora_30', label: 'Lavadora 30 °C', short: '30 °C', order: 1, machine: true },
  { key: 'lavadora_40', label: 'Lavadora 40 °C', short: '40 °C', order: 2, machine: true },
  { key: 'lavadora_60', label: 'Lavadora 60 °C', short: '60 °C', order: 3, machine: true },
  { key: 'delicado', label: 'Programa delicado', short: 'Delicado', order: 4, machine: true },
  { key: 'mano', label: 'A mano', short: 'A mano', order: 5, machine: false },
  { key: 'tintoreria', label: 'Tintorería', short: 'Tintorería', order: 6, machine: false },
  { key: 'sin_lavar', label: 'No se lava (solo airear)', short: 'Airear', order: 7, machine: false },
];

export const CARE_DRY = [
  { key: 'secadora', label: 'Secadora' },
  { key: 'tendedero', label: 'Tendedero' },
  { key: 'plano', label: 'Secar en plano' },
  { key: 'colgar', label: 'Colgar' },
];

export const CARE_IRON = [
  { key: 'no', label: 'No planchar' },
  { key: 'bajo', label: 'Plancha baja' },
  { key: 'medio', label: 'Plancha media' },
  { key: 'alto', label: 'Plancha alta' },
];

const bySlug = <T extends { key: string; label: string }>(list: T[]) => (k: string | null | undefined, fallback = '') =>
  list.find((x) => x.key === k)?.label ?? (k ?? fallback);

export const categoryLabel = bySlug(CATEGORIES);
export const colorLabel = bySlug(COLORS);
export const patternLabel = bySlug(PATTERNS);
export const seasonLabel = bySlug(SEASONS);
export const fitLabel = bySlug(FITS);
export const statusLabel = bySlug(STATUSES);
export const dryLabel = bySlug(CARE_DRY);
export const ironLabel = bySlug(CARE_IRON);
export const careLabel = (k: string | null) => CARE_PROGRAMS.find((x) => x.key === k)?.label ?? 'Sin datos de lavado';
export const colorHex = (k: string) => COLORS.find((c) => c.key === k)?.hex ?? '#999999';
export const toneOf = (g: Pick<Garment, 'colors'>): Tone => COLORS.find((c) => c.key === g.colors[0])?.tone ?? 'color';

// ---------------------------------------------------------------------------
// Búsqueda y filtros
// ---------------------------------------------------------------------------

export interface Filters {
  /** Texto libre: nombre, tipo, marca, tienda, color, tejido, notas. Cada palabra debe aparecer. */
  q: string;
  /** Id de armario, 'transit' (sin armario) o '' (todos). */
  closet: string;
  categories: string[];
  colors: string[];
  seasons: string[];
  /** Estados; vacío = todas menos las archivadas. */
  statuses: GarmentStatus[];
  stores: string[];
  brands: string[];
  formality: number[];
  worn: '' | 'worn' | 'clean';
  analysis: '' | 'pending' | 'done';
  priceMin: number | null;
  priceMax: number | null;
}

export const EMPTY_FILTERS: Filters = {
  q: '', closet: '', categories: [], colors: [], seasons: [], statuses: [], stores: [], brands: [], formality: [],
  worn: '', analysis: '', priceMin: null, priceMax: null,
};

/** Minúsculas y sin acentos, para buscar "camiseta" o "Camiseta" o "camíseta" igual. */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function haystack(g: Garment): string {
  return norm([
    g.name, categoryLabel(g.category), g.subtype, g.brand, g.store, g.material, g.notes, g.size,
    g.colors.map((c) => colorLabel(c)).join(' '), patternLabel(g.pattern), g.seasons.map((s) => seasonLabel(s)).join(' '),
  ].join(' '));
}

export function activeFilterCount(f: Filters): number {
  return (f.closet ? 1 : 0) + (f.categories.length ? 1 : 0) + (f.colors.length ? 1 : 0) + (f.seasons.length ? 1 : 0)
    + (f.statuses.length ? 1 : 0) + (f.stores.length ? 1 : 0) + (f.brands.length ? 1 : 0) + (f.formality.length ? 1 : 0)
    + (f.worn ? 1 : 0) + (f.analysis ? 1 : 0) + (f.priceMin !== null || f.priceMax !== null ? 1 : 0);
}

export function filterGarments(list: Garment[], f: Filters): Garment[] {
  const words = norm(f.q).split(/\s+/).filter(Boolean);
  const stores = f.stores.map(norm);
  const brands = f.brands.map(norm);
  return list.filter((g) => {
    if (f.statuses.length ? !f.statuses.includes(g.status) : g.status === 'archived') return false;
    if (f.closet === 'transit' ? g.closet_id !== null : f.closet ? g.closet_id !== f.closet : false) return false;
    if (f.categories.length && !f.categories.includes(g.category)) return false;
    if (f.colors.length && !g.colors.some((c) => f.colors.includes(c))) return false;
    if (f.seasons.length && !g.seasons.some((s) => f.seasons.includes(s))) return false;
    if (stores.length && !stores.includes(norm(g.store))) return false;
    if (brands.length && !brands.includes(norm(g.brand))) return false;
    if (f.formality.length && (g.formality === null || !f.formality.includes(g.formality))) return false;
    if (f.worn === 'worn' && !g.worn) return false;
    if (f.worn === 'clean' && g.worn) return false;
    if (f.analysis === 'pending' && g.analysis) return false;
    if (f.analysis === 'done' && !g.analysis) return false;
    if (f.priceMin !== null && (g.price === null || g.price < f.priceMin)) return false;
    if (f.priceMax !== null && (g.price === null || g.price > f.priceMax)) return false;
    if (words.length) {
      const h = haystack(g);
      if (!words.every((w) => h.includes(w))) return false;
    }
    return true;
  });
}

export type SortKey = 'recent' | 'name' | 'category' | 'price_desc' | 'price_asc' | 'purchase';

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Añadidas hace poco' },
  { key: 'purchase', label: 'Fecha de compra' },
  { key: 'name', label: 'Nombre' },
  { key: 'category', label: 'Tipo' },
  { key: 'price_desc', label: 'Precio: de más a menos' },
  { key: 'price_asc', label: 'Precio: de menos a más' },
];

export function sortGarments(list: Garment[], key: SortKey): Garment[] {
  const out = [...list];
  const cmpStr = (a: string, b: string) => a.localeCompare(b, 'es');
  const catIdx = (g: Garment) => CATEGORIES.findIndex((c) => c.key === g.category);
  switch (key) {
    case 'name': return out.sort((a, b) => cmpStr(a.name, b.name));
    case 'category': return out.sort((a, b) => catIdx(a) - catIdx(b) || cmpStr(a.name, b.name));
    // Las prendas sin precio o sin fecha van siempre al final.
    case 'price_desc': return out.sort((a, b) => (b.price ?? -1) - (a.price ?? -1) || cmpStr(a.name, b.name));
    case 'price_asc': return out.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || cmpStr(a.name, b.name));
    case 'purchase': return out.sort((a, b) => (b.purchased_on ?? '').localeCompare(a.purchased_on ?? '') || cmpStr(a.name, b.name));
    default: return out.sort((a, b) => b.created_at.localeCompare(a.created_at) || cmpStr(a.name, b.name));
  }
}

/** Valores distintos (con cuántas prendas) para ofrecer tienda y marca como filtros. */
export function facetCounts(list: Garment[], pick: (g: Garment) => string): { value: string; count: number }[] {
  const m = new Map<string, { value: string; count: number }>();
  for (const g of list) {
    const v = pick(g).trim();
    if (!v) continue;
    const k = norm(v);
    const cur = m.get(k);
    if (cur) cur.count += 1;
    else m.set(k, { value: v, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'es'));
}

export function closetCounts(list: Garment[], closets: Closet[]): { id: string; name: string; count: number }[] {
  const live = list.filter((g) => g.status !== 'archived');
  const out = closets.map((c) => ({ id: c.id, name: c.name, count: live.filter((g) => g.closet_id === c.id).length }));
  const transit = live.filter((g) => g.closet_id === null).length;
  if (transit) out.push({ id: 'transit', name: 'En tránsito', count: transit });
  return out;
}

// ---------------------------------------------------------------------------
// Lavado
// ---------------------------------------------------------------------------

export interface LaundryGroup {
  key: string;
  title: string;
  /** Pista breve para esa tanda. */
  hint: string;
  items: Garment[];
  /** Prendas de la tanda que no admiten secadora (o sin dato de secado, si hay otros datos). */
  noDryer: Garment[];
}

const TONE_LABEL: Record<Tone, string> = { claro: 'claros', oscuro: 'oscuros', color: 'de color' };

/**
 * Agrupa las prendas usadas en tandas: mismo programa y mismo tono (claros / oscuros / de color).
 * Las que no tienen programa van aparte, para que revise la etiqueta. Solo cuenta lo que está "usado".
 */
export function laundryGroups(list: Garment[]): LaundryGroup[] {
  const worn = list.filter((g) => g.worn && g.status !== 'archived');
  const groups = new Map<string, LaundryGroup & { order: number; tone: number }>();
  const toneOrder: Record<Tone, number> = { claro: 0, color: 1, oscuro: 2 };
  for (const g of worn) {
    const prog = CARE_PROGRAMS.find((p) => p.key === g.care_program);
    const machine = prog?.machine ?? false;
    const tone = toneOf(g);
    const key = prog ? (machine ? `${prog.key}:${tone}` : prog.key) : 'sin_datos';
    let grp = groups.get(key);
    if (!grp) {
      const title = !prog ? 'Sin datos de lavado' : machine ? `${prog.label} · ${TONE_LABEL[tone]}` : prog.label;
      const hint = !prog ? 'Revisa la etiqueta y rellena el cuidado de la prenda.'
        : prog.key === 'tintoreria' ? 'No va a la lavadora: llévala a la tintorería.'
          : prog.key === 'mano' ? 'Agua fría o tibia, sin retorcer.'
            : prog.key === 'sin_lavar' ? 'Basta con airearla; lava solo si hay mancha.'
              : prog.key === 'delicado' ? 'Bolsa de lavado y centrifugado suave.'
                : tone === 'oscuro' ? 'Del revés para que no destiñan.' : tone === 'claro' ? 'No mezcles con colores o negros.' : 'Sepáralas de claros y negros.';
      grp = { key, title, hint, items: [], noDryer: [], order: prog?.order ?? 99, tone: machine ? toneOrder[tone] : 0 };
      groups.set(key, grp);
    }
    grp.items.push(g);
    if (g.care_dry && g.care_dry !== 'secadora') grp.noDryer.push(g);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.tone - b.tone)
    .map(({ order: _o, tone: _t, ...rest }) => ({ ...rest, items: rest.items.sort((a, b) => a.name.localeCompare(b.name, 'es')) }));
}

// ---------------------------------------------------------------------------
// Almacenamiento (plan gratuito de Supabase: 1 GB de archivos)
// ---------------------------------------------------------------------------

export const STORAGE_LIMIT_BYTES = 1_000_000_000;

export function storageUsage(photos: Pick<GarmentPhoto, 'bytes'>[]): { bytes: number; pct: number; warn: boolean } {
  // La miniatura pesa poco (≈5-10 % de la foto): se cuenta un 12 % más.
  const bytes = Math.round(photos.reduce((n, p) => n + p.bytes, 0) * 1.12);
  const pct = (bytes / STORAGE_LIMIT_BYTES) * 100;
  return { bytes, pct, warn: pct >= 70 };
}

// ---------------------------------------------------------------------------
// Resumen para el título y las cuentas
// ---------------------------------------------------------------------------

export function totalPieces(list: Garment[]): number {
  return list.filter((g) => g.status !== 'archived').reduce((n, g) => n + g.quantity, 0);
}

export function spent(list: Garment[]): { currency: string; total: number }[] {
  const m = new Map<string, number>();
  for (const g of list) {
    if (g.status === 'archived' || g.price === null) continue;
    m.set(g.currency, (m.get(g.currency) ?? 0) + g.price * g.quantity);
  }
  return [...m.entries()].map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }));
}
