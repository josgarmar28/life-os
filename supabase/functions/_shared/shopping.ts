// Despensa y lista de la compra a partir del menú.
// Stock estimado = último recuento + compras y ajustes posteriores − lo que el menú gasta cada día
// desde el recuento (los días marcados "fuera de casa" no gastan). Lo que falta = lo que el menú
// necesita desde la entrega hasta la siguiente (más un margen) − lo que quedará al llegar el pedido.
import { addDays } from './stats.ts';
import type { MealsPlan, Product, Weekday } from './plans.ts';
import { isoWeekday } from './plans.ts';

export interface StockMove {
  product: string;
  kind: 'count' | 'purchase' | 'adjust';
  qty: number;
  occurred_at: string;
  local_date: string;
}

/** Consumo de un día de la semana por producto (una ración de cada comida del menú). */
export function dailyUse(plan: MealsPlan, wd: Weekday): Map<string, number> {
  const out = new Map<string, number>();
  const day = plan.days.find((d) => d.weekday === wd);
  for (const m of day?.meals ?? []) {
    const r = plan.recipes.find((x) => x.key === m.recipe);
    for (const g of r?.ingredients ?? []) out.set(g.product, (out.get(g.product) ?? 0) + g.amount);
  }
  return out;
}

/** Consumo total entre dos fechas incluidas, saltando los días fuera de casa. */
export function useBetween(plan: MealsPlan, from: string, to: string, away: Set<string> = new Set()): Map<string, number> {
  const out = new Map<string, number>();
  const cache = new Map<Weekday, Map<string, number>>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (away.has(d)) continue;
    const wd = isoWeekday(d);
    if (!cache.has(wd)) cache.set(wd, dailyUse(plan, wd));
    for (const [k, v] of cache.get(wd)!) out.set(k, (out.get(k) ?? 0) + v);
  }
  return out;
}

export interface StockLine {
  product: Product;
  /** Cantidad estimada en la unidad del producto (puede ser negativa si el recuento es viejo). */
  qty: number | null;
  /** Fecha del último recuento, o null si nunca se contó. */
  counted: string | null;
  /** Consumo medio diario según el menú. */
  perDay: number;
  /** Días que dura lo que hay, o null si no se consume. */
  daysLeft: number | null;
}

export function estimateStock(plan: MealsPlan, moves: StockMove[], today: string, away: Set<string> = new Set()): StockLine[] {
  const week = useBetween(plan, addDays(today, -6), today);
  return plan.products.map((p) => {
    const mine = moves.filter((m) => m.product === p.key).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const perDay = (week.get(p.key) ?? 0) / 7;
    if (!mine.length) return { product: p, qty: null, counted: null, perDay, daysLeft: null };
    let lastCount = -1;
    mine.forEach((m, i) => { if (m.kind === 'count') lastCount = i; });
    const base = lastCount >= 0 ? mine[lastCount] : mine[0];
    let qty = lastCount >= 0 ? base.qty : 0;
    for (const m of mine.slice(lastCount >= 0 ? lastCount + 1 : 0)) qty += m.qty;
    // El día del recuento se da por gastado ya; se restan los días siguientes hasta hoy incluido.
    if (base.local_date < today) qty -= useBetween(plan, addDays(base.local_date, 1), today, away).get(p.key) ?? 0;
    const daysLeft = perDay > 0 ? Math.max(0, qty) / perDay : null;
    return { product: p, qty, counted: lastCount >= 0 ? base.local_date : null, perDay, daysLeft };
  });
}

export interface NeedLine {
  product: Product;
  /** Cantidad que hará falta en el periodo del pedido. */
  need: number;
  /** Lo que quedará cuando llegue el pedido. */
  atDelivery: number;
  missing: number;
  packages: number;
  cost: number | null;
  /** Sin recuento: se ha supuesto que no hay nada. */
  unknown: boolean;
}

export interface ShoppingList {
  delivery: string;
  until: string;
  lines: NeedLine[];
  total: number;
  /** Productos de otras tiendas (pedido aparte). */
  other: NeedLine[];
}

/**
 * Lo que falta para el pedido que llega el día `delivery` y cubre `cover` días más `buffer` de margen.
 * Un faltante menor del 10 % de un envase no se compra.
 */
export function shoppingList(plan: MealsPlan, stock: StockLine[], today: string, delivery: string, opts: { cover?: number; buffer?: number; away?: Set<string> } = {}): ShoppingList {
  const cover = opts.cover ?? plan.cover_days ?? 14;
  const buffer = opts.buffer ?? plan.buffer_days ?? 2;
  const away = opts.away ?? new Set<string>();
  const until = addDays(delivery, cover + buffer - 1);
  const before = delivery > addDays(today, 1) ? useBetween(plan, addDays(today, 1), addDays(delivery, -1), away) : new Map<string, number>();
  const during = useBetween(plan, delivery, until, away);
  const mainShop = plan.shop;
  const lines: NeedLine[] = [];
  const other: NeedLine[] = [];
  for (const s of stock) {
    const p = s.product;
    const need = during.get(p.key) ?? 0;
    if (need <= 0) continue;
    const now = s.qty ?? 0;
    const atDelivery = Math.max(0, now - (before.get(p.key) ?? 0));
    const missing = Math.max(0, need - atDelivery);
    const packages = missing <= p.package * 0.1 ? 0 : Math.ceil(missing / p.package - 0.1);
    const line: NeedLine = {
      product: p, need, atDelivery, missing, packages,
      cost: p.price !== undefined ? Math.round(packages * p.price * 100) / 100 : null,
      unknown: s.qty === null,
    };
    if (mainShop && p.shop && p.shop !== mainShop) other.push(line);
    else lines.push(line);
  }
  const total = Math.round(lines.reduce((a, l) => a + (l.cost ?? 0), 0) * 100) / 100;
  return { delivery, until, lines, total, other };
}

/** "1,5 envases (450 g)" o "8 ud". */
export function formatQty(p: Pick<Product, 'package' | 'unit' | 'package_label'>, qty: number): string {
  const n = (x: number, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('es-ES');
  if (p.unit === 'ud' && p.package === 1) return `${n(qty, 0)} ud`;
  const packs = qty / p.package;
  return `${n(packs)} ${p.package_label ?? 'env.'} (${n(qty, 0)} ${p.unit})`;
}
