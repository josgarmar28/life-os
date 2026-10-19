import { describe, expect, it } from 'vitest';
import type { Area, Entry, Field, Form } from '@shared/model.ts';
import { summarizeWeek, weekRange } from '@shared/week.ts';

const area = (id: string, slug: string, sort: number): Area => ({ id, slug, name: slug, description: '', icon: '', sort_order: sort, status: 'active', created_at: '', updated_at: '', archived_at: null });
const form = (id: string, area_id: string, cadence: Form['cadence'], sort = 1): Form => ({ id, area_id, slug: id, name: id, description: '', cadence, sort_order: sort, status: 'active', created_at: '', updated_at: '', archived_at: null });
const field = (id: string, form_id: string, key: string, over: Partial<Field> = {}): Field => ({ id, form_id, key, label: key, help: '', type: 'scale', unit: '', min: 1, max: 5, step: null, options: [], columns: [], required: false, on_overview: true, sort_order: 1, status: 'active', ...over });
const entry = (form_id: string, local_date: string, data: Record<string, unknown>, at = '06:00'): Entry => ({ id: `${form_id}${local_date}${at}`, form_id, area_id: '', occurred_at: `${local_date}T${at}:00Z`, local_date, data, note: '', source: 'dashboard', quality: 'manual', supersedes_id: null, actor: 'owner', created_at: '' });

const areas = [area('a2', 'entreno', 20), area('a1', 'sueno', 10)];
const forms = [form('manana', 'a1', 'daily'), form('revision', 'a1', 'weekly', 2), form('sesion', 'a2', 'per_session')];
const fields = [
  field('f1', 'manana', 'calidad'),
  field('f2', 'manana', 'notas', { type: 'text' }),
  field('f3', 'manana', 'oculto', { on_overview: false }),
  field('f4', 'sesion', 'duracion', { type: 'duration', unit: 'min', min: 0, max: 300 }),
];
const entries = [
  entry('manana', '2027-01-04', { calidad: 2 }), // semana anterior (lunes 4)
  entry('manana', '2027-01-10', { calidad: 4 }), // domingo de la anterior
  entry('manana', '2027-01-11', { calidad: 3 }),
  entry('manana', '2027-01-11', { calidad: 5 }, '07:00'), // la última del día manda
  entry('manana', '2027-01-13', { calidad: 4 }),
  entry('sesion', '2027-01-12', { duracion: 95 }),
  entry('sesion', '2027-01-14', { duracion: 85 }),
];

describe('resumen semanal', () => {
  it('rango lunes-domingo y carga desde la semana anterior', () => {
    expect(weekRange('2027-01-14')).toEqual({ start: '2027-01-11', end: '2027-01-17', fetchFrom: '2027-01-04' });
  });

  it('cumplimiento según cadencia hasta hoy y orden por área', () => {
    const w = summarizeWeek(areas, forms, fields, entries, '2027-01-14', '2027-01-14');
    expect(w.elapsed).toBe(4);
    expect(w.forms.map((f) => f.form.id)).toEqual(['manana', 'revision', 'sesion']);
    expect(w.forms[0]).toMatchObject({ days: ['2027-01-11', '2027-01-13'], expected: 4 });
    expect(w.forms[1]).toMatchObject({ count: 0, expected: 1 });
    expect(w.forms[2]).toMatchObject({ count: 2, expected: null });
  });

  it('indicadores numéricos marcados: valor por día, media y cambio frente a la anterior', () => {
    const w = summarizeWeek(areas, forms, fields, entries, '2027-01-14', '2027-01-14');
    expect(w.indicators.map((i) => i.field.key)).toEqual(['calidad', 'duracion']);
    const calidad = w.indicators[0];
    expect(calidad.days).toEqual([5, null, 4, null, null, null, null]);
    expect(calidad.avg).toBe(4.5);
    expect(calidad.prevAvg).toBe(3);
    expect(calidad.delta).toBe(1.5);
    expect(w.indicators[1].days).toEqual([null, 95, null, 85, null, null, null]);
    expect(w.indicators[1].prevAvg).toBeNull();
    expect(w.indicators[1].delta).toBeNull();
  });

  it('semana pasada completa y semana futura sin días transcurridos', () => {
    expect(summarizeWeek(areas, forms, fields, entries, '2027-01-04', '2027-01-14').elapsed).toBe(7);
    const future = summarizeWeek(areas, forms, fields, entries, '2027-01-18', '2027-01-14');
    expect(future.elapsed).toBe(0);
    expect(future.forms[0].expected).toBe(0);
  });
});
