// Modo viaje: de unas fechas y horas a todo lo que hay que dejar coherente (días fuera de casa, gimnasio,
// teletrabajo, noches, checklist y avisos). Código determinista, sin IA: lo usan el dashboard (vista previa)
// y el conector (lifeos_trip), así que él y Claude ven exactamente lo mismo.
// Las reglas salen de nutricion/03 §3b, entrenamiento/05 §13.4 y /08, sueno/03 y de lo que él dijo el 28-nov
// (ver docs/adr/0004-modo-viaje.md). Los valores por defecto son editables en la vista previa.
import { addDays, weekStart } from './stats.ts';
import { isoWeekday, type GymPeriod, type SchedulePlan, type TripDay, type WeekRow } from './plans.ts';

export type TripKind = 'espana' | 'visita';
export type TripStatus = 'planned' | 'done' | 'cancelled';

/** Reglas por defecto. */
export const TRIP_RULES = {
  /** Día de salida: cuenta "fuera de casa" (no gasta despensa) si sales antes de esta hora. */
  awayLeaveBefore: '15:00',
  /** Día de llegada: cuenta "fuera de casa" si llegas después de esta hora (regla del lote 2 de nutrición). */
  awayHomeAfter: '16:00',
  /** Domingo de vuelta a casa antes de esta hora = lote 2 normal. */
  lote2Before: '16:00',
  /** Si sales de España antes de esta hora, ese día no entrenas allí. */
  gymLeaveAfter: '10:00',
  /** Más noches fuera que estas = viaje largo: cocina y pedido los fija nutrición. */
  shortMaxNights: 3,
  gymOpens: '07:00',
  commuteMin: 15,
} as const;

export interface TripInput {
  kind: TripKind;
  /** Día de salida de Pully (o de llegada de ella, en "visita"). */
  date_from: string;
  /** Día de llegada a Pully (o de salida de ella). */
  date_to: string;
  /** Hora de salida de Pully / de llegada de ella. */
  leave_time?: string | null;
  /** Hora de salida de España (solo "espana"). */
  return_leave_time?: string | null;
  /** Hora de llegada a Pully / de salida de ella. */
  return_home_time?: string | null;
  vacation_from?: string | null;
  vacation_to?: string | null;
  /** Gimnasio de allí (slug); null = sin cambio de gimnasio. */
  gym?: string | null;
  gym_opens?: string | null;
  commute_min?: number | null;
  note?: string;
}

/** Fila de core.trip (vista api.trips). */
export interface TripRow extends TripInput {
  id: string;
  status: TripStatus;
  gym_from: string | null;
  gym_to: string | null;
  away_dates: string[];
  remote_dates: string[];
  night_dates: string[];
  checklist: Record<string, boolean>;
}

/** Cambios a mano sobre lo que se deduce: por día "fuera de casa" y las fechas del gimnasio. */
export interface TripOverrides {
  away?: Record<string, boolean>;
  gym_from?: string | null;
  gym_to?: string | null;
}

export interface TripDayPlan {
  date: string;
  role: 'salida' | 'fuera' | 'vuelta' | 'salida_vuelta';
  away: boolean;
  vacation: boolean;
  /** Teletrabajo desde el destino. */
  remote: boolean;
  /** Gimnasio de ese día: el slug de allí o null (el de casa). */
  gym: string | null;
  /** La noche anterior se pasó fuera: el registro de esa mañana lleva la etiqueta. */
  night: boolean;
}

export interface ChecklistItem {
  key: string;
  label: string;
  detail?: string;
  /** Fecha a partir de la cual toca (para el aviso en Hoy). */
  due: string;
}

export type Comeback = 'normal' | 'expres' | 'largo';

export interface TripPlan {
  input: TripInput;
  days: TripDayPlan[];
  away_dates: string[];
  remote_dates: string[];
  night_dates: string[];
  night_tag: 'viaje' | 'atipico';
  gym_from: string | null;
  gym_to: string | null;
  nights: number;
  short: boolean;
  comeback: Comeback;
  checklist: ChecklistItem[];
  /** Explicaciones (qué se aplicará y por qué), una por línea. */
  notes: string[];
  warnings: string[];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const daysBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const diffDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Errores del formulario (lista vacía = se puede previsualizar). */
export function validateTripInput(i: TripInput): string[] {
  const e: string[] = [];
  if (i.kind !== 'espana' && i.kind !== 'visita') e.push('Elige si vas tú a España o viene ella.');
  if (!DATE.test(i.date_from ?? '') || !DATE.test(i.date_to ?? '')) return [...e, 'Faltan las fechas de salida y de vuelta.'];
  if (i.date_to < i.date_from) e.push('La vuelta no puede ser anterior a la salida.');
  else if (diffDays(i.date_from, i.date_to) > 60) e.push('Un viaje no puede durar más de 60 días.');
  for (const [k, label] of [['leave_time', i.kind === 'visita' ? 'La hora de llegada de ella' : 'La hora de salida de Pully'], ['return_home_time', i.kind === 'visita' ? 'La hora a la que se va ella' : 'La hora de llegada a Pully']] as const) {
    const v = i[k];
    if (!v || !TIME.test(v)) e.push(`${label} es obligatoria (HH:MM).`);
  }
  if (i.kind === 'espana') {
    if (!i.return_leave_time || !TIME.test(i.return_leave_time)) e.push('La hora de salida de España es obligatoria (HH:MM).');
    if (i.date_from === i.date_to && i.leave_time && i.return_home_time && i.return_home_time <= i.leave_time) e.push('Si vas y vuelves el mismo día, la llegada debe ser posterior a la salida.');
  }
  if ((i.vacation_from && !i.vacation_to) || (!i.vacation_from && i.vacation_to)) e.push('Las vacaciones necesitan fecha de inicio y de fin.');
  if (i.vacation_from && i.vacation_to) {
    if (i.vacation_to < i.vacation_from) e.push('Las vacaciones no pueden acabar antes de empezar.');
    else if (i.vacation_from < i.date_from || i.vacation_to > i.date_to) e.push('Las vacaciones deben caer dentro del viaje.');
  }
  if (i.gym_opens && !TIME.test(i.gym_opens)) e.push('La hora de apertura del gimnasio es HH:MM.');
  if (i.commute_min != null && (!Number.isInteger(i.commute_min) || i.commute_min < 0 || i.commute_min > 180)) e.push('El trayecto al gimnasio son entre 0 y 180 minutos.');
  return e;
}

/** Deduce todo el viaje a partir del formulario (y de los cambios a mano de la vista previa). */
export function deriveTrip(input: TripInput, overrides: TripOverrides = {}): TripPlan {
  const { date_from: from, date_to: to } = input;
  const warnings: string[] = [];
  const notes: string[] = [];
  const nights = Math.max(0, diffDays(from, to));
  const short = nights <= TRIP_RULES.shortMaxNights;
  const espana = input.kind === 'espana';
  const vacation = (d: string) => Boolean(input.vacation_from && input.vacation_to && d >= input.vacation_from && d <= input.vacation_to);

  // Gimnasio: donde has dormido esa noche. Desde el día siguiente a la salida; el de vuelta solo si sales de
  // España después de las 10:00 (si no, ya estás de camino).
  const gym = espana ? input.gym?.trim() || null : null;
  let gymFrom: string | null = null;
  let gymTo: string | null = null;
  if (gym) {
    gymFrom = overrides.gym_from !== undefined ? overrides.gym_from : addDays(from, 1);
    gymTo = overrides.gym_to !== undefined ? overrides.gym_to : (input.return_leave_time ?? '00:00') >= TRIP_RULES.gymLeaveAfter ? to : addDays(to, -1);
    if (gymFrom && gymTo && (gymFrom > gymTo || gymFrom < from || gymTo > to)) {
      if (overrides.gym_from !== undefined || overrides.gym_to !== undefined) warnings.push('Las fechas del gimnasio deben caer dentro del viaje.');
      gymFrom = null;
      gymTo = null;
    }
    if (!gymFrom || !gymTo) {
      gymFrom = null;
      gymTo = null;
    }
  }

  const days: TripDayPlan[] = daysBetween(from, to).map((date) => {
    const first = date === from;
    const last = date === to;
    const role: TripDayPlan['role'] = first && last ? 'salida_vuelta' : first ? 'salida' : last ? 'vuelta' : 'fuera';
    let away = true;
    if (first && (input.leave_time ?? '99:99') >= TRIP_RULES.awayLeaveBefore) away = false;
    if (last && (input.return_home_time ?? '00:00') <= TRIP_RULES.awayHomeAfter) away = false;
    if (first && last) away = (input.leave_time ?? '99:99') < TRIP_RULES.awayLeaveBefore && (input.return_home_time ?? '00:00') > TRIP_RULES.awayHomeAfter;
    if (overrides.away && date in overrides.away) away = overrides.away[date];
    const weekday = isoWeekday(date) <= 5;
    const remote = espana && weekday && !first && !last && !vacation(date);
    return {
      date, role, away, vacation: espana && vacation(date), remote,
      gym: gym && gymFrom && gymTo && date >= gymFrom && date <= gymTo ? gym : null,
      night: date > from,
    };
  });

  const comeback: Comeback = !short ? 'largo'
    : isoWeekday(to) === 7 && (input.return_home_time ?? '99:99') <= TRIP_RULES.lote2Before ? 'normal' : 'expres';

  const plan: TripPlan = {
    input, days, notes, warnings, nights, short, comeback,
    away_dates: days.filter((d) => d.away).map((d) => d.date),
    remote_dates: days.filter((d) => d.remote).map((d) => d.date),
    night_dates: days.filter((d) => d.night).map((d) => d.date),
    night_tag: espana ? 'viaje' : 'atipico',
    gym_from: gymFrom, gym_to: gymTo,
    checklist: [],
  };
  plan.checklist = checklistFor(plan);
  plan.notes.push(...explain(plan));
  return plan;
}

const longDate = (d: string) => new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
const shortDate = (d: string) => new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

/** Día de la entrega de Migros que conviene reservar para la vuelta. */
export function suggestedDelivery(input: Pick<TripInput, 'date_to' | 'return_home_time'>): string {
  return isoWeekday(input.date_to) === 7 || (input.return_home_time ?? '00:00') > TRIP_RULES.awayHomeAfter ? addDays(input.date_to, 1) : input.date_to;
}

function checklistFor(p: TripPlan): ChecklistItem[] {
  const i = p.input;
  const out: ChecklistItem[] = [];
  if (i.kind === 'espana') {
    out.push({ key: 'maleta', label: 'Preparar la maleta', due: addDays(i.date_from, -1) });
    out.push({
      key: 'burrito', label: 'Burrito R6 portátil para el trayecto', due: addDays(i.date_from, -1),
      detail: 'Relleno en la prep de las 18:30, tortilla aparte. Máximo 2 h a temperatura ambiente; bolsa isotérmica si es largo.',
    });
    const delivery = suggestedDelivery(i);
    out.push({
      key: 'migros', label: 'Reservar la entrega de Migros para la vuelta y hacer el pedido antes de salir', due: addDays(i.date_from, -3),
      detail: `Entrega sugerida: ${longDate(delivery)}. Ese día tienes que estar en casa (teletrabajo).`,
    });
  } else {
    out.push({
      key: 'comidas', label: 'Decidir las comidas del fin de semana', due: addDays(i.date_from, -2),
      detail: 'Sin lotes. Comer fuera sin medir ni compensar; plan B: burrito R6 o bocadillo (nutricion/09).',
    });
  }
  return out;
}

function explain(p: TripPlan): string[] {
  const i = p.input;
  const out: string[] = [];
  const away = p.days.filter((d) => d.away);
  out.push(away.length ? `${away.length} ${away.length === 1 ? 'día fuera de casa' : 'días fuera de casa'}: no gastan despensa ni cuentan en la lista de la compra y se ocultan cocina por lotes y bloques «solo en casa».` : 'Ningún día cuenta como fuera de casa.');
  if (i.kind === 'espana') {
    if (p.gym_from && p.gym_to) {
      out.push(`Entreno en ${i.gym} del ${shortDate(p.gym_from)} al ${shortDate(p.gym_to)}: mantenimiento (RIR 1-2), primera vez en cada máquina RIR 3. El gimnasio abre a las ${i.gym_opens || TRIP_RULES.gymOpens} y el trayecto son ${i.commute_min ?? TRIP_RULES.commuteMin} min.`);
      out.push('Al volver a Elevate: primera sesión con la última carga y RIR +1 (recalibrar si pasaron más de 2 semanas).');
    } else if (i.gym) {
      out.push('Sin sesiones en el gimnasio de allí en estas fechas.');
    }
    const remote = p.days.filter((d) => d.remote).length;
    const vac = p.days.filter((d) => d.vacation).length;
    out.push(remote ? `Teletrabajo desde España ${remote === 1 ? 'un día' : `${remote} días`} (mismo trabajo y misma pausa)${vac ? `; ${vac} ${vac === 1 ? 'día' : 'días'} de vacaciones sin trabajo` : ''}.` : vac ? `${vac} ${vac === 1 ? 'día' : 'días'} de vacaciones sin trabajo.` : 'Sin días de teletrabajo desde España (solo días de viaje o fines de semana).');
  }
  out.push(i.kind === 'espana'
    ? `Las noches fuera quedan marcadas «viaje» en el registro de sueño (no penalizan ni cuentan como tendencia). Cama 20:30 estricta desde el ${shortDate(i.date_to)}.`
    : 'Las noches con ella en casa quedan marcadas «día atípico» en el registro de sueño (no penalizan ni cuentan como tendencia).');
  if (p.comeback === 'largo') {
    out.push(`Viaje largo (${p.nights} noches): marca días, teletrabajo, gimnasio y sueño, pero la cocina y el pedido de la vuelta los fija el hilo de nutrición (03b/03c); no invento un plan.`);
  } else if (p.comeback === 'normal') {
    out.push('Vuelves el domingo antes de las 16:00: lote 2 normal ese día y la semana arranca casi normal. Esa semana sin lote 1 (no se cocinó).');
  } else {
    out.push('Esa semana sin lotes del fin de semana. Semana exprés de lunes a jueves: la cena de la prep (18:30-18:50) se cocina por duplicado (cena de hoy y almuerzo de mañana, ≤20 min) hasta que el miércoles o jueves de teletrabajo se cocine el lote 3 ampliado (R1 × 2 + R4 × 2 + R6 × 2, ≈75 min).');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Avisos que dependen de los demás datos
// ---------------------------------------------------------------------------

export interface TripContext {
  /** Viajes ya existentes (se ignoran los cancelados y el que se está editando). */
  trips: Pick<TripRow, 'id' | 'date_from' | 'date_to' | 'status'>[];
  periods: Pick<GymPeriod, 'id' | 'gym' | 'date_from' | 'date_to'>[];
  /** El viaje que se edita: ni él ni su periodo de gimnasio cuentan como choque. */
  editing?: Pick<TripRow, 'id' | 'gym' | 'gym_from' | 'gym_to'> | null;
  orders: { delivery_date: string; status: string }[];
  schedule: SchedulePlan | null;
  /** Gimnasios con rutina (slugs), para avisar si el elegido no tiene. */
  gyms?: string[];
}

export function tripWarnings(p: TripPlan, c: TripContext): string[] {
  const out: string[] = [];
  const i = p.input;
  const other = c.trips.find((t) => t.status !== 'cancelled' && t.id !== c.editing?.id && t.date_from <= i.date_to && t.date_to >= i.date_from);
  if (other) out.push(`Choca con otro viaje (${other.date_from} a ${other.date_to}).`);
  if (p.gym_from && p.gym_to) {
    const own = c.editing;
    const hit = c.periods.find((g) => g.date_from <= p.gym_to! && g.date_to >= p.gym_from!
      && !(own && g.gym === own.gym && g.date_from === own.gym_from && g.date_to === own.gym_to));
    if (hit) out.push(`Choca con un periodo en otro gimnasio (${hit.date_from} a ${hit.date_to}). Edítalo o bórralo en Entreno → En otro gimnasio.`);
    if (c.gyms && i.gym && !c.gyms.includes(i.gym)) out.push(`No hay rutina para el gimnasio «${i.gym}». Importa su rutina en Ajustes → Planes.`);
  }
  const deliveries = c.orders.filter((o) => o.status === 'ordered' && p.away_dates.includes(o.delivery_date));
  for (const o of deliveries) out.push(`Tienes una entrega de Migros el ${shortDate(o.delivery_date)}, con ese día fuera de casa. Muévela o ten a alguien en casa.`);
  if (i.kind === 'espana' && p.gym_from) {
    const blocks = c.schedule?.blocks ?? [];
    if (blocks.length && !blocks.some((b) => b.role === 'to_gym')) {
      out.push('Tu horario aún no marca el trayecto al gimnasio (role). Los despertares y trayectos de casa saldrán tal cual hasta que apruebes el horario nuevo con esas marcas.');
    }
  }
  if (c.schedule && !c.schedule.blocks.some((b) => b.home_only || b.work)) {
    out.push('Tu horario aún no marca qué bloques son «solo en casa» ni cuáles son de trabajo: mientras tanto solo se ocultan la cocina y la revisión de compra.');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aplicar: de la vista previa a la llamada a la base de datos
// ---------------------------------------------------------------------------

export interface WeekAddition {
  week_start: string;
  telework_base: number[];
  add_telework: number[];
  add_away: number[];
}

/**
 * Semanas tocadas por el viaje, con los días a añadir. `telework_base` es SIEMPRE el teletrabajo por defecto del horario:
 * la base de datos solo lo usa si la semana no tiene fila (al editar un viaje, la fila que creó el viaje se borra antes de
 * volver a aplicarlo, y partir de ella duplicaría sus días).
 */
export function weekAdditions(p: TripPlan, _weeks: WeekRow[], schedule: SchedulePlan | null): WeekAddition[] {
  const byWeek = new Map<string, WeekAddition>();
  const slot = (date: string) => {
    const ws = weekStart(date);
    let w = byWeek.get(ws);
    if (!w) {
      w = { week_start: ws, telework_base: [...(schedule?.default_telework ?? [])].sort(), add_telework: [], add_away: [] };
      byWeek.set(ws, w);
    }
    return w;
  };
  for (const d of p.away_dates) slot(d).add_away.push(isoWeekday(d));
  for (const d of p.remote_dates) slot(d).add_telework.push(isoWeekday(d));
  return [...byWeek.values()].sort((a, b) => a.week_start.localeCompare(b.week_start));
}

/** Lo que recibe api.save_trip. */
export function tripPayload(p: TripPlan, weeks: WeekRow[], schedule: SchedulePlan | null): Record<string, unknown> {
  const i = p.input;
  const gym = p.gym_from && p.gym_to ? i.gym ?? null : null;
  return {
    kind: i.kind, date_from: i.date_from, date_to: i.date_to,
    leave_time: i.leave_time || null, return_leave_time: i.kind === 'espana' ? i.return_leave_time || null : null,
    return_home_time: i.return_home_time || null,
    vacation_from: i.kind === 'espana' ? i.vacation_from || null : null, vacation_to: i.kind === 'espana' ? i.vacation_to || null : null,
    gym, gym_opens: gym ? i.gym_opens || TRIP_RULES.gymOpens : null, commute_min: gym ? i.commute_min ?? TRIP_RULES.commuteMin : null,
    gym_from: gym ? p.gym_from : null, gym_to: gym ? p.gym_to : null,
    away_dates: p.away_dates, remote_dates: p.remote_dates, night_dates: p.night_dates,
    weeks: weekAdditions(p, weeks, schedule),
    note: i.note ?? '',
  };
}

// ---------------------------------------------------------------------------
// Lectura: qué cambia un viaje guardado en un día, y qué toca en Hoy
// ---------------------------------------------------------------------------

const live = (t: Pick<TripRow, 'status'>) => t.status !== 'cancelled';

/** Lo que el viaje que cubre `date` cambia ese día (para la agenda), o null si no hay viaje. */
export function tripDayFor(trips: TripRow[], date: string): TripDay | null {
  const t = trips.find((x) => live(x) && x.date_from <= date && date <= x.date_to);
  if (!t) return null;
  const away = t.away_dates.includes(date);
  const inGym = Boolean(t.gym && t.gym_from && t.gym_to && date >= t.gym_from && date <= t.gym_to);
  return {
    away,
    vacation: Boolean(t.vacation_from && t.vacation_to && date >= t.vacation_from && date <= t.vacation_to),
    travel: t.kind === 'espana' && away && (date === t.date_from || date === t.date_to),
    ...(inGym ? { gym: { opens: (t.gym_opens ?? TRIP_RULES.gymOpens).slice(0, 5), commute_min: t.commute_min ?? TRIP_RULES.commuteMin } } : {}),
  };
}

/** Viajes que aún no han terminado (planificados) y cuyo fin no ha pasado. */
export function upcomingTrips(trips: TripRow[], today: string): TripRow[] {
  return trips.filter((t) => t.status === 'planned' && t.date_to >= today).sort((a, b) => a.date_from.localeCompare(b.date_from));
}

/** Datos del viaje guardado en el mismo formato que `deriveTrip` entiende. */
export function inputOf(t: TripRow): TripInput {
  return {
    kind: t.kind, date_from: t.date_from, date_to: t.date_to,
    leave_time: t.leave_time?.slice(0, 5) ?? null, return_leave_time: t.return_leave_time?.slice(0, 5) ?? null, return_home_time: t.return_home_time?.slice(0, 5) ?? null,
    vacation_from: t.vacation_from, vacation_to: t.vacation_to,
    gym: t.gym, gym_opens: t.gym_opens?.slice(0, 5) ?? null, commute_min: t.commute_min, note: t.note,
  };
}

/** Un viaje guardado, vuelto a calcular con lo que quedó guardado (días fuera y fechas de gimnasio incluidos). */
export function planOfRow(t: TripRow): TripPlan {
  return deriveTrip(inputOf(t), {
    away: Object.fromEntries(daysBetween(t.date_from, t.date_to).map((d) => [d, t.away_dates.includes(d)])),
    gym_from: t.gym_from, gym_to: t.gym_to,
  });
}

/** Checklist de un viaje guardado, con lo hecho y lo que toca ya. */
export function checklistStatus(t: TripRow, today: string): (ChecklistItem & { done: boolean; due_now: boolean })[] {
  return deriveTrip(inputOf(t)).checklist.map((c) => ({ ...c, done: Boolean(t.checklist[c.key]), due_now: today >= c.due }));
}

/** Pasos del checklist pendientes que ya tocan (aviso en Hoy), de los viajes próximos. */
export function dueChecklist(trips: TripRow[], today: string): { trip: TripRow; item: ChecklistItem }[] {
  return upcomingTrips(trips, today).filter((t) => t.date_from >= today).flatMap((t) =>
    checklistStatus(t, today).filter((c) => !c.done && c.due_now).map((item) => ({ trip: t, item })));
}
