import { describe, expect, it } from 'vitest';
import {
  checklistStatus, deriveTrip, dueChecklist, suggestedDelivery, tripDayFor, tripPayload, tripWarnings, validateTripInput, weekAdditions,
  type TripInput, type TripRow,
} from '@shared/trip.ts';
import { agendaFor, validatePlan, type SchedulePlan, type TrainingPlan, type WeekRow } from '@shared/plans.ts';

const base: TripInput = {
  kind: 'espana', date_from: '2027-01-22', date_to: '2027-01-24', leave_time: '16:00', return_leave_time: '11:00', return_home_time: '15:00',
  gym: 'la_zona', gym_opens: '07:00', commute_min: 15,
};

describe('viaje corto de fin de semana (vie → dom)', () => {
  it('vuelta el domingo antes de las 16:00: lote 2 normal y solo el sábado cuenta fuera', () => {
    const p = deriveTrip(base);
    expect(p.nights).toBe(2);
    expect(p.short).toBe(true);
    expect(p.comeback).toBe('normal');
    // Vie sales a las 16:00 (en casa para la comida); sáb entero fuera; dom llegas a las 15:00 (en casa para la cena).
    expect(p.away_dates).toEqual(['2027-01-23']);
    expect(p.night_dates).toEqual(['2027-01-23', '2027-01-24']);
    expect(p.night_tag).toBe('viaje');
    // Gimnasio donde has dormido: sábado y domingo (sales de España a las 11:00, después de las 10:00).
    expect([p.gym_from, p.gym_to]).toEqual(['2027-01-23', '2027-01-24']);
    expect(p.days.map((d) => d.gym)).toEqual([null, 'la_zona', 'la_zona']);
    expect(p.remote_dates).toEqual([]);
  });

  it('vuelta tarde el domingo: semana exprés y el domingo cuenta fuera de casa', () => {
    const p = deriveTrip({ ...base, return_home_time: '18:00' });
    expect(p.comeback).toBe('expres');
    expect(p.away_dates).toEqual(['2027-01-23', '2027-01-24']);
    expect(p.notes.join(' ')).toMatch(/semana exprés/i);
  });

  it('salir de España antes de las 10:00: el último día no se entrena allí', () => {
    const p = deriveTrip({ ...base, return_leave_time: '08:30' });
    expect(p.gym_to).toBe('2027-01-23');
    expect(p.days[2].gym).toBeNull();
  });

  it('salir antes de las 15:00 hace que el día de salida cuente fuera de casa', () => {
    expect(deriveTrip({ ...base, leave_time: '12:00' }).away_dates).toEqual(['2027-01-22', '2027-01-23']);
  });

  it('los cambios a mano de la vista previa mandan', () => {
    const p = deriveTrip(base, { away: { '2027-01-22': true, '2027-01-23': false }, gym_from: '2027-01-24', gym_to: '2027-01-24' });
    expect(p.away_dates).toEqual(['2027-01-22']);
    expect([p.gym_from, p.gym_to]).toEqual(['2027-01-24', '2027-01-24']);
    const bad = deriveTrip(base, { gym_from: '2027-01-10', gym_to: '2027-01-24' });
    expect(bad.gym_from).toBeNull();
    expect(bad.warnings.join(' ')).toMatch(/dentro del viaje/);
  });

  it('viaje de un solo día: fuera solo si sales antes de las 15:00 y vuelves después de las 16:00', () => {
    const one = { ...base, date_to: '2027-01-22', return_leave_time: '09:00' };
    expect(deriveTrip({ ...one, leave_time: '07:00', return_home_time: '22:00' }).away_dates).toEqual(['2027-01-22']);
    expect(deriveTrip({ ...one, leave_time: '07:00', return_home_time: '15:30' }).away_dates).toEqual([]);
    expect(deriveTrip({ ...one, leave_time: '16:00', return_home_time: '22:00' }).away_dates).toEqual([]);
  });
});

describe('viaje largo: el 3-10 de enero con vacaciones', () => {
  const jan: TripInput = {
    kind: 'espana', date_from: '2027-01-03', date_to: '2027-01-10', leave_time: '09:00', return_leave_time: '08:30', return_home_time: '18:30',
    vacation_from: '2027-01-04', vacation_to: '2027-01-08', gym: 'la_zona',
  };
  it('marca todos los días fuera, el domingo 10 también (llegas después de las 16:00) y deja la cocina a nutrición', () => {
    const p = deriveTrip(jan);
    expect(p.nights).toBe(7);
    expect(p.short).toBe(false);
    expect(p.comeback).toBe('largo');
    expect(p.away_dates).toHaveLength(8);
    expect(p.notes.join(' ')).toMatch(/nutrición/);
  });
  it('sin vacaciones, de lunes a viernes se teletrabaja desde España; con ellas, no', () => {
    expect(deriveTrip(jan).remote_dates).toEqual([]);
    expect(deriveTrip(jan).days.filter((d) => d.vacation)).toHaveLength(5);
    const noVac = deriveTrip({ ...jan, vacation_from: null, vacation_to: null });
    expect(noVac.remote_dates).toEqual(['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08']);
    const half = deriveTrip({ ...jan, vacation_from: '2027-01-07', vacation_to: '2027-01-08' });
    expect(half.remote_dates).toEqual(['2027-01-04', '2027-01-05', '2027-01-06']);
  });
  it('el gimnasio cubre del 4 al 9 (sale de España a las 08:30, antes de las 10:00)', () => {
    const p = deriveTrip(jan);
    expect([p.gym_from, p.gym_to]).toEqual(['2027-01-04', '2027-01-09']);
  });
  it('la entrega de Migros sugerida es el lunes siguiente', () => {
    expect(suggestedDelivery(jan)).toBe('2027-01-11');
    expect(deriveTrip(jan).checklist.find((c) => c.key === 'migros')?.detail).toMatch(/lunes/);
  });
});

describe('«Viene ella»', () => {
  const v: TripInput = { kind: 'visita', date_from: '2027-02-12', date_to: '2027-02-14', leave_time: '18:00', return_home_time: '14:00', gym: 'la_zona' };
  it('no toca gimnasio ni teletrabajo, etiqueta las noches «atípico» y quita los lotes', () => {
    const p = deriveTrip(v);
    expect(p.gym_from).toBeNull();
    expect(p.remote_dates).toEqual([]);
    expect(p.night_tag).toBe('atipico');
    expect(p.away_dates).toEqual(['2027-02-13']);
    expect(p.checklist.map((c) => c.key)).toEqual(['comidas']);
    const payload = tripPayload(p, [], null);
    expect(payload.gym).toBeNull();
    expect(payload.vacation_from).toBeNull();
  });
});

describe('formulario', () => {
  it('pide fechas, horas y coherencia', () => {
    expect(validateTripInput({ ...base })).toEqual([]);
    expect(validateTripInput({ ...base, date_to: '2027-01-20' })[0]).toMatch(/anterior/);
    expect(validateTripInput({ ...base, leave_time: null }).join(' ')).toMatch(/salida de Pully/);
    expect(validateTripInput({ ...base, return_leave_time: '' }).join(' ')).toMatch(/salida de España/);
    expect(validateTripInput({ ...base, vacation_from: '2027-01-22' }).join(' ')).toMatch(/inicio y de fin/);
    expect(validateTripInput({ ...base, vacation_from: '2027-01-21', vacation_to: '2027-01-23' }).join(' ')).toMatch(/dentro del viaje/);
    expect(validateTripInput({ ...base, date_to: '2027-05-30' }).join(' ')).toMatch(/60 días/);
    expect(validateTripInput({ ...base, commute_min: 500 }).join(' ')).toMatch(/trayecto/);
    expect(validateTripInput({ kind: 'visita', date_from: '2027-01-22', date_to: '2027-01-23', leave_time: '10:00', return_home_time: '12:00' })).toEqual([]);
  });
});

describe('semanas', () => {
  it('suma a lo elegido y, sin semana elegida, parte del teletrabajo por defecto', () => {
    const schedule: SchedulePlan = { blocks: [], default_telework: [3, 5] };
    const p = deriveTrip({
      kind: 'espana', date_from: '2027-01-29', date_to: '2027-02-02', leave_time: '09:00', return_leave_time: '08:30', return_home_time: '20:00',
    });
    const weeks: WeekRow[] = [{ week_start: '2027-01-25', telework: [2, 4], away: [], note: '' }];
    const add = weekAdditions(p, weeks, schedule);
    expect(add.map((w) => w.week_start)).toEqual(['2027-01-25', '2027-02-01']);
    expect(add[0].telework_base).toEqual([3, 5]); // siempre el de por defecto: solo se usa si la semana no tiene fila
    expect(add[1].telework_base).toEqual([3, 5]); // por defecto del horario
    expect(add[0].add_away).toEqual([5, 6, 7]);
    expect(add[1].add_away).toEqual([1, 2]);
  });
});

describe('avisos', () => {
  const ctx = (over: Partial<Parameters<typeof tripWarnings>[1]> = {}) => ({
    trips: [], periods: [], orders: [], schedule: null, gyms: ['elevate', 'la_zona'], ...over,
  });
  it('detecta choques con otro viaje, con un periodo de gimnasio y con una entrega', () => {
    const p = deriveTrip(base);
    expect(tripWarnings(p, ctx())).toEqual([]);
    expect(tripWarnings(p, ctx({ trips: [{ id: 't', date_from: '2027-01-24', date_to: '2027-01-26', status: 'planned' }] })).join(' ')).toMatch(/otro viaje/);
    expect(tripWarnings(p, ctx({ trips: [{ id: 't', date_from: '2027-01-24', date_to: '2027-01-26', status: 'cancelled' }] }))).toEqual([]);
    expect(tripWarnings(p, ctx({ periods: [{ id: 'g', gym: 'la_zona', date_from: '2027-01-20', date_to: '2027-01-23' }] })).join(' ')).toMatch(/otro gimnasio/);
    // Editar el propio viaje no choca con su propio periodo.
    expect(tripWarnings(p, ctx({
      periods: [{ id: 'g', gym: 'la_zona', date_from: '2027-01-23', date_to: '2027-01-24' }],
      editing: { id: 't', gym: 'la_zona', gym_from: '2027-01-23', gym_to: '2027-01-24' },
      trips: [{ id: 't', date_from: '2027-01-22', date_to: '2027-01-24', status: 'planned' }],
    }))).toEqual([]);
    expect(tripWarnings(p, ctx({ orders: [{ delivery_date: '2027-01-23', status: 'ordered' }] })).join(' ')).toMatch(/entrega de Migros/);
    expect(tripWarnings(p, ctx({ orders: [{ delivery_date: '2027-01-23', status: 'received' }] }))).toEqual([]);
    expect(tripWarnings(p, ctx({ gyms: ['elevate'] })).join(' ')).toMatch(/No hay rutina/);
  });
  it('avisa si el horario aún no tiene las marcas del modo viaje', () => {
    const p = deriveTrip(base);
    const schedule: SchedulePlan = { blocks: [{ id: 'a', days: [1], start: '09:00', title: 'Trabajo' }] };
    const w = tripWarnings(p, ctx({ schedule })).join(' ');
    expect(w).toMatch(/trayecto al gimnasio/);
    expect(w).toMatch(/solo en casa/);
    const ok: SchedulePlan = { blocks: [{ id: 'a', days: [1], start: '09:00', title: 'Trabajo', work: true }, { id: 'b', days: [1], start: '05:25', title: 'Bus', role: 'to_gym' }] };
    expect(tripWarnings(p, ctx({ schedule: ok }))).toEqual([]);
  });
});

describe('carga a la base de datos', () => {
  it('prepara el cuerpo de save_trip con semanas y fechas resueltas', () => {
    const p = deriveTrip(base);
    const body = tripPayload(p, [], { blocks: [], default_telework: [3, 5] });
    expect(body).toMatchObject({
      kind: 'espana', date_from: '2027-01-22', date_to: '2027-01-24', gym: 'la_zona', gym_from: '2027-01-23', gym_to: '2027-01-24',
      gym_opens: '07:00', commute_min: 15, away_dates: ['2027-01-23'], night_dates: ['2027-01-23', '2027-01-24'],
      weeks: [{ week_start: '2027-01-18', telework_base: [3, 5], add_telework: [], add_away: [6] }],
    });
  });
});

const row = (over: Partial<TripRow> = {}): TripRow => {
  const p = deriveTrip(base);
  return {
    ...base, id: 't1', status: 'planned', gym_from: p.gym_from, gym_to: p.gym_to, away_dates: p.away_dates, remote_dates: p.remote_dates,
    night_dates: p.night_dates, checklist: {}, ...over,
  };
};

describe('checklist y avisos en Hoy', () => {
  it('los pasos tocan unos días antes y desaparecen al marcarlos o al salir', () => {
    const t = row();
    expect(dueChecklist([t], '2027-01-10')).toEqual([]);
    expect(dueChecklist([t], '2027-01-19').map((x) => x.item.key)).toEqual(['migros']);
    expect(dueChecklist([t], '2027-01-21').map((x) => x.item.key)).toEqual(['maleta', 'burrito', 'migros']);
    expect(dueChecklist([row({ checklist: { migros: true } })], '2027-01-21').map((x) => x.item.key)).toEqual(['maleta', 'burrito']);
    expect(dueChecklist([t], '2027-01-23')).toEqual([]);
    expect(dueChecklist([row({ status: 'cancelled' })], '2027-01-21')).toEqual([]);
    expect(checklistStatus(row({ checklist: { maleta: true } }), '2027-01-21').find((c) => c.key === 'maleta')?.done).toBe(true);
  });
});

describe('agenda con un viaje', () => {
  const schedule: SchedulePlan = {
    default_telework: [3, 5],
    blocks: [
      { id: 'despertar', days: [1, 2, 3, 4, 5, 6], start: '05:00', title: 'Despertar', role: 'wake' },
      { id: 'bus-gym', days: [1, 2, 3, 4, 5, 6], start: '05:25', end: '06:00', title: 'Autobús al gimnasio', role: 'to_gym' },
      { id: 'gym', days: [1, 2, 4, 5], start: '06:00', end: '07:40', title: 'Gimnasio', link: { kind: 'training' } },
      { id: 'bus-empresa', days: [1, 3, 5], start: '08:00', end: '09:00', title: 'Autobús · empresa', home_only: true },
      { id: 'trabajo', days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00', title: 'Trabajo', work: true },
      { id: 'lote1', days: [6], start: '10:30', end: '12:00', title: 'Cocina: lote 1', link: { kind: 'cook', session: 'lote1' } },
      { id: 'colada', days: [3, 6], start: '09:00', title: 'Lavadora', home_only: true },
      { id: 'cena', days: [1, 2, 3, 4, 5, 6, 7], start: '18:50', end: '19:15', title: 'Cena' },
    ],
  };
  const training: TrainingPlan = { days: [{ weekday: 1, name: 'Torso A', kind: 'pesas', exercises: [] }] };
  const ids = (a: ReturnType<typeof agendaFor>) => a.items.map((i) => i.id);
  const at = (date: string, weeks: WeekRow[] = [], trip: ReturnType<typeof tripDayFor> = null) =>
    agendaFor({ date, schedule, training, meals: null, weeks, trip });

  it('sin viaje todo sale como siempre', () => {
    expect(ids(at('2027-01-04'))).toEqual(['despertar', 'bus-gym', 'gym', 'bus-empresa', 'trabajo', 'cena']);
    expect(ids(at('2027-01-09'))).toEqual(['despertar', 'bus-gym', 'colada', 'lote1', 'cena']);
  });

  it('un día fuera de casa oculta la cocina y lo «solo en casa»', () => {
    const away: WeekRow[] = [{ week_start: '2027-01-04', telework: [3, 5], away: [6], note: '' }];
    expect(ids(at('2027-01-09', away))).toEqual(['despertar', 'bus-gym', 'cena']);
  });

  it('en España: trabajo en remoto con el mismo horario, gimnasio a las 07:00 y trayecto de 15 min', () => {
    const t = row({ date_from: '2027-01-03', date_to: '2027-01-10', gym_from: '2027-01-04', gym_to: '2027-01-09', away_dates: ['2027-01-03', '2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09', '2027-01-10'], vacation_from: null, vacation_to: null });
    const a = at('2027-01-05', [], tripDayFor([t], '2027-01-05'));
    expect(a.items.map((i) => `${i.start} ${i.id}`)).toEqual(['06:20 despertar', '06:45 bus-gym', '07:00 gym', '09:00 trabajo', '18:50 cena']);
    expect(a.items.find((i) => i.id === 'bus-gym')).toMatchObject({ title: 'Desplazamiento al gimnasio', end: '07:00', detail: '15 min' });
    expect(a.items.find((i) => i.id === 'gym')?.end).toBe('08:40');
  });

  it('en vacaciones y en los días de viaje se oculta el trabajo', () => {
    const vac = row({ vacation_from: '2027-01-04', vacation_to: '2027-01-05', date_from: '2027-01-03', date_to: '2027-01-10', away_dates: ['2027-01-04'] });
    expect(ids(at('2027-01-04', [], tripDayFor([vac], '2027-01-04')))).not.toContain('trabajo');
    const trav = row({ date_from: '2027-01-04', date_to: '2027-01-10', away_dates: ['2027-01-04'], gym_from: null, gym_to: null, gym: null });
    const d = tripDayFor([trav], '2027-01-04')!;
    expect(d.travel).toBe(true);
    expect(ids(at('2027-01-04', [], d))).not.toContain('trabajo');
  });

  it('un viaje cancelado no cambia nada', () => {
    expect(tripDayFor([row({ status: 'cancelled' })], '2027-01-23')).toBeNull();
  });
});

describe('validación del horario con las marcas nuevas', () => {
  it('acepta home_only, work y role, y rechaza valores raros', () => {
    const ok = { blocks: [{ id: 'a', days: [1], start: '09:00', title: 'x', home_only: true, work: false, role: 'wake' }] };
    expect(validatePlan('schedule', ok)).toEqual([]);
    expect(validatePlan('schedule', { blocks: [{ id: 'a', days: [1], start: '09:00', title: 'x', home_only: 'sí' }] }).join(' ')).toMatch(/home_only/);
    expect(validatePlan('schedule', { blocks: [{ id: 'a', days: [1], start: '09:00', title: 'x', role: 'viaje' }] }).join(' ')).toMatch(/role/);
  });
});
