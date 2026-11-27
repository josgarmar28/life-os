// Planes: horario semanal, rutina de entreno y menú (con recetas y productos).
// Son documentos versionados en core.plan; aquí están sus tipos, la validación completa (la BD solo
// comprueba la forma mínima) y cómo se resuelve "qué toca" en un día y a una hora.
// Lo usan el dashboard (Horario, Hoy, Entreno, Compra) y el conector de Claude.
import { addDays, weekStart } from './stats.ts';

export type PlanKind = 'schedule' | 'training' | 'meals';
/** Día ISO: 1 = lunes … 7 = domingo. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAY_SHORT: Record<Weekday, string> = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 7: 'D' };
export const WEEKDAY_NAME: Record<Weekday, string> = {
  1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo',
};
export const PLAN_LABEL: Record<PlanKind, string> = { schedule: 'Horario', training: 'Rutina de entreno', meals: 'Menú y compra' };

// ---------------------------------------------------------------------------
// Horario
// ---------------------------------------------------------------------------

export type BlockLink =
  | { kind: 'training' }
  | { kind: 'meal'; slot: string }
  | { kind: 'cook'; session: string }
  | { kind: 'form'; area: string; form: string }
  | { kind: 'shopping' };

export interface ScheduleBlock {
  id: string;
  days: Weekday[];
  start: string;
  end?: string;
  title: string;
  detail?: string;
  icon?: string;
  /** Solo los días de oficina o solo los de teletrabajo (se eligen cada semana). */
  on?: 'oficina' | 'teletrabajo';
  /** Solo el primer día de teletrabajo de la semana que esté en esta lista (p. ej. el lote 3, X o J). */
  first_telework_in?: Weekday[];
  link?: BlockLink;
}

export interface SchedulePlan {
  blocks: ScheduleBlock[];
  /** Días de teletrabajo si esa semana no se ha elegido otra cosa. */
  default_telework?: Weekday[];
  notes?: string[];
}

// ---------------------------------------------------------------------------
// Rutina
// ---------------------------------------------------------------------------

export type ExerciseType = 'compuesto' | 'aislamiento' | 'cardio' | 'movilidad';
export type LoadKind = 'discos' | 'hibrida' | 'selector' | 'polea' | 'mancuerna' | 'barra' | 'hack' | 'corporal';
export const LOAD_KINDS: LoadKind[] = ['discos', 'hibrida', 'selector', 'polea', 'mancuerna', 'barra', 'hack', 'corporal'];

export interface Exercise {
  /** Identificador estable de la línea (se guarda en cada serie para comparar con la última vez). */
  key: string;
  name: string;
  machine?: string;
  type: ExerciseType;
  sets?: number;
  reps?: [number, number];
  rir?: [number, number];
  rest_s?: number;
  load?: LoadKind;
  muscle?: string;
  per_side?: boolean;
  minutes?: number;
  notes?: string;
}

export interface TrainingDay {
  weekday: Weekday;
  name: string;
  kind: 'pesas' | 'cardio' | 'descanso';
  minutes?: number;
  notes?: string;
  exercises: Exercise[];
}

export type TrainingMode = 'progresion' | 'mantenimiento';

export interface TrainingPlan {
  days: TrainingDay[];
  rules?: string[];
  /** Gimnasio de la rutina (slug). Sin él, el de casa: cada gimnasio tiene su plan vigente y su historial. */
  gym?: string;
  /** Nombre para mostrar; si falta, sale del slug. */
  gym_name?: string;
  /** "mantenimiento" (gimnasio de viaje): repetir carga, sin subir ni decidir escalones. */
  mode?: TrainingMode;
}

/** Gimnasio de casa: el de los planes de entreno sin "gym". */
export const HOME_GYM = 'elevate';

/** Slug del gimnasio de una rutina (o de cualquier plan: los que no son de entreno no tienen). */
export function gymOf(content: unknown): string {
  const g = isObj(content) ? content.gym : undefined;
  return typeof g === 'string' && g.trim() ? g : HOME_GYM;
}

export function gymLabel(gym: string, plan?: Pick<TrainingPlan, 'gym_name'> | null): string {
  if (plan?.gym_name?.trim()) return plan.gym_name;
  return gym.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/** Periodo en otro gimnasio (core.gym_period): ambos días incluidos. */
export interface GymPeriod {
  id: string;
  gym: string;
  date_from: string;
  date_to: string;
  note: string;
}

/** Gimnasio que toca un día: el del periodo que lo cubre o, si no hay, el de casa. */
export function gymForDate(periods: GymPeriod[], date: string): string {
  return periods.find((p) => p.date_from <= date && date <= p.date_to)?.gym ?? HOME_GYM;
}

export function trainingMode(plan: Pick<TrainingPlan, 'mode'> | null | undefined): TrainingMode {
  return plan?.mode === 'mantenimiento' ? 'mantenimiento' : 'progresion';
}

// ---------------------------------------------------------------------------
// Menú, recetas y productos
// ---------------------------------------------------------------------------

export type Unit = 'g' | 'ml' | 'ud';
export type Storage = 'nevera' | 'congelador' | 'despensa';
export const STORAGE_LABEL: Record<Storage, string> = { nevera: 'Nevera', congelador: 'Congelador', despensa: 'Despensa' };

export interface Product {
  key: string;
  name: string;
  /** Nombre en la tienda, para buscarlo. */
  store_name?: string;
  shop?: string;
  /** Contenido de un envase en `unit` (p. ej. 300 g de tofu, 1 = una unidad). */
  package: number;
  package_label?: string;
  unit: Unit;
  price?: number;
  storage: Storage;
  /** Dónde se compra: en el pedido (por defecto) o en la tienda cada semana, por ser fresco. */
  buy?: 'pedido' | 'tienda';
  notes?: string;
}

export interface Recipe {
  key: string;
  name: string;
  ingredients: { product: string; amount: number }[];
  kcal?: number;
  protein?: number;
  notes?: string;
}

export interface Meal {
  slot: string;
  time?: string;
  recipe: string;
  note?: string;
}

export interface MealDay {
  weekday: Weekday;
  kind?: 'pesas' | 'cardio' | 'descanso';
  meals: Meal[];
}

export interface CookSession {
  key: string;
  name: string;
  items: { recipe: string; servings: number; note?: string }[];
  notes?: string;
}

export interface MealsPlan {
  products: Product[];
  recipes: Recipe[];
  days: MealDay[];
  cooking?: CookSession[];
  /** Tienda principal del pedido (las demás se piden aparte). */
  shop?: string;
  min_order?: number;
  /** Días que cubre cada pedido y margen de seguridad. */
  cover_days?: number;
  buffer_days?: number;
  /** Cada cuántos días se compran en la tienda los productos con buy "tienda" (por defecto, 7). */
  store_every_days?: number;
  notes?: string[];
}

export interface PlanRow {
  id: string;
  kind: PlanKind;
  version: number;
  name: string;
  valid_from: string;
  content: unknown;
  status: 'active' | 'archived';
  source: string;
  created_at: string;
}

export interface WeekRow {
  week_start: string;
  telework: number[];
  away: number[];
  note: string;
}

// ---------------------------------------------------------------------------
// Validación (devuelve errores en español; lista vacía = válido)
// ---------------------------------------------------------------------------

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isDay = (x: unknown): x is Weekday => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 7;
const isRange = (x: unknown) => Array.isArray(x) && x.length === 2 && isNum(x[0]) && isNum(x[1]) && x[0] <= x[1];

function uniqueKeys(items: { key?: unknown; id?: unknown }[], prop: 'key' | 'id', where: string, errors: string[]) {
  const seen = new Set<unknown>();
  for (const it of items) {
    const k = it[prop];
    if (seen.has(k)) errors.push(`${where}: "${String(k)}" está repetido`);
    seen.add(k);
  }
}

export function validatePlan(kind: PlanKind, content: unknown): string[] {
  const e: string[] = [];
  if (!isObj(content)) return ['El contenido del plan debe ser un objeto'];
  if (kind === 'schedule') {
    const blocks = content.blocks;
    if (!Array.isArray(blocks)) return ['El horario necesita "blocks"'];
    blocks.forEach((b, i) => {
      const at = `Bloque ${i + 1}`;
      if (!isObj(b)) return e.push(`${at}: no es un objeto`);
      if (!isStr(b.id)) e.push(`${at}: falta id`);
      if (!isStr(b.title)) e.push(`${at}: falta el título`);
      if (!Array.isArray(b.days) || !b.days.length || !b.days.every(isDay)) e.push(`${at} (${String(b.title)}): días 1-7`);
      if (!isStr(b.start) || !TIME.test(b.start)) e.push(`${at} (${String(b.title)}): hora de inicio HH:MM`);
      if (b.end !== undefined && (!isStr(b.end) || !TIME.test(b.end) || b.end < String(b.start))) e.push(`${at} (${String(b.title)}): hora de fin HH:MM posterior al inicio`);
      if (b.on !== undefined && b.on !== 'oficina' && b.on !== 'teletrabajo') e.push(`${at}: "on" es oficina o teletrabajo`);
      if (b.first_telework_in !== undefined && !(Array.isArray(b.first_telework_in) && b.first_telework_in.every(isDay))) e.push(`${at}: first_telework_in son días 1-7`);
      if (b.link !== undefined) {
        const l = b.link as Record<string, unknown>;
        const ok = isObj(l) && (l.kind === 'training' || l.kind === 'shopping' || (l.kind === 'meal' && isStr(l.slot))
          || (l.kind === 'cook' && isStr(l.session)) || (l.kind === 'form' && isStr(l.area) && isStr(l.form)));
        if (!ok) e.push(`${at} (${String(b.title)}): enlace no válido`);
      }
    });
    uniqueKeys(blocks.filter(isObj), 'id', 'Bloques', e);
    if (content.default_telework !== undefined && !(Array.isArray(content.default_telework) && content.default_telework.every(isDay))) {
      e.push('default_telework son días 1-7');
    }
  } else if (kind === 'training') {
    const days = content.days;
    if (!Array.isArray(days)) return ['La rutina necesita "days"'];
    const allKeys: unknown[] = [];
    days.forEach((d, i) => {
      if (!isObj(d)) return e.push(`Día ${i + 1}: no es un objeto`);
      const at = isDay(d.weekday) ? WEEKDAY_NAME[d.weekday] : `Día ${i + 1}`;
      if (!isDay(d.weekday)) e.push(`${at}: weekday 1-7`);
      if (!isStr(d.name)) e.push(`${at}: falta el nombre`);
      if (!['pesas', 'cardio', 'descanso'].includes(String(d.kind))) e.push(`${at}: kind es pesas, cardio o descanso`);
      if (!Array.isArray(d.exercises)) return e.push(`${at}: faltan los ejercicios`);
      d.exercises.forEach((x, j) => {
        const ex = `${at}, ejercicio ${j + 1}`;
        if (!isObj(x)) return e.push(`${ex}: no es un objeto`);
        if (!isStr(x.key) || !KEY.test(x.key)) e.push(`${ex}: key en minúsculas_con_guiones_bajos`);
        if (!isStr(x.name)) e.push(`${ex}: falta el nombre`);
        if (!['compuesto', 'aislamiento', 'cardio', 'movilidad'].includes(String(x.type))) e.push(`${ex} (${String(x.name)}): tipo no válido`);
        if (x.type === 'compuesto' || x.type === 'aislamiento') {
          if (!Number.isInteger(x.sets) || (x.sets as number) < 1 || (x.sets as number) > 12) e.push(`${ex} (${String(x.name)}): series 1-12`);
          if (!isRange(x.reps)) e.push(`${ex} (${String(x.name)}): reps [mín, máx]`);
          if (x.rir !== undefined && !isRange(x.rir)) e.push(`${ex} (${String(x.name)}): rir [mín, máx]`);
          if (x.load !== undefined && !LOAD_KINDS.includes(x.load as LoadKind)) e.push(`${ex} (${String(x.name)}): tipo de carga no válido`);
        }
        if (x.rest_s !== undefined && !(isNum(x.rest_s) && x.rest_s >= 0 && x.rest_s <= 900)) e.push(`${ex}: descanso 0-900 s`);
        allKeys.push(x.key);
      });
      uniqueKeys((d.exercises as { key?: unknown }[]).filter(isObj), 'key', `${at}: ejercicios`, e);
    });
    const wd = days.filter(isObj).map((d) => d.weekday);
    if (new Set(wd).size !== wd.length) e.push('Hay dos sesiones el mismo día de la semana');
    if (content.gym !== undefined && !(isStr(content.gym) && KEY.test(content.gym))) e.push('gym: slug en minúsculas_con_guiones_bajos');
    if (content.gym_name !== undefined && !isStr(content.gym_name)) e.push('gym_name: texto');
    if (content.mode !== undefined && content.mode !== 'progresion' && content.mode !== 'mantenimiento') e.push('mode: progresion o mantenimiento');
  } else {
    const { products, recipes, days } = content;
    if (!Array.isArray(products) || !Array.isArray(recipes) || !Array.isArray(days)) return ['El menú necesita "products", "recipes" y "days"'];
    const pk = new Set<string>();
    products.forEach((p, i) => {
      const at = `Producto ${i + 1}`;
      if (!isObj(p)) return e.push(`${at}: no es un objeto`);
      if (!isStr(p.key) || !KEY.test(p.key)) e.push(`${at}: key en minúsculas_con_guiones_bajos`);
      if (!isStr(p.name)) e.push(`${at}: falta el nombre`);
      if (!isNum(p.package) || p.package <= 0) e.push(`${at} (${String(p.name)}): envase > 0`);
      if (!['g', 'ml', 'ud'].includes(String(p.unit))) e.push(`${at} (${String(p.name)}): unidad g, ml o ud`);
      if (!['nevera', 'congelador', 'despensa'].includes(String(p.storage))) e.push(`${at} (${String(p.name)}): nevera, congelador o despensa`);
      if (p.price !== undefined && !(isNum(p.price) && p.price >= 0)) e.push(`${at} (${String(p.name)}): precio ≥ 0`);
      if (p.buy !== undefined && p.buy !== 'pedido' && p.buy !== 'tienda') e.push(`${at} (${String(p.name)}): buy "pedido" o "tienda"`);
      pk.add(String(p.key));
    });
    uniqueKeys(products.filter(isObj), 'key', 'Productos', e);
    const rk = new Set<string>();
    recipes.forEach((r, i) => {
      const at = `Receta ${i + 1}`;
      if (!isObj(r)) return e.push(`${at}: no es un objeto`);
      if (!isStr(r.key)) e.push(`${at}: falta key`);
      if (!isStr(r.name)) e.push(`${at}: falta el nombre`);
      if (!Array.isArray(r.ingredients)) return e.push(`${at} (${String(r.name)}): faltan los ingredientes`);
      for (const g of r.ingredients) {
        if (!isObj(g) || !pk.has(String(g.product))) e.push(`${at} (${String(r.name)}): producto "${isObj(g) ? String(g.product) : '?'}" no existe`);
        else if (!isNum(g.amount) || g.amount <= 0) e.push(`${at} (${String(r.name)}): cantidad de ${String(g.product)} > 0`);
      }
      rk.add(String(r.key));
    });
    uniqueKeys(recipes.filter(isObj), 'key', 'Recetas', e);
    days.forEach((d, i) => {
      if (!isObj(d)) return e.push(`Día ${i + 1}: no es un objeto`);
      const at = isDay(d.weekday) ? WEEKDAY_NAME[d.weekday] : `Día ${i + 1}`;
      if (!isDay(d.weekday)) e.push(`${at}: weekday 1-7`);
      if (!Array.isArray(d.meals)) return e.push(`${at}: faltan las comidas`);
      for (const m of d.meals) {
        if (!isObj(m) || !isStr(m.slot)) e.push(`${at}: comida sin "slot"`);
        else if (!rk.has(String(m.recipe))) e.push(`${at}, ${m.slot}: receta "${String(m.recipe)}" no existe`);
        else if (m.time !== undefined && !(isStr(m.time) && TIME.test(m.time))) e.push(`${at}, ${m.slot}: hora HH:MM`);
      }
    });
    if (Array.isArray(content.cooking)) {
      content.cooking.forEach((c, i) => {
        if (!isObj(c) || !isStr(c.key) || !isStr(c.name) || !Array.isArray(c.items)) return e.push(`Sesión de cocina ${i + 1}: key, nombre e items`);
        for (const it of c.items) {
          if (!isObj(it) || !rk.has(String(it.recipe))) e.push(`${String(c.name)}: receta "${isObj(it) ? String(it.recipe) : '?'}" no existe`);
          else if (!Number.isInteger(it.servings) || (it.servings as number) < 1) e.push(`${String(c.name)}: raciones ≥ 1`);
        }
      });
      uniqueKeys(content.cooking.filter(isObj), 'key', 'Sesiones de cocina', e);
    }
    for (const k of ['min_order', 'cover_days', 'buffer_days'] as const) {
      if (content[k] !== undefined && !(isNum(content[k]) && (content[k] as number) >= 0)) e.push(`${k} ≥ 0`);
    }
    if (content.store_every_days !== undefined && !(Number.isInteger(content.store_every_days) && (content.store_every_days as number) >= 1)) e.push('store_every_days: días ≥ 1');
  }
  return e;
}

/** Archivo de importación: un plan o varios ({ lifeos_plans: [...] }). */
export interface PlanFileItem {
  kind: PlanKind;
  name: string;
  valid_from: string;
  content: unknown;
}

export function parsePlanFile(json: unknown): { plans: PlanFileItem[]; errors: string[] } {
  const raw = isObj(json) && Array.isArray(json.lifeos_plans) ? json.lifeos_plans : [json];
  const plans: PlanFileItem[] = [];
  const errors: string[] = [];
  raw.forEach((p, i) => {
    const at = raw.length > 1 ? `Plan ${i + 1}: ` : '';
    if (!isObj(p) || !['schedule', 'training', 'meals'].includes(String(p.kind))) return errors.push(`${at}kind debe ser schedule, training o meals`);
    if (!isStr(p.name)) return errors.push(`${at}falta el nombre`);
    if (!isStr(p.valid_from) || !/^\d{4}-\d{2}-\d{2}$/.test(p.valid_from)) return errors.push(`${at}valid_from YYYY-MM-DD`);
    const errs = validatePlan(p.kind as PlanKind, p.content);
    if (errs.length) return errors.push(...errs.map((x) => `${at}${p.name}: ${x}`));
    plans.push({ kind: p.kind as PlanKind, name: p.name, valid_from: p.valid_from, content: p.content });
  });
  return { plans, errors };
}

/** Resumen de un plan en una línea por elemento, para revisarlo antes de guardarlo o aprobarlo. */
export function planSummary(kind: PlanKind, content: unknown): string[] {
  if (!isObj(content)) return [];
  if (kind === 'training') {
    const days = (Array.isArray(content.days) ? content.days : []) as TrainingDay[];
    const t = content as unknown as TrainingPlan;
    const head = t.gym || t.mode ? [`Gimnasio: ${gymLabel(gymOf(t), t)}${trainingMode(t) === 'mantenimiento' ? ' · mantenimiento (sin subir cargas ni escalones)' : ''}`] : [];
    return [...head, ...[...days].sort((a, b) => a.weekday - b.weekday).map((d) => {
      const lifts = (d.exercises ?? []).filter((x) => x.type === 'compuesto' || x.type === 'aislamiento');
      const sets = lifts.reduce((a, x) => a + (x.sets ?? 0), 0);
      return `${WEEKDAY_NAME[d.weekday]}: ${d.name}${lifts.length ? ` · ${lifts.length} ${lifts.length === 1 ? 'ejercicio' : 'ejercicios'}, ${sets} series` : ''}`;
    })];
  }
  if (kind === 'meals') {
    const m = content as unknown as MealsPlan;
    return [
      `${m.products?.length ?? 0} productos, ${m.recipes?.length ?? 0} recetas, ${m.days?.length ?? 0} días de menú`,
      ...(m.cooking ?? []).map((c) => `Cocina: ${c.name} (${c.items.map((i) => `${m.recipes.find((r) => r.key === i.recipe)?.name ?? i.recipe} × ${i.servings}`).join(', ')})`),
      `Pedido: cada ${m.cover_days ?? 14} días + ${m.buffer_days ?? 2} de margen${m.min_order ? `, mínimo ${m.min_order}` : ''}`,
      ...(() => {
        const fresh = (m.products ?? []).filter((p) => p.buy === 'tienda');
        return fresh.length ? [`En tienda cada ${m.store_every_days ?? 7} días: ${fresh.map((p) => p.name).join(', ')}`] : [];
      })(),
    ];
  }
  const blocks = (Array.isArray(content.blocks) ? content.blocks : []) as ScheduleBlock[];
  return [`${blocks.length} bloques`, ...blocks.slice(0, 40).map((b) => `${b.start}${b.end ? `-${b.end}` : ''} ${b.title} (${b.days.length === 7 ? 'todos los días' : b.days.map((d) => WEEKDAY_SHORT[d]).join('')}${b.on ? `, ${b.on}` : ''})`)];
}

// ---------------------------------------------------------------------------
// Qué plan rige un día
// ---------------------------------------------------------------------------

export function isoWeekday(date: string): Weekday {
  return (((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1) as Weekday;
}

/**
 * El plan vigente en `date`: activo, con la fecha de inicio más reciente que no pase de `date`
 * (y, a igual fecha, la versión más alta). Si aún no rige ninguno, el próximo como vista previa.
 * Las rutinas van por gimnasio: sin `gym`, la del gimnasio de casa.
 */
export function planFor<T>(plans: PlanRow[], kind: PlanKind, date: string, gym: string = HOME_GYM): { row: PlanRow; content: T; preview: boolean } | null {
  const own = plans.filter((p) => p.kind === kind && p.status === 'active' && (kind !== 'training' || gymOf(p.content) === gym));
  const current = own.filter((p) => p.valid_from <= date)
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from) || b.version - a.version)[0];
  if (current) return { row: current, content: current.content as T, preview: false };
  const next = own.filter((p) => p.valid_from > date)
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from) || b.version - a.version)[0];
  return next ? { row: next, content: next.content as T, preview: true } : null;
}

/** Gimnasios con rutina activa (el de casa primero), cada uno con su plan vigente o próximo en `date`. */
export function trainingGyms(plans: PlanRow[], date: string): { gym: string; label: string; mode: TrainingMode; plan: { row: PlanRow; content: TrainingPlan; preview: boolean } }[] {
  const gyms = [...new Set(plans.filter((p) => p.kind === 'training' && p.status === 'active').map((p) => gymOf(p.content)))]
    .sort((a, b) => (a === HOME_GYM ? -1 : b === HOME_GYM ? 1 : a.localeCompare(b)));
  return gyms.flatMap((gym) => {
    const plan = planFor<TrainingPlan>(plans, 'training', date, gym);
    return plan ? [{ gym, label: gymLabel(gym, plan.content), mode: trainingMode(plan.content), plan }] : [];
  });
}

/** Días de teletrabajo y fuera de casa de la semana de `date`. */
export function weekSettings(weeks: WeekRow[], schedule: SchedulePlan | null, date: string): { telework: Weekday[]; away: Weekday[]; chosen: boolean } {
  const ws = weekStart(date);
  const row = weeks.find((w) => w.week_start === ws);
  if (row) return { telework: row.telework.filter(isDay) as Weekday[], away: row.away.filter(isDay) as Weekday[], chosen: true };
  return { telework: schedule?.default_telework ?? [], away: [], chosen: false };
}

/** Fechas de la semana marcadas "fuera de casa" en un rango (no consumen del menú de casa). */
export function awayDates(weeks: WeekRow[], from: string, to: string): Set<string> {
  const out = new Set<string>();
  for (const w of weeks) {
    for (const d of w.away) {
      const date = addDays(w.week_start, d - 1);
      if (date >= from && date <= to) out.add(date);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agenda de un día
// ---------------------------------------------------------------------------

export interface AgendaItem {
  id: string;
  start: string;
  end?: string;
  title: string;
  detail?: string;
  icon?: string;
  link?: BlockLink;
  training?: TrainingDay;
  meal?: { meal: Meal; recipe: Recipe };
  cook?: { session: CookSession; recipes: { recipe: Recipe; servings: number; note?: string }[] };
  /** Pedido que llega ese día (no está en el horario: sale de los pedidos). */
  delivery?: { orderId: string; items: number };
}

export interface AgendaInput {
  date: string;
  schedule: SchedulePlan | null;
  training: TrainingPlan | null;
  meals: MealsPlan | null;
  weeks: WeekRow[];
  deliveries?: { id: string; delivery_date: string; items: unknown[]; status: string }[];
}

export function agendaFor(i: AgendaInput): { items: AgendaItem[]; telework: boolean; away: boolean; training: TrainingDay | null; meals: MealDay | null } {
  const wd = isoWeekday(i.date);
  const ws = weekSettings(i.weeks, i.schedule, i.date);
  const telework = ws.telework.includes(wd);
  const away = ws.away.includes(wd);
  const training = i.training?.days.find((d) => d.weekday === wd) ?? null;
  const mealsDay = i.meals?.days.find((d) => d.weekday === wd) ?? null;
  const recipe = (k: string) => i.meals?.recipes.find((r) => r.key === k);

  const items: AgendaItem[] = [];
  for (const b of i.schedule?.blocks ?? []) {
    if (!b.days.includes(wd)) continue;
    if (b.on === 'teletrabajo' && !telework) continue;
    if (b.on === 'oficina' && telework) continue;
    if (b.first_telework_in) {
      const first = [...ws.telework].sort().find((d) => b.first_telework_in!.includes(d));
      if (first !== wd) continue;
    }
    const it: AgendaItem = { id: b.id, start: b.start, end: b.end, title: b.title, detail: b.detail, icon: b.icon, link: b.link };
    if (b.link?.kind === 'training' && training) it.training = training;
    if (b.link?.kind === 'meal' && mealsDay) {
      const slot = b.link.slot;
      const m = mealsDay.meals.find((x) => x.slot === slot);
      const r = m && recipe(m.recipe);
      if (m && r) it.meal = { meal: m, recipe: r };
    }
    if (b.link?.kind === 'cook') {
      const key = b.link.session;
      const s = i.meals?.cooking?.find((c) => c.key === key);
      if (s) {
        it.cook = {
          session: s,
          recipes: s.items.map((x) => ({ recipe: recipe(x.recipe)!, servings: x.servings, note: x.note })).filter((x) => x.recipe),
        };
      }
    }
    items.push(it);
  }
  for (const o of i.deliveries ?? []) {
    if (o.status === 'ordered' && o.delivery_date === i.date) {
      items.push({ id: `pedido-${o.id}`, start: '09:00', title: 'Recibir el pedido', icon: '📦', link: { kind: 'shopping' }, delivery: { orderId: o.id, items: o.items.length } });
    }
  }
  items.sort((a, b) => a.start.localeCompare(b.start) || (a.end ?? '').localeCompare(b.end ?? ''));
  return { items, telework, away, training, meals: mealsDay };
}

/** Lo que toca ahora y lo siguiente, con la hora local "HH:MM". */
export function nowAndNext(items: AgendaItem[], time: string): { now: AgendaItem | null; next: AgendaItem | null } {
  let now: AgendaItem | null = null;
  for (const it of items) {
    if (it.start > time) break;
    if (!it.end || it.end > time) now = it;
  }
  const next = items.find((it) => it.start > time) ?? null;
  return { now, next };
}

/** Hora local HH:MM de un instante. */
export function localTime(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}
