// Cálculos deterministas de la vista general. Sin IA, sin red: probados con vitest.
import type { Cadence, Entry, Field, Form } from './model.ts';
import { NUMERIC_TYPES } from './model.ts';

export const DEFAULT_TZ = 'Europe/Zurich';

/** Fecha local YYYY-MM-DD de un instante en una zona horaria. */
export function localDate(at: Date, tz: string = DEFAULT_TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Suma días a una fecha YYYY-MM-DD (sin zonas horarias: aritmética de calendario). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana (ISO) de una fecha. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  return addDays(date, -dow);
}

export interface PeriodStatus {
  /** true = hecho en el periodo; false = pendiente; null = sin periodo (por sesión, libre). */
  done: boolean | null;
  label: string;
  last: string | null;
}

/** ¿Está hecho el formulario en el periodo que marca su cadencia? */
export function periodStatus(cadence: Cadence, dates: string[], today: string): PeriodStatus {
  const sorted = [...dates].sort();
  const last = sorted.length ? sorted[sorted.length - 1] : null;
  const has = (pred: (d: string) => boolean) => sorted.some(pred);
  switch (cadence) {
    case 'daily':
      return { done: has((d) => d === today), label: 'hoy', last };
    case 'weekly': {
      const ws = weekStart(today);
      return { done: has((d) => d >= ws && d <= today), label: 'esta semana', last };
    }
    case 'biweekly': {
      const from = addDays(today, -13);
      return { done: has((d) => d >= from && d <= today), label: 'últimos 14 días', last };
    }
    case 'monthly':
      return { done: has((d) => d.slice(0, 7) === today.slice(0, 7)), label: 'este mes', last };
    default:
      return { done: null, label: '', last };
  }
}

export interface Point {
  date: string;
  value: number;
}

/** Serie diaria de un campo numérico: el último valor de cada día, en orden de fecha. */
export function fieldSeries(field: Pick<Field, 'key' | 'type'>, entries: Entry[], from?: string, to?: string): Point[] {
  if (!NUMERIC_TYPES.includes(field.type)) return [];
  const byDay = new Map<string, { at: string; value: number }>();
  for (const e of entries) {
    const v = e.data[field.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if ((from && e.local_date < from) || (to && e.local_date > to)) continue;
    const prev = byDay.get(e.local_date);
    if (!prev || e.occurred_at > prev.at) byDay.set(e.local_date, { at: e.occurred_at, value: v });
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, x]) => ({ date, value: x.value }));
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Media de los días con dato dentro de los últimos n días (incluido hoy). */
export function rollingMean(series: Point[], today: string, days = 7): { value: number | null; n: number } {
  const from = addDays(today, -(days - 1));
  const vals = series.filter((p) => p.date >= from && p.date <= today).map((p) => p.value);
  return { value: mean(vals), n: vals.length };
}

/** Cambio entre la media de los últimos 7 días y la de los 7 anteriores. */
export function weekOverWeek(series: Point[], today: string): number | null {
  const cur = rollingMean(series, today, 7).value;
  const prev = rollingMean(series, addDays(today, -7), 7).value;
  if (cur === null || prev === null) return null;
  return cur - prev;
}

export interface FieldSummary {
  field: Field;
  last: Point | null;
  avg7: number | null;
  n7: number;
  delta7: number | null;
  series: Point[];
}

export function summarizeField(field: Field, entries: Entry[], today: string, windowDays = 30): FieldSummary {
  const series = fieldSeries(field, entries, addDays(today, -(windowDays - 1)), today);
  const all = fieldSeries(field, entries, undefined, today);
  const r = rollingMean(series, today, 7);
  return {
    field,
    last: all.length ? all[all.length - 1] : null,
    avg7: r.value,
    n7: r.n,
    delta7: weekOverWeek(series, today),
    series,
  };
}

export interface FormSummary {
  form: Form;
  status: PeriodStatus;
  count30: number;
  fields: FieldSummary[];
}

export function summarizeForm(form: Form, fields: Field[], entries: Entry[], today: string): FormSummary {
  const own = entries.filter((e) => e.form_id === form.id);
  const from = addDays(today, -29);
  return {
    form,
    status: periodStatus(form.cadence, own.map((e) => e.local_date), today),
    count30: own.filter((e) => e.local_date >= from && e.local_date <= today).length,
    fields: fields
      .filter((f) => f.form_id === form.id && f.on_overview && f.status === 'active')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((f) => summarizeField(f, own, today)),
  };
}

export function formatNumber(v: number, decimals = 1): string {
  const rounded = Math.round(v * 10 ** decimals) / 10 ** decimals;
  return rounded.toLocaleString('es-ES', { maximumFractionDigits: decimals });
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

/** Valor legible para humanos (y para el conector). */
export function formatValue(field: Pick<Field, 'type' | 'unit' | 'options' | 'columns'>, value: unknown): string {
  if (value === null || value === undefined) return '—';
  const label = (v: unknown) => field.options.find((o) => o.value === v)?.label ?? String(v);
  switch (field.type) {
    case 'boolean':
      return value ? 'Sí' : 'No';
    case 'choice':
      return label(value);
    case 'multi':
      return Array.isArray(value) ? value.map(label).join(', ') : String(value);
    case 'duration':
      return typeof value === 'number' ? formatDuration(value) : String(value);
    case 'number':
    case 'integer':
    case 'scale':
      return typeof value === 'number' ? `${formatNumber(value, 2)}${field.unit ? ` ${field.unit}` : ''}` : String(value);
    case 'table':
      return Array.isArray(value) ? `${value.length} ${value.length === 1 ? 'fila' : 'filas'}` : String(value);
    default:
      return String(value);
  }
}
