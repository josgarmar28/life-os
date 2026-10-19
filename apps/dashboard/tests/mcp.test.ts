import { describe, expect, it } from 'vitest';
import type { Area, Entry, Field, Form } from '@shared/model.ts';
import { handleBody, handleMessage, TOOLS, type Api } from '../../../supabase/functions/mcp/handler.ts';

const area: Area = { id: 'a1', slug: 'cuerpo', name: 'Cuerpo', description: '', icon: '📏', sort_order: 1, status: 'active', created_at: '', updated_at: '', archived_at: null };
const archivedArea: Area = { ...area, id: 'a2', slug: 'viejo', name: 'Viejo', status: 'archived' };
const form: Form = { id: 'fm1', area_id: 'a1', slug: 'peso', name: 'Peso', description: '', cadence: 'daily', sort_order: 1, status: 'active', created_at: '', updated_at: '', archived_at: null };
const peso: Field = { id: 'fd1', form_id: 'fm1', key: 'peso', label: 'Peso', help: '', type: 'number', unit: 'kg', min: 20, max: 400, step: 0.1,
  options: [], columns: [], required: true, on_overview: true, sort_order: 1, status: 'active' };
const e = (d: string, v: number): Entry => ({ id: `e-${d}`, form_id: 'fm1', area_id: 'a1', occurred_at: `${d}T06:00:00Z`, local_date: d, data: { peso: v },
  note: '', source: 'dashboard', quality: 'manual', supersedes_id: null, actor: 'owner', created_at: '' });

function fakeApi(entries: Entry[] = []) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const api: Api = {
    areas: async () => [area, archivedArea],
    forms: async () => [form],
    fields: async () => [peso],
    entries: async (q) => entries.filter((x) => (!q.ids || q.ids.includes(x.id)) && (!q.formIds || q.formIds.includes(x.form_id))
      && (!q.from || x.local_date >= q.from) && (!q.to || x.local_date <= q.to)).slice(0, q.limit),
    proposals: async () => [],
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
