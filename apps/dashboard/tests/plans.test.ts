import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Entry } from '@shared/model.ts';
import {
  agendaFor, gymForDate, gymOf, isoWeekday, nowAndNext, parsePlanFile, planFor, planSummary, trainingGyms, validatePlan,
  type MealsPlan, type PlanRow, type SchedulePlan, type TrainingPlan,
} from '@shared/plans.ts';
import { exposuresFor, machineChanged, readiness, setsToday, suggest, type Exposure } from '@shared/progression.ts';
import { estimateStock, shoppingList, storeList, useBetween, type StockMove } from '@shared/shopping.ts';

const file = JSON.parse(readFileSync(new URL('../e2e/fixtures/planes-prueba.json', import.meta.url), 'utf8'));
const parsed = parsePlanFile(file);
const content = <T,>(kind: string) => parsed.plans.find((p) => p.kind === kind)!.content as T;
const schedule = content<SchedulePlan>('schedule');
const training = content<TrainingPlan>('training');
const meals = content<MealsPlan>('meals');

describe('validación de planes', () => {
  it('el archivo de prueba es válido', () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.plans.map((p) => p.kind)).toEqual(['schedule', 'training', 'meals']);
  });

  it('señala referencias rotas y formatos', () => {
    expect(validatePlan('meals', { ...meals, days: [{ weekday: 1, meals: [{ slot: 'cena', recipe: 'nada' }] }] }))
      .toContain('Lunes, cena: receta "nada" no existe');
    expect(validatePlan('schedule', { blocks: [{ id: 'a', days: [8], start: '25:00', title: 'X' }] }))
      .toEqual(['Bloque 1 (X): días 1-7', 'Bloque 1 (X): hora de inicio HH:MM']);
    expect(validatePlan('training', { days: [{ weekday: 1, name: 'A', kind: 'pesas', exercises: [{ key: 'Mal', name: 'x', type: 'compuesto', sets: 2, reps: [10, 6] }] }] }))
      .toEqual(['Lunes, ejercicio 1: key en minúsculas_con_guiones_bajos', 'Lunes, ejercicio 1 (x): reps [mín, máx]']);
    expect(parsePlanFile({ kind: 'otro' }).errors).toEqual(['kind debe ser schedule, training o meals']);
  });
});

describe('qué plan rige', () => {
  const row = (version: number, valid_from: string, status: 'active' | 'archived' = 'active'): PlanRow =>
    ({ id: String(version), kind: 'training', version, name: `v${version}`, valid_from, content: {}, status, source: 'dashboard', created_at: '' });
  const rows = [row(1, '2027-01-11'), row(2, '2027-02-01'), row(3, '2027-02-01', 'archived')];

  it('vigente, vista previa y nada', () => {
    expect(planFor(rows, 'training', '2027-01-20')).toMatchObject({ row: { version: 1 }, preview: false });
    expect(planFor(rows, 'training', '2027-03-01')).toMatchObject({ row: { version: 2 }, preview: false });
    expect(planFor(rows, 'training', '2026-12-01')).toMatchObject({ row: { version: 1 }, preview: true });
    expect(planFor(rows, 'meals', '2027-01-20')).toBeNull();
  });
});

describe('varios gimnasios', () => {
  const trow = (version: number, valid_from: string, content: object): PlanRow =>
    ({ id: String(version), kind: 'training', version, name: `v${version}`, valid_from, content, status: 'active', source: 'dashboard', created_at: '' });
  const viaje: TrainingPlan = { ...training, gym: 'la_zona', gym_name: 'La Zona', mode: 'mantenimiento',
    days: training.days.map((d) => ({ ...d, name: `${d.name} (viaje)`, exercises: d.exercises.map((x) => ({ ...x, key: `es_${x.key}` })) })) };
  const rows = [trow(1, '2027-01-11', training), trow(2, '2027-01-11', viaje)];

  it('cada gimnasio tiene su plan vigente: el de viaje no sustituye al de casa', () => {
    expect(gymOf(training)).toBe('elevate');
    expect(planFor(rows, 'training', '2027-01-20')).toMatchObject({ row: { version: 1 } });
    expect(planFor(rows, 'training', '2027-01-20', 'la_zona')).toMatchObject({ row: { version: 2 } });
    expect(planFor(rows, 'training', '2027-01-20', 'otro')).toBeNull();
    expect(trainingGyms(rows, '2027-01-20').map((g) => [g.gym, g.label, g.mode])).toEqual([['elevate', 'Elevate', 'progresion'], ['la_zona', 'La Zona', 'mantenimiento']]);
  });

  it('valida gym y mode, y el resumen los muestra', () => {
    expect(validatePlan('training', viaje)).toEqual([]);
    expect(validatePlan('training', { ...viaje, gym: 'La Zona', mode: 'suave' })).toEqual(['gym: slug en minúsculas_con_guiones_bajos', 'mode: progresion o mantenimiento']);
    expect(planSummary('training', viaje)[0]).toBe('Gimnasio: La Zona · mantenimiento (sin subir cargas ni escalones)');
    expect(planSummary('training', training)[0]).not.toContain('Gimnasio');
  });

  it('el gimnasio de un día sale de los periodos', () => {
    const periods = [{ id: 'p', gym: 'la_zona', date_from: '2027-01-22', date_to: '2027-01-25', note: '' }];
    expect(gymForDate(periods, '2027-01-21')).toBe('elevate');
    expect(gymForDate(periods, '2027-01-22')).toBe('la_zona');
    expect(gymForDate(periods, '2027-01-25')).toBe('la_zona');
    expect(gymForDate(periods, '2027-01-26')).toBe('elevate');
  });
});

describe('agenda del día', () => {
  const base = { schedule, training, meals, weeks: [] };

  it('lunes de oficina: bus, comida con su receta, entreno del día', () => {
    expect(isoWeekday('2027-01-11')).toBe(1);
    const a = agendaFor({ ...base, date: '2027-01-11' });
    expect(a.telework).toBe(false);
    expect(a.items.map((i) => i.id)).toEqual(['despertar', 'gym', 'bus-oficina', 'comida', 'cena', 'cama']);
    expect(a.items[1].training?.name).toBe('Torso');
    expect(a.items[3].meal?.recipe.name).toBe('Pasta con tomate');
  });

  it('teletrabajo elegido para la semana: la cocina corta va el primero de X/J', () => {
    const weeks = [{ week_start: '2027-01-11', telework: [4, 5], away: [], note: '' }];
    const x = agendaFor({ ...base, weeks, date: '2027-01-13' });
    const j = agendaFor({ ...base, weeks, date: '2027-01-14' });
    expect(x.items.some((i) => i.id === 'cocina-corta')).toBe(false);
    expect(j.items.find((i) => i.id === 'cocina-corta')?.cook?.recipes[0]).toMatchObject({ servings: 2, recipe: { key: 'p1' } });
    expect(j.items.some((i) => i.id === 'casa')).toBe(false);
  });

  it('el pedido aparece el día de la entrega', () => {
    const a = agendaFor({ ...base, date: '2027-01-14', deliveries: [{ id: 'o1', delivery_date: '2027-01-14', items: [1, 2], status: 'ordered' }] });
    expect(a.items.find((i) => i.delivery)?.delivery).toEqual({ orderId: 'o1', items: 2 });
  });

  it('ahora y después', () => {
    const { items } = agendaFor({ ...base, date: '2027-01-11' });
    expect(nowAndNext(items, '07:30')).toMatchObject({ now: { id: 'gym' }, next: { id: 'bus-oficina' } });
    expect(nowAndNext(items, '10:00')).toMatchObject({ now: { id: 'despertar' }, next: { id: 'comida' } });
    expect(nowAndNext(items, '05:00')).toMatchObject({ now: null, next: { id: 'despertar' } });
  });
});

describe('progresión', () => {
  const press = training.days[0].exercises[0];
  const exp = (date: string, kg: number, reps: number[], rir = 2, molestia = 0): Exposure =>
    ({ date, sets: reps.map((r) => ({ kg, reps: r, rir, molestia })) });

  it('primera vez: calibrar', () => {
    expect(suggest(press, [], 'normal').action).toBe('calibrar');
  });

  it('dos exposiciones en el techo con el RIR: sube con el escalón de discos', () => {
    const s = suggest(press, [exp('2027-01-18', 40, [10, 10]), exp('2027-01-14', 40, [10, 10])], 'normal');
    expect(s).toMatchObject({ action: 'subir', kg: 41.5 });
  });

  it('una sola vez en el techo: repite; atajo con +2 reps sobre el techo: sube', () => {
    expect(suggest(press, [exp('2027-01-18', 40, [10, 10]), exp('2027-01-14', 40, [10, 9])], 'normal').action).toBe('repetir');
    expect(suggest(press, [exp('2027-01-18', 40, [12, 12])], 'normal').action).toBe('subir');
  });

  it('objetivo: +1 rep en la primera serie que no llegó', () => {
    const s = suggest(press, [exp('2027-01-18', 40, [10, 8])], 'normal');
    expect(s.why).toContain('+1 rep en la serie 2 (9)');
  });

  it('RIR por debajo del objetivo no cuenta para subir', () => {
    expect(suggest(press, [exp('2027-01-18', 40, [10, 10], 0), exp('2027-01-14', 40, [10, 10], 0)], 'normal').action).toBe('repetir');
  });

  it('cuestionario bajo: no sube; molestia ámbar y roja', () => {
    const up = [exp('2027-01-18', 40, [12, 12])];
    expect(suggest(press, up, 'baja').action).toBe('mantener');
    expect(suggest(press, [exp('2027-01-18', 40, [10, 10], 2, 3)], 'normal')).toMatchObject({ action: 'revisar', kg: 34 });
    expect(suggest(press, [exp('2027-01-18', 40, [10, 10], 2, 6)], 'normal').action).toBe('parar');
  });

  it('mantenimiento: repite la última carga sin subir; primera vez, calibra con RIR 3', () => {
    expect(suggest(press, [exp('2027-01-18', 40, [12, 12])], 'normal', 'mantenimiento')).toMatchObject({ action: 'mantener', kg: 40, title: 'Mantén 40 kg' });
    expect(suggest(press, [], 'normal', 'mantenimiento')).toMatchObject({ action: 'calibrar', title: 'Primera vez aquí: calibra con RIR 3' });
    expect(suggest(press, [exp('2027-01-18', 40, [10, 10], 2, 6)], 'normal', 'mantenimiento').action).toBe('parar');
  });

  it('avisa si la máquina no es la de la última vez', () => {
    const last: Exposure = { date: '2027-01-18', sets: [], machine: 'Prensa Hammer' };
    expect(machineChanged('prensa  hammer', last)).toBe(false);
    expect(machineChanged('Prensa de 45°', last)).toBe(true);
    expect(machineChanged('', last)).toBe(false);
    expect(machineChanged('Prensa de 45°', { date: '2027-01-18', sets: [] })).toBe(false);
  });

  it('lectura del cuestionario y series de la sesión mínima', () => {
    expect(readiness([4, 4, 4, 4, 4], 4).level).toBe('normal');
    expect(readiness([2, 2, 4, 4, 4], 4).level).toBe('baja');
    expect(readiness([2, 2, 2, 4, 4], 4).level).toBe('minima');
    expect(readiness([3, 3, 1, 4, 4], 1).level).toBe('minima');
    expect(readiness([null, 3, 3, 3, 3], 3).level).toBe('normal');
    const crunch = training.days[0].exercises[1];
    expect(setsToday({ ...press, sets: 3 }, 'minima', false)).toBe(2);
    expect(setsToday(press, 'minima', true)).toBe(2);
    expect(setsToday(press, 'minima', false)).toBe(1);
    expect(setsToday(crunch, 'minima', false)).toBe(2);
  });

  it('lee las exposiciones por línea (o por nombre en registros antiguos)', () => {
    const e = (date: string, series: unknown[]): Entry => ({ id: date, form_id: 'f', area_id: 'a', occurred_at: `${date}T07:00:00Z`, local_date: date,
      data: { series }, note: '', source: 'dashboard', quality: 'manual', supersedes_id: null, actor: 'owner', created_at: '' });
    const sessions = [
      e('2027-01-11', [{ ejercicio: 'Press de pecho', carga_kg: 38, reps: 9, rir: 2 }]),
      e('2027-01-14', [{ ejercicio: 'Otro nombre', linea: 'press_pecho', maquina: ' Panatta ', carga_kg: 40, reps: 10, rir: 2, molestia: 1 }, { ejercicio: 'Crunch', linea: 'crunch', reps: 12 }]),
    ];
    expect(exposuresFor(press, sessions)).toEqual([
      { date: '2027-01-14', sets: [{ kg: 40, reps: 10, rir: 2, molestia: 1 }], machine: 'Panatta' },
      { date: '2027-01-11', sets: [{ kg: 38, reps: 9, rir: 2, molestia: null }] },
    ]);
  });
});

describe('despensa y compra', () => {
  const move = (product: string, kind: StockMove['kind'], qty: number, local_date: string): StockMove =>
    ({ product, kind, qty, local_date, occurred_at: `${local_date}T18:00:00Z` });

  it('consumo del menú por días, saltando los días fuera', () => {
    expect(useBetween(meals, '2027-01-11', '2027-01-13').get('pasta')).toBe(600);
    expect(useBetween(meals, '2027-01-11', '2027-01-13', new Set(['2027-01-12'])).get('pasta')).toBe(400);
  });

  it('stock estimado: recuento + compras − consumo desde el día siguiente', () => {
    const stock = estimateStock(meals, [move('pasta', 'count', 1000, '2027-01-10'), move('pasta', 'purchase', 500, '2027-01-11')], '2027-01-12');
    const pasta = stock.find((s) => s.product.key === 'pasta')!;
    expect(pasta).toMatchObject({ qty: 1500 - 400, counted: '2027-01-10', perDay: 200 });
    expect(pasta.daysLeft).toBeCloseTo(5.5);
    expect(stock.find((s) => s.product.key === 'tomate')).toMatchObject({ qty: null, counted: null });
  });

  it('lista: lo que falta hasta el siguiente pedido, en envases, y la otra tienda aparte', () => {
    // Todo por pedido (el archivo de prueba compra el yogur en tienda; eso se prueba abajo).
    const all: MealsPlan = { ...meals, products: meals.products.map(({ buy: _buy, ...p }) => p) };
    const stock = estimateStock(all, [move('pasta', 'count', 1000, '2027-01-11'), move('yogur', 'count', 1000, '2027-01-11')], '2027-01-11');
    // Entrega el jueves 14: cubre 7 días + 1 de margen (14-21). Martes y miércoles se gastan 400 g de pasta.
    const list = shoppingList(all, stock, '2027-01-11', '2027-01-14');
    const by = (k: string) => list.lines.find((l) => l.product.key === k)!;
    expect(list.until).toBe('2027-01-21');
    expect(by('pasta')).toMatchObject({ need: 1600, atDelivery: 600, missing: 1000, packages: 2, cost: 3 });
    expect(by('yogur')).toMatchObject({ atDelivery: 750, missing: 250, packages: 2 });
    expect(by('tomate')).toMatchObject({ unknown: true, packages: 4 });
    expect(list.other.map((l) => l.product.key)).toEqual(['proteina']);
    expect(by('verdura')).toMatchObject({ unknown: true, packages: 3 });
    expect(list.total).toBe(3 + 1 + 4 + 9);
  });

  it('frescos en tienda: fuera del pedido y en su propia lista semanal', () => {
    const fresh = meals;
    expect(fresh.products.filter((p) => p.buy === 'tienda').map((p) => p.key)).toEqual(['yogur']);
    expect(validatePlan('meals', fresh)).toEqual([]);
    expect(validatePlan('meals', { ...fresh, store_every_days: 0 })).toContain('store_every_days: días ≥ 1');
    expect(validatePlan('meals', { ...fresh, products: [{ ...fresh.products[0], buy: 'super' }] })).toContain(`Producto 1 (${fresh.products[0].name}): buy "pedido" o "tienda"`);
    const stock = estimateStock(fresh, [move('pasta', 'count', 1000, '2027-01-11'), move('yogur', 'count', 1000, '2027-01-11')], '2027-01-11');
    const order = shoppingList(fresh, stock, '2027-01-11', '2027-01-14');
    expect(order.lines.map((l) => l.product.key)).not.toContain('yogur');
    expect(order.total).toBe(3 + 4 + 9);
    // Compra en tienda el sábado 16: cubre del 16 al 22; hasta el viernes se gastan 125 g al día (12-15).
    const shop = storeList(fresh, stock, '2027-01-11', '2027-01-16');
    expect(shop.until).toBe('2027-01-22');
    expect(shop.lines.map((l) => l.product.key)).toEqual(['yogur']);
    expect(shop.lines[0]).toMatchObject({ need: 875, atDelivery: 500, missing: 375 });
    // Compra hoy: cubre también lo de hoy, así que se cuenta lo que había al empezar el día (1000 + 125 de hoy).
    expect(storeList(fresh, stock, '2027-01-11', '2027-01-11').lines[0]).toMatchObject({ need: 875, atDelivery: 1125, missing: 0 });
  });
});
