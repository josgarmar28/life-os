// Resumen semanal entre áreas: qué se ha registrado y cómo se mueven los indicadores día a día.
// Lo usan la página "Semana" del dashboard y la herramienta lifeos_week del conector, para que
// él y Claude vean lo mismo (p. ej. noches malas → energía y entreno de los días siguientes).
import type { Area, Entry, Field, Form } from './model.ts';
import { byOrder, NUMERIC_TYPES } from './model.ts';
import { addDays, fieldSeries, mean, weekStart } from './stats.ts';

export interface WeekForm {
  area: Area;
  form: Form;
  /** Días de la semana (YYYY-MM-DD) con al menos un registro. */
  days: string[];
  count: number;
  /** Cuántos tocaban hasta hoy según la cadencia (null si no hay objetivo: por sesión, libre, mensual…). */
  expected: number | null;
}

export interface WeekIndicator {
  area: Area;
  form: Form;
  field: Field;
  /** Un valor por día (lunes a domingo), o null si no hay dato. */
  days: (number | null)[];
  avg: number | null;
  prevAvg: number | null;
  delta: number | null;
  n: number;
}

export interface WeekSummary {
  start: string;
  end: string;
  dates: string[];
  /** Días de la semana ya transcurridos (7 si la semana terminó). */
  elapsed: number;
  forms: WeekForm[];
  indicators: WeekIndicator[];
}

/** Desde qué fecha hay que traer registros para resumir la semana de `date` (incluye la anterior). */
export const weekRange = (date: string) => {
  const start = weekStart(date);
  return { start, end: addDays(start, 6), fetchFrom: addDays(start, -7) };
};

export function summarizeWeek(areas: Area[], forms: Form[], fields: Field[], entries: Entry[], date: string, today: string): WeekSummary {
  const { start, end } = weekRange(date);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const elapsed = today < start ? 0 : today > end ? 7 : dates.indexOf(today) + 1;
  const activeAreas = areas.filter((a) => a.status === 'active').sort(byOrder);
  const out: WeekSummary = { start, end, dates, elapsed, forms: [], indicators: [] };

  for (const area of activeAreas) {
    for (const form of forms.filter((f) => f.area_id === area.id && f.status === 'active').sort(byOrder)) {
      const own = entries.filter((e) => e.form_id === form.id);
      const inWeek = own.filter((e) => e.local_date >= start && e.local_date <= end);
      const expected = form.cadence === 'daily' ? elapsed : form.cadence === 'weekly' ? (elapsed > 0 ? 1 : 0) : null;
      out.forms.push({ area, form, days: [...new Set(inWeek.map((e) => e.local_date))].sort(), count: inWeek.length, expected });

      for (const field of fields.filter((x) => x.form_id === form.id && x.on_overview && x.status === 'active' && NUMERIC_TYPES.includes(x.type)).sort(byOrder)) {
        const series = fieldSeries(field, own, addDays(start, -7), end);
        const byDate = new Map(series.map((p) => [p.date, p.value]));
        const cur = series.filter((p) => p.date >= start).map((p) => p.value);
        const prev = series.filter((p) => p.date < start).map((p) => p.value);
        const avg = mean(cur);
        const prevAvg = mean(prev);
        out.indicators.push({
          area, form, field,
          days: dates.map((d) => byDate.get(d) ?? null),
          avg, prevAvg,
          delta: avg !== null && prevAvg !== null ? avg - prevAvg : null,
          n: cur.length,
        });
      }
    }
  }
  return out;
}
