import { describe, expect, it } from 'vitest';
import type { Field } from '@shared/model.ts';
import { entrySummary, groupSets, rowsPerWeek, shortLabel } from '../src/history';

const f = (over: Partial<Field>): Field => ({
  id: over.key ?? 'x', form_id: 'f', key: 'x', label: 'X', help: '', type: 'number', unit: '', min: null, max: null, step: null,
  options: [], columns: [], required: false, on_overview: false, sort_order: 0, status: 'active', ...over,
});
const series = f({
  key: 'series', type: 'table', label: 'Series', columns: [
    { key: 'ejercicio', label: 'Ejercicio', type: 'text' }, { key: 'maquina', label: 'Máquina', type: 'text' },
    { key: 'carga_kg', label: 'Carga', type: 'number', unit: 'kg' }, { key: 'reps', label: 'Reps', type: 'integer' },
    { key: 'rir', label: 'RIR', type: 'integer' }, { key: 'molestia', label: 'Molestia', type: 'integer' }, { key: 'linea', label: 'Línea', type: 'text' },
  ],
});

describe('groupSets', () => {
  it('una línea por ejercicio, sin claves internas', () => {
    const rows = [
      { ejercicio: 'Press', maquina: 'New Tech', carga_kg: 70, reps: 10, rir: 2, linea: 'press_x' },
      { ejercicio: 'Press', carga_kg: 70, reps: 9, rir: 1, linea: 'press_x' },
      { ejercicio: 'Jalón', carga_kg: 60, reps: 12, rir: 1 },
      { ejercicio: 'Jalón', carga_kg: 62.5, reps: 10, rir: 1, molestia: 3 },
    ];
    expect(groupSets(series, rows)).toEqual([
      { name: 'Press', machine: 'New Tech', text: '70 kg × 10, 9 · RIR 2-1' },
      { name: 'Jalón', machine: null, text: '60×12 · 62,5×10 · RIR 1-1 · molestia 3/10' },
    ]);
  });
});

describe('entrySummary', () => {
  it('resume una sesión y un registro de un campo', () => {
    const inicio = f({ key: 'inicio', type: 'time' });
    const fin = f({ key: 'fin', type: 'time' });
    expect(entrySummary([inicio, fin, series], { data: { inicio: '06:02', fin: '07:35', series: [{ ejercicio: 'A' }, { ejercicio: 'A' }, { ejercicio: 'B' }] } }))
      .toBe('06:02–07:35 · 2 ejercicios · 3 series');
    expect(entrySummary([f({ key: 'peso', unit: 'kg', on_overview: true })], { data: { peso: 77.9 } })).toBe('77,9 kg');
    const cal = f({ key: 'calidad', type: 'scale', label: 'Calidad del sueño', on_overview: true });
    const dur = f({ key: 'zepp', type: 'duration', label: 'Zepp: duración', on_overview: true });
    expect(entrySummary([cal, dur], { data: { calidad: 3, zepp: 451 } })).toBe('Calidad 3 · Duración 7 h 31');
  });
  it('acorta etiquetas', () => {
    expect(shortLabel('Cintura (ombligo)')).toBe('Cintura');
    expect(shortLabel('Energía')).toBe('Energía');
  });
});

describe('rowsPerWeek', () => {
  it('cuenta series por semana, con las semanas vacías a cero', () => {
    const e = (d: string, n: number) => ({ id: d, form_id: 'f', local_date: d, occurred_at: `${d}T06:00:00Z`, data: { series: Array(n).fill({}) } }) as never;
    expect(rowsPerWeek(series, [e('2027-01-11', 18), e('2027-01-13', 20), e('2027-01-25', 5)], '2027-01-11', '2027-01-27'))
      .toEqual([{ date: '2027-01-11', value: 38 }, { date: '2027-01-18', value: 0 }, { date: '2027-01-25', value: 5 }]);
  });
});
