import { describe, expect, it } from 'vitest';
import type { Entry, Field, Form } from '@shared/model.ts';
import { addDays, fieldSeries, formatValue, localDate, periodStatus, rollingMean, summarizeForm, weekStart } from '@shared/stats.ts';

const field = (over: Partial<Field> = {}): Field => ({
  id: 'f1', form_id: 'form1', key: 'peso', label: 'Peso', help: '', type: 'number', unit: 'kg', min: null, max: null, step: null,
  options: [], columns: [], required: false, on_overview: true, sort_order: 10, status: 'active', ...over,
});
const entry = (local_date: string, data: Record<string, unknown>, occurred_at = `${local_date}T06:00:00Z`): Entry => ({
  id: `${local_date}-${occurred_at}`, form_id: 'form1', area_id: 'a1', occurred_at, local_date, data, note: '', source: 'dashboard',
  quality: 'manual', supersedes_id: null, actor: 'owner', created_at: occurred_at,
});

describe('fechas', () => {
  it('fecha local en Zúrich cruza la medianoche UTC', () => {
    expect(localDate(new Date('2026-10-18T22:30:00Z'), 'Europe/Zurich')).toBe('2026-10-19');
    expect(localDate(new Date('2026-12-31T22:59:00Z'), 'Europe/Zurich')).toBe('2026-12-31');
  });
  it('suma días y lunes ISO', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekStart('2027-01-10')).toBe('2027-01-04'); // domingo -> lunes anterior
    expect(weekStart('2027-01-11')).toBe('2027-01-11');
  });
});

describe('estado por cadencia', () => {
  it('diario, semanal, quincenal, mensual y libre', () => {
    expect(periodStatus('daily', ['2027-01-11'], '2027-01-11').done).toBe(true);
    expect(periodStatus('daily', ['2027-01-10'], '2027-01-11').done).toBe(false);
    expect(periodStatus('weekly', ['2027-01-04'], '2027-01-10').done).toBe(true);
    expect(periodStatus('weekly', ['2027-01-03'], '2027-01-10').done).toBe(false);
    expect(periodStatus('biweekly', ['2026-12-28'], '2027-01-10').done).toBe(true);
    expect(periodStatus('biweekly', ['2026-12-27'], '2027-01-10').done).toBe(false);
    expect(periodStatus('monthly', ['2027-01-01'], '2027-01-31').done).toBe(true);
    expect(periodStatus('per_session', [], '2027-01-31').done).toBeNull();
    expect(periodStatus('free', ['2027-01-02', '2027-01-05'], '2027-01-31').last).toBe('2027-01-05');
  });
});

describe('series y medias', () => {
  const f = field();
  const entries = [
    entry('2027-01-11', { peso: 74 }, '2027-01-11T05:00:00Z'),
    entry('2027-01-11', { peso: 73.6 }, '2027-01-11T06:30:00Z'), // la última del día gana
    entry('2027-01-12', { peso: 73.8 }),
    entry('2027-01-13', { otro: 1 }),
    entry('2027-01-05', { peso: 75 }),
  ];
  it('último valor por día, ordenado, ignorando días sin dato', () => {
    expect(fieldSeries(f, entries)).toEqual([
      { date: '2027-01-05', value: 75 },
      { date: '2027-01-11', value: 73.6 },
      { date: '2027-01-12', value: 73.8 },
    ]);
  });
  it('media de 7 días solo con los días con dato', () => {
    const r = rollingMean(fieldSeries(f, entries), '2027-01-12', 7);
    expect(r.n).toBe(2);
    expect(r.value).toBeCloseTo(73.7, 5);
  });
  it('los campos no numéricos no tienen serie', () => {
    expect(fieldSeries(field({ type: 'text' }), entries)).toEqual([]);
  });
  it('resumen de formulario con indicadores marcados', () => {
    const form: Form = { id: 'form1', area_id: 'a1', slug: 'peso', name: 'Peso', description: '', cadence: 'daily', sort_order: 1, status: 'active', created_at: '', updated_at: '', archived_at: null };
    const s = summarizeForm(form, [f, field({ id: 'f2', key: 'otro', on_overview: false })], entries, '2027-01-12');
    expect(s.status.done).toBe(true);
    expect(s.fields).toHaveLength(1);
    expect(s.fields[0].last).toEqual({ date: '2027-01-12', value: 73.8 });
    expect(s.fields[0].delta7).toBeCloseTo(73.7 - 75, 5);
  });
});

describe('formato', () => {
  it('valores legibles', () => {
    expect(formatValue(field({ type: 'duration', unit: 'min' }), 460)).toBe('7 h 40');
    expect(formatValue(field({ type: 'boolean' }), false)).toBe('No');
    expect(formatValue(field({ type: 'choice', options: [{ value: 'si', label: 'Sí' }] }), 'si')).toBe('Sí');
    expect(formatValue(field({ type: 'multi', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }), ['a', 'b'])).toBe('A, B');
    expect(formatValue(field({ type: 'table' }), [{}, {}])).toBe('2 filas');
    expect(formatValue(field(), 73.65)).toBe('73,65 kg');
  });
});
