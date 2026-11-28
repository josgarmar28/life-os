import { describe, expect, it } from 'vitest';
import type { Area, Entry, Field, Form } from '@shared/model.ts';
import { readFileSync } from 'node:fs';
import { handleBody, handleMessage, TOOLS, type Api, type OrderRow } from '../../../supabase/functions/mcp/handler.ts';
import type { TripRow } from '@shared/trip.ts';
import { parsePlanFile, type GymPeriod, type PlanRow, type WeekRow } from '@shared/plans.ts';

const planFile = parsePlanFile(JSON.parse(readFileSync(new URL('../e2e/fixtures/planes-prueba.json', import.meta.url), 'utf8')));
const planRows: PlanRow[] = planFile.plans.map((p, i) => ({ id: `p${i}`, kind: p.kind, version: 1, name: p.name, valid_from: p.valid_from, content: p.content as Record<string, unknown>,
  status: 'active', source: 'import', created_at: '' }));

const area: Area = { id: 'a1', slug: 'cuerpo', name: 'Cuerpo', description: '', icon: '📏', sort_order: 1, status: 'active', created_at: '', updated_at: '', archived_at: null };
const archivedArea: Area = { ...area, id: 'a2', slug: 'viejo', name: 'Viejo', status: 'archived' };
const form: Form = { id: 'fm1', area_id: 'a1', slug: 'peso', name: 'Peso', description: '', cadence: 'daily', sort_order: 1, status: 'active', created_at: '', updated_at: '', archived_at: null };
const peso: Field = { id: 'fd1', form_id: 'fm1', key: 'peso', label: 'Peso', help: '', type: 'number', unit: 'kg', min: 20, max: 400, step: 0.1,
  options: [], columns: [], required: true, on_overview: true, sort_order: 1, status: 'active' };
const e = (d: string, v: number): Entry => ({ id: `e-${d}`, form_id: 'fm1', area_id: 'a1', occurred_at: `${d}T06:00:00Z`, local_date: d, data: { peso: v },
  note: '', source: 'dashboard', quality: 'manual', supersedes_id: null, actor: 'owner', created_at: '' });

interface Extra { plans?: PlanRow[]; weeks?: WeekRow[]; periods?: GymPeriod[]; trips?: TripRow[]; moves?: { product: string; kind: 'count' | 'purchase' | 'adjust'; qty: number; occurred_at: string }[]; orders?: OrderRow[] }
function fakeApi(entries: Entry[] = [], extra: Extra = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const api: Api = {
    areas: async () => [area, archivedArea],
    forms: async () => [form],
    fields: async () => [peso],
    entries: async (q) => entries.filter((x) => (!q.ids || q.ids.includes(x.id)) && (!q.formIds || q.formIds.includes(x.form_id))
      && (!q.from || x.local_date >= q.from) && (!q.to || x.local_date <= q.to)).slice(0, q.limit),
    proposals: async () => [],
    plans: async () => extra.plans ?? [],
    weeks: async () => extra.weeks ?? [],
    gymPeriods: async () => extra.periods ?? [],
    trips: async () => extra.trips ?? [],
    stockMoves: async () => extra.moves ?? [],
    orders: async () => extra.orders ?? [],
    rpc: async <T,>(fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === 'add_entry' && (args.p_values as Record<string, unknown>).peso === 999) throw new Error('Peso: 999 is outside [20, 400]');
      if (fn === 'create_proposal') return 'prop-1' as T;
      return 'new-id' as T;
    },
    timezone: async () => 'Europe/Zurich',
  };
  return { api, calls };
}

const ctx = (api: Api) => ({ api, now: new Date('2027-01-12T07:00:00Z'), newId: () => '00000000-0000-4000-8000-000000000001' });
const call = async (api: Api, name: string, args: Record<string, unknown> = {}) => {
  const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx(api));
  return r!.result as { content: { text: string }[]; isError: boolean; structuredContent?: unknown };
};

describe('protocolo MCP', () => {
  it('initialize negocia versión y anuncia herramientas', async () => {
    const { api } = fakeApi();
    const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, ctx(api));
    expect((r!.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
    const r2 = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, ctx(api));
    expect((r2!.result as { protocolVersion: string }).protocolVersion).toBe('2025-11-25');
  });
  it('las notificaciones no tienen respuesta y los métodos desconocidos dan error', async () => {
    const { api } = fakeApi();
    expect(await handleBody({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx(api))).toBeNull();
    const r = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'nope' }, ctx(api));
    expect(r!.error!.code).toBe(-32601);
  });
  it('tools/list expone las herramientas con esquema y anotaciones', async () => {
    const { api } = fakeApi();
    const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx(api));
    const tools = (r!.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(tools.find((t) => t.name === 'lifeos_overview')!.annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'lifeos_add_entry')!.annotations.readOnlyHint).toBe(false);
  });
});

describe('herramientas', () => {
  it('estructura oculta lo archivado por defecto', async () => {
    const { api } = fakeApi();
    const r = await call(api, 'lifeos_structure');
    const areas = JSON.parse(r.content[0].text);
    expect(areas.map((a: { area: string }) => a.area)).toEqual(['cuerpo']);
    expect(areas[0].forms[0].fields[0]).toMatchObject({ key: 'peso', type: 'number', unit: 'kg', min: 20, max: 400, required: true });
  });
  it('vista general calcula en la zona horaria del dueño', async () => {
    const { api } = fakeApi([e('2027-01-05', 75), e('2027-01-11', 73.6), e('2027-01-12', 73.8)]);
    const r = JSON.parse((await call(api, 'lifeos_overview')).content[0].text);
    expect(r.date).toBe('2027-01-12');
    const ind = r.areas[0].forms[0].indicators[0];
    expect(ind.last).toEqual({ date: '2027-01-12', value: 73.8 });
    expect(ind.avg7).toBe(73.7);
    expect(r.areas[0].forms[0].done).toBe(true);
  });
  it('registrar pasa por la RPC con request_id y calidad manual por defecto', async () => {
    const { api, calls } = fakeApi();
    const r = await call(api, 'lifeos_add_entry', { area: 'cuerpo', form: 'peso', data: { peso: 73.5 } });
    expect(r.isError).toBe(false);
    expect(calls[0]).toEqual({ fn: 'add_entry', args: expect.objectContaining({ p_form_id: 'fm1', p_values: { peso: 73.5 }, p_quality: 'manual', p_request_id: '00000000-0000-4000-8000-000000000001' }) });
  });
  it('los errores de la BD vuelven como error de herramienta legible', async () => {
    const { api } = fakeApi();
    const r = await call(api, 'lifeos_add_entry', { area: 'cuerpo', form: 'peso', data: { peso: 999 } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('outside');
  });
  it('formulario inexistente y argumentos inválidos se rechazan sin llamar a la BD', async () => {
    const { api, calls } = fakeApi();
    expect((await call(api, 'lifeos_add_entry', { area: 'cuerpo', form: 'nada', data: {} })).isError).toBe(true);
    expect((await call(api, 'lifeos_add_entry', { area: 'cuerpo', form: 'peso', data: { peso: 1 }, request_id: 'no-uuid' })).isError).toBe(true);
    expect((await call(api, 'lifeos_entries', { form: 'peso' })).isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it('corregir usa la versión vigente y conserva su fecha', async () => {
    const { api, calls } = fakeApi([e('2027-01-11', 73.6)]);
    const r = await call(api, 'lifeos_correct_entry', { entry_id: '00000000-0000-4000-8000-0000000000aa', data: { peso: 73.4 } });
    expect(r.isError).toBe(true); // no existe
    const real = { ...e('2027-01-11', 73.6), id: '00000000-0000-4000-8000-0000000000bb' };
    const f2 = fakeApi([real]);
    await call(f2.api, 'lifeos_correct_entry', { entry_id: real.id, data: { peso: 73.4 } });
    expect(f2.calls[0].args).toMatchObject({ p_supersedes_id: real.id, p_local_date: '2027-01-11' });
    expect(calls).toHaveLength(0);
  });
  it('proponer crea una propuesta pendiente', async () => {
    const { api, calls } = fakeApi();
    const r = JSON.parse((await call(api, 'lifeos_propose_change', { kind: 'note', payload: { text: 'x' }, rationale: 'porque' })).content[0].text);
    expect(r).toMatchObject({ proposal_id: 'prop-1', status: 'pending' });
    expect(calls[0].fn).toBe('create_proposal');
  });
});

describe('semana', () => {
  it('lifeos_week devuelve cumplimiento e indicadores día a día de la semana pedida', async () => {
    const { api } = fakeApi([e('2027-01-04', 75), e('2027-01-11', 73.6), e('2027-01-13', 73.8)]);
    const r = JSON.parse((await call(api, 'lifeos_week', { date: '2027-01-13' })).content[0].text);
    expect(r.week).toMatchObject({ start: '2027-01-11', end: '2027-01-17', days_elapsed: 2 }); // "hoy" del contexto = 12-ene
    expect(r.compliance[0]).toMatchObject({ area: 'cuerpo', form: 'peso', entries: 2, expected_so_far: 2 });
    expect(r.indicators[0]).toMatchObject({ key: 'peso', by_day: [73.6, null, 73.8, null, null, null, null], avg: 73.7, prev_week_avg: 75, change: -1.3 });
  });
});

describe('planes, horario y despensa', () => {
  const withPlans = (extra: Extra = {}) => fakeApi([], { plans: planRows, ...extra });

  it('agenda: qué toca hoy, con ahora y después en su zona horaria', async () => {
    // 2027-01-12 07:00Z = 08:00 en Zúrich, martes.
    const { api } = withPlans();
    const r = await call(api, 'lifeos_agenda');
    const out = r.structuredContent as { weekday: string; now: string; next: string; items: { title: string; training?: { name: string } }[] };
    expect(r.isError).toBe(false);
    expect(out.weekday).toBe('Martes');
    expect(out.items.find((i) => i.training)?.training?.name).toBeTruthy();
    expect(out.next).toMatch(/^\d\d:\d\d /);
  });

  it('agenda sin planes lo dice', async () => {
    const { api } = fakeApi();
    expect((await call(api, 'lifeos_agenda')).structuredContent).toMatchObject({ note: expect.stringContaining('planes') });
  });

  it('plan: contenido exacto, resumen y versiones', async () => {
    const { api } = withPlans();
    const out = (await call(api, 'lifeos_plan', { kind: 'training' })).structuredContent as { current: { summary: string[]; content: unknown }; versions: unknown[] };
    expect(out.versions).toHaveLength(1);
    expect(out.current.summary[0]).toMatch(/^Lunes: /);
    expect(out.current.content).toEqual(planRows[1].content);
  });

  it('plan de entreno por gimnasio: el de casa por defecto y la lista de gimnasios', async () => {
    const t = planRows.find((r) => r.kind === 'training')!;
    const viaje = { ...t, id: 'zona', version: t.version + 1, content: { ...(t.content as object), gym: 'la_zona', gym_name: 'La Zona', mode: 'mantenimiento' } };
    const { api } = withPlans({ plans: [...planRows, viaje] });
    const home = (await call(api, 'lifeos_plan', { kind: 'training' })).structuredContent as { gym: string; gyms: { gym: string; mode: string }[]; current: { version: number }; versions: { gym: string }[] };
    expect(home.gym).toBe('elevate');
    expect(home.current.version).toBe(t.version);
    expect(home.gyms.map((g) => [g.gym, g.mode])).toEqual([['elevate', 'progresion'], ['la_zona', 'mantenimiento']]);
    expect(home.versions.map((v) => v.gym)).toEqual(['la_zona', 'elevate']);
    const away = (await call(api, 'lifeos_plan', { kind: 'training', gym: 'la_zona' })).structuredContent as { current: { version: number; summary: string[] } };
    expect(away.current.version).toBe(viaje.version);
    expect(away.current.summary[0]).toBe('Gimnasio: La Zona · mantenimiento (sin subir cargas ni escalones)');
  });

  it('periodo en otro gimnasio: la agenda usa su rutina y Claude lo registra solo si hay rutina', async () => {
    const t = planRows.find((r) => r.kind === 'training')!;
    const tc = t.content as { days: { weekday: number; name: string }[] };
    const viaje = { ...t, id: 'zona', version: t.version + 1, content: { ...tc, gym: 'la_zona', days: tc.days.map((d) => ({ ...d, name: `${d.name} (La Zona)` })) } };
    const periods = [{ id: 'p1', gym: 'la_zona', date_from: '2027-01-11', date_to: '2027-01-12', note: '' }];
    const { api, calls } = withPlans({ plans: [...planRows, viaje], periods });
    const a = (await call(api, 'lifeos_agenda', { date: '2027-01-11' })).structuredContent as { gym: string; items: { training?: { name: string } }[] };
    expect(a.gym).toBe('la_zona');
    expect(a.items.find((i) => i.training)?.training?.name).toMatch(/\(La Zona\)$/);
    const b = (await call(api, 'lifeos_agenda', { date: '2027-01-13' })).structuredContent as { gym: string };
    expect(b.gym).toBe('elevate');
    const plan = (await call(api, 'lifeos_plan', { kind: 'training', date: '2027-01-10' })).structuredContent as { periods: { id: string }[] };
    expect(plan.periods.map((p) => p.id)).toEqual(['p1']);
    const bad = await call(api, 'lifeos_set_gym_period', { gym: 'otro', from: '2027-02-01', to: '2027-02-02' });
    expect(bad.isError).toBe(true);
    await call(api, 'lifeos_set_gym_period', { gym: 'la_zona', from: '2027-02-01', to: '2027-02-02', note: 'visita' });
    await call(api, 'lifeos_set_gym_period', { delete_id: 'p1' });
    expect(calls.map((c) => c.fn)).toEqual(['save_gym_period', 'delete_gym_period']);
    expect(calls[0].args).toMatchObject({ p_gym: 'la_zona', p_from: '2027-02-01', p_to: '2027-02-02', p_note: 'visita', p_id: null });
  });

  it('viajes: vista previa sin guardar, crear con las reglas por defecto, choques y cancelar', async () => {
    const t = planRows.find((r) => r.kind === 'training')!;
    const viaje = { ...t, id: 'zona', version: t.version + 1, content: { ...(t.content as object), gym: 'la_zona', gym_name: 'La Zona' } };
    const { api, calls } = withPlans({ plans: [...planRows, viaje] });
    const args = { date_from: '2027-01-15', date_to: '2027-01-17', leave_time: '13:00', return_leave_time: '11:30', return_home_time: '18:30' };
    const pre = (await call(api, 'lifeos_trip', args)).structuredContent as { saved: boolean; nights: number; short: boolean; gym: { slug: string } | null; away_dates: string[]; remote_dates: string[] };
    expect(pre.saved).toBe(false);
    expect(pre).toMatchObject({ nights: 2, short: true, gym: { slug: 'la_zona' } });
    expect(pre.away_dates).toContain('2027-01-15');
    expect(calls).toEqual([]);

    const bad = await call(api, 'lifeos_trip', { date_from: '2027-01-17', date_to: '2027-01-15' });
    expect(bad.isError).toBe(true);

    const made = (await call(api, 'lifeos_set_trip', args)).structuredContent as { id: string };
    expect(made.id).toBe('new-id');
    expect(calls.map((c) => c.fn)).toEqual(['save_trip']);
    expect(calls[0].args).toMatchObject({ p_request_id: '00000000-0000-4000-8000-000000000001', p_id: null });
    expect(calls[0].args.p_trip).toMatchObject({ kind: 'espana', date_from: '2027-01-15', date_to: '2027-01-17', gym: 'la_zona' });

    const noGym = await call(api, 'lifeos_set_trip', { ...args, gym: 'otro' });
    expect(noGym.isError).toBe(true);
    expect(noGym.content[0].text).toMatch(/No hay rutina/);

    const id = '11111111-1111-4111-8111-111111111111';
    const row: TripRow = { id, kind: 'espana', date_from: '2027-01-15', date_to: '2027-01-17', leave_time: '13:00', return_leave_time: '11:30', return_home_time: '18:30',
      vacation_from: null, vacation_to: null, gym: 'la_zona', gym_opens: '07:00', commute_min: 15, gym_from: '2027-01-16', gym_to: '2027-01-17',
      away_dates: ['2027-01-15', '2027-01-17'], remote_dates: [], night_dates: ['2027-01-16', '2027-01-17'], checklist: {}, note: '', status: 'planned' };
    const withTrip = withPlans({ plans: [...planRows, viaje], trips: [row] });
    const clash = await call(withTrip.api, 'lifeos_set_trip', { ...args, date_from: '2027-01-16' });
    expect(clash.isError).toBe(true);
    expect(clash.content[0].text).toMatch(/Choca con otro viaje/);
    const list = (await call(withTrip.api, 'lifeos_trip')).structuredContent as { trips: { id: string; checklist: { key: string }[] }[] };
    expect(list.trips.map((x) => x.id)).toEqual([id]);
    expect(list.trips[0].checklist.map((c) => c.key)).toContain('maleta');
    const day = (await call(withTrip.api, 'lifeos_agenda', { date: '2027-01-15' })).structuredContent as { away: boolean };
    expect(day.away).toBe(true);

    expect((await call(withTrip.api, 'lifeos_set_trip', { cancel_id: 'no-uuid' })).isError).toBe(true);
    await call(withTrip.api, 'lifeos_set_trip', { cancel_id: id });
    expect(withTrip.calls).toEqual([{ fn: 'cancel_trip', args: { p_id: id } }]);
  });

  it('despensa: lista de lo que falta y lo pedido cuenta como entrante', async () => {
    const moves = [{ product: 'pasta', kind: 'count' as const, qty: 1000, occurred_at: '2027-01-11T18:00:00Z' }];
    const order: OrderRow = { id: 'o1', status: 'ordered', delivery_date: '2027-01-14', items: [{ product: 'tomate', packages: 10, amount: 4000 }], total: 10 };
    const { api } = withPlans({ moves, orders: [order] });
    const out = (await call(api, 'lifeos_pantry', { delivery: '2027-01-15' })).structuredContent as {
      stock: { product: string; counted: string | null }[]; shopping: { lines: { product: string }[]; pending_orders: unknown[] } };
    expect(out.stock.find((x) => x.product === 'pasta')?.counted).toBe('2027-01-11');
    expect(out.shopping.lines.map((l) => l.product)).toContain('pasta');
    expect(out.shopping.lines.map((l) => l.product)).not.toContain('tomate');
    expect(out.shopping.pending_orders).toHaveLength(1);
  });

  it('registrar despensa valida los productos antes de llamar a la BD', async () => {
    const { api, calls } = withPlans();
    const bad = await call(api, 'lifeos_record_stock', { moves: [{ product: 'caviar', kind: 'count', qty: 1 }] });
    expect(bad.isError).toBe(true);
    expect(calls).toHaveLength(0);
    const okr = await call(api, 'lifeos_record_stock', { moves: [{ product: 'pasta', kind: 'count', qty: 500 }] });
    expect(okr.isError).toBe(false);
    expect(calls[0]).toMatchObject({ fn: 'record_stock', args: { p_request_id: '00000000-0000-4000-8000-000000000001' } });
  });

  it('ajustar la semana guarda el lunes y los días ordenados', async () => {
    const { api, calls } = withPlans();
    const r = await call(api, 'lifeos_set_week', { date: '2027-01-14', telework: [5, 3], away: [7] });
    expect(r.isError).toBe(false);
    expect(calls[0]).toMatchObject({ fn: 'save_week', args: { p_week_start: '2027-01-11', p_telework: [3, 5], p_away: [7] } });
    expect((await call(api, 'lifeos_set_week', { date: '2027-01-14', telework: [6] })).isError).toBe(true);
  });

  it('proponer un plan inválido se rechaza sin crear la propuesta; uno válido sí', async () => {
    const { api, calls } = withPlans();
    const bad = await call(api, 'lifeos_propose_change', { kind: 'plan.save', rationale: 'x', payload: { kind: 'training', name: 'v2', valid_from: '2027-02-01', content: { days: 'no' } } });
    expect(bad.isError).toBe(true);
    expect(calls).toHaveLength(0);
    const good = await call(api, 'lifeos_propose_change', { kind: 'plan.save', rationale: 'Sube una serie', payload: { kind: 'training', name: 'v2', valid_from: '2027-02-01', content: planRows[1].content } });
    expect(good.isError).toBe(false);
    expect(calls[0].fn).toBe('create_proposal');
  });
});
