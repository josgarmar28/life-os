import { describe, expect, it } from 'vitest';
import type { Entry } from '@shared/model.ts';
import type { Exercise } from '@shared/plans.ts';
import { sessionSummary } from '../src/summary';

const press = { key: 'press', name: 'Press', type: 'compuesto', sets: 3, reps: [6, 10], rir: [1, 2], load: 'discos' } as unknown as Exercise;
const curl = { key: 'curl', name: 'Curl', type: 'aislamiento', sets: 2, reps: [8, 12], rir: [0, 2], load: 'discos' } as unknown as Exercise;
const session = (date: string, series: Record<string, unknown>[]) => ({ id: date, form_id: 's', local_date: date, occurred_at: `${date}T06:00:00Z`, data: { series } }) as unknown as Entry;
const history = [
  session('2027-01-04', [
    { linea: 'press', ejercicio: 'Press', carga_kg: 70, reps: 10, rir: 2 }, { linea: 'press', carga_kg: 70, reps: 9, rir: 1 }, { linea: 'press', carga_kg: 70, reps: 8, rir: 1 },
    { linea: 'curl', ejercicio: 'Curl', carga_kg: 20, reps: 12, rir: 1 }, { linea: 'curl', carga_kg: 20, reps: 12, rir: 1 },
  ]),
];

describe('sessionSummary', () => {
  it('compara con la última vez y dice qué toca después', () => {
    const s = sessionSummary({
      date: '2027-01-11', exercises: [press, curl], history, mode: 'progresion', setsPlanned: 5,
      startedAt: '2027-01-11T05:02:00Z', endedAt: new Date('2027-01-11T06:30:00Z'),
      lines: [
        { key: 'press', name: 'Press', sets: [{ kg: 70, reps: 10, rir: 2 }, { kg: 70, reps: 10, rir: 1 }, { kg: 70, reps: 9, rir: 1 }] },
        { key: 'curl', name: 'Curl', sets: [{ kg: 22.5, reps: 9, rir: 1 }, { kg: 22.5, reps: 8, rir: 1 }] },
      ],
    });
    expect(s.minutes).toBe(88);
    expect(s.setsDone).toBe(5);
    expect(s.improved).toBe(2);
    expect(s.lines[0]).toMatchObject({ today: '70 kg × 10, 10, 9', change: '+2 reps respecto al 04/01', better: true, next: 'Repite 70 kg' });
    expect(s.lines[1]).toMatchObject({ change: 'Subes de 20 a 22,5 kg', better: true });
    expect(s.volume).toBe(Math.round(70 * 29 + 22.5 * 17));
  });
  it('sin historial: primera vez, y omite líneas sin series', () => {
    const s = sessionSummary({ date: '2027-01-11', exercises: [press], history: [], mode: 'progresion', setsPlanned: 3, startedAt: null, endedAt: new Date(),
      lines: [{ key: 'press', name: 'Press', sets: [{ kg: 60, reps: 8, rir: 2 }] }, { key: 'curl', name: 'Curl', sets: [] }] });
    expect(s.minutes).toBeNull();
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].change).toBe('Primera vez: carga de referencia');
    expect(s.lines[0].better).toBeNull();
  });
});
