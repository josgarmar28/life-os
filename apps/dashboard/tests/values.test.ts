import { describe, expect, it } from 'vitest';
import type { Field } from '@shared/model.ts';
import { fromData, parseDuration, parseOptions, slugify, toPayload } from '../src/values';

const f = (over: Partial<Field>): Field => ({
  id: over.key ?? 'x', form_id: 'form', key: 'x', label: 'X', help: '', type: 'number', unit: '', min: null, max: null, step: null,
  options: [], columns: [], required: false, on_overview: false, sort_order: 0, status: 'active', ...over,
});

describe('entrada de datos', () => {
  it('duraciones en formato humano', () => {
    expect(parseDuration('7h40')).toBe(460);
    expect(parseDuration('7:05')).toBe(425);
    expect(parseDuration('7 h')).toBe(420);
    expect(parseDuration('460')).toBe(460);
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('mucho')).toBeNaN();
  });

  it('convierte el estado del formulario y valida lo obvio', () => {
    const fields = [
      f({ key: 'peso', label: 'Peso', type: 'number', min: 20, max: 400, required: true }),
      f({ key: 'cal', label: 'Calidad', type: 'scale', min: 1, max: 5 }),
      f({ key: 'ok', label: 'Ok', type: 'boolean' }),
      f({ key: 'tags', label: 'Tags', type: 'multi', options: [{ value: 'a' }] }),
      f({ key: 'nota', label: 'Nota', type: 'text' }),
      f({ key: 'series', label: 'Series', type: 'table', columns: [
        { key: 'ej', label: 'Ejercicio', type: 'text', required: true },
        { key: 'reps', label: 'Reps', type: 'integer', min: 0, max: 100 },
      ] }),
    ];
    const ok = toPayload(fields, { peso: '73,6', cal: '4', ok: 'false', tags: [], nota: '  ', series: [{ ej: 'Prensa', reps: '10' }, { ej: '', reps: '' }] });
    expect(ok.errors).toEqual([]);
    expect(ok.data).toEqual({ peso: 73.6, cal: 4, ok: false, series: [{ ej: 'Prensa', reps: 10 }] });

    const bad = toPayload(fields, { peso: '', cal: '9', series: [{ ej: '', reps: '8' }] });
    expect(bad.errors).toContain('Peso: es obligatorio');
    expect(bad.errors.some((e) => e.startsWith('Calidad: debe estar entre 1 y 5'))).toBe(true);
    expect(bad.errors).toContain('Series, fila 1: falta Ejercicio');
  });

  it('ida y vuelta entre datos guardados y formulario', () => {
    const fields = [f({ key: 'ok', type: 'boolean' }), f({ key: 'tags', type: 'multi', options: [{ value: 'a' }] }), f({ key: 'n', type: 'integer' })];
    const state = fromData(fields, { ok: true, tags: ['a'], n: 3 });
    expect(state).toEqual({ ok: 'true', tags: ['a'], n: '3' });
    expect(toPayload(fields, state).data).toEqual({ ok: true, tags: ['a'], n: 3 });
  });

  it('identificadores y opciones', () => {
    expect(slugify('Sueño de calidad')).toBe('sueno-de-calidad');
    expect(slugify('Horas de francés', '_')).toBe('horas_de_frances');
    expect(slugify('5 km', '_')).toBe('c_5_km');
    expect(parseOptions('Trabajo\npiso = Piso compartido\n')).toEqual([
      { value: 'trabajo', label: 'Trabajo' },
      { value: 'piso', label: 'Piso compartido' },
    ]);
  });
});
