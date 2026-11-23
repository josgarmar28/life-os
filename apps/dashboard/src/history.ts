// Historial legible: una línea por registro y, en el entreno, una línea por ejercicio.
import type { Entry, Field } from '@shared/model.ts';
import { NUMERIC_TYPES } from '@shared/model.ts';
import { formatNumber, formatValue, weekStart } from '@shared/stats.ts';
import type { Point } from '@shared/stats.ts';

/** Columnas internas que no se enseñan (la clave de la línea del plan). */
const HIDDEN_COLUMNS = new Set(['linea']);

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const kg = (v: number) => formatNumber(v, 2);

export interface SetGroup {
  name: string;
  machine: string | null;
  text: string;
}

/**
 * Agrupa las filas de una tabla por su primera columna (el ejercicio) respetando el orden.
 * Con carga y reps: "70 kg × 10, 9, 8 · RIR 2-1-1"; si la carga cambia, "70×10 · 72,5×8".
 */
export function groupSets(field: Pick<Field, 'columns'>, rows: Row[]): SetGroup[] {
  const cols = field.columns.filter((c) => !HIDDEN_COLUMNS.has(c.key));
  const first = cols[0]?.key;
  if (!first) return [];
  const has = (k: string) => cols.some((c) => c.key === k);
  const gym = has('carga_kg') && has('reps');
  const groups: { name: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const name = String(r[first] ?? '—');
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.rows.push(r);
    else groups.push({ name, rows: [r] });
  }
  return groups.map(({ name, rows: g }) => {
    const machine = (g.map((r) => r.maquina).find((m) => typeof m === 'string' && m.trim()) as string | undefined)?.trim() ?? null;
    if (!gym) {
      const rest = cols.slice(1);
      const text = g.map((r) => rest.filter((c) => r[c.key] !== undefined && r[c.key] !== '')
        .map((c) => `${c.label}: ${formatValue({ type: c.type, unit: c.unit ?? '', options: c.options ?? [], columns: [] }, r[c.key])}`).join(' · ')).filter(Boolean).join(' / ');
      return { name, machine: null, text };
    }
    const loads = g.map((r) => num(r.carga_kg));
    const reps = g.map((r) => num(r.reps));
    const same = loads.every((l) => l === loads[0]);
    let text: string;
    if (same) {
      text = `${loads[0] !== null ? `${kg(loads[0])} kg × ` : ''}${reps.map((x) => x ?? '–').join(', ')}`;
    } else {
      text = g.map((_, i) => `${loads[i] !== null ? kg(loads[i]!) : '–'}×${reps[i] ?? '–'}`).join(' · ');
    }
    const rir = g.map((r) => num(r.rir));
    if (rir.some((x) => x !== null)) text += ` · RIR ${rir.map((x) => x ?? '–').join('-')}`;
    const pain = Math.max(0, ...g.map((r) => num(r.molestia) ?? 0));
    if (pain > 0) text += ` · molestia ${pain}/10`;
    return { name, machine, text };
  });
}

/** Campos que resumen un registro y se dibujan: los marcados para el resumen, o los numéricos. */
export function keyFields(fields: Field[]): Field[] {
  const numeric = fields.filter((f) => f.status === 'active' && NUMERIC_TYPES.includes(f.type));
  const flagged = numeric.filter((f) => f.on_overview);
  return flagged.length ? flagged : numeric.slice(0, 3);
}

/** Una línea para la fila plegada del historial. */
export function entrySummary(fields: Field[], e: Pick<Entry, 'data'>): string {
  const table = fields.find((f) => f.type === 'table' && Array.isArray(e.data[f.key]));
  if (table) {
    const rows = e.data[table.key] as Row[];
    const n = groupSets(table, rows).length;
    const parts = [`${n} ${n === 1 ? 'ejercicio' : 'ejercicios'}`, `${rows.length} ${rows.length === 1 ? 'serie' : 'series'}`];
    if (typeof e.data.inicio === 'string' && typeof e.data.fin === 'string') parts.unshift(`${e.data.inicio}–${e.data.fin}`);
    return parts.join(' · ');
  }
  const all = keyFields(fields);
  const key = all.filter((f) => e.data[f.key] !== undefined && e.data[f.key] !== null);
  const shown = key.length ? key : fields.filter((f) => f.type !== 'text' && f.type !== 'boolean' && e.data[f.key] !== undefined).slice(0, 3);
  // Sin etiqueta solo si el formulario tiene una única cifra clave (el peso).
  if (shown.length === 1 && all.length === 1) return formatValue(shown[0], e.data[shown[0].key]);
  return shown.slice(0, 4).map((f) => `${shortLabel(f.label)} ${formatValue(f, e.data[f.key])}`).join(' · ');
}

/** "Zepp: duración" → "Duración"; "Calidad del sueño" → "Calidad". */
export function shortLabel(label: string): string {
  const s = label.replace(/^[^:]+:\s*/, '').replace(/\s+(del|de la|de)\s+.*$/i, '').replace(/\s*\(.*\)$/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Filas por semana de una tabla (series de pesas por semana). */
export function rowsPerWeek(field: Pick<Field, 'key'>, entries: Entry[], from: string, to: string): Point[] {
  const byWeek = new Map<string, number>();
  for (let w = weekStart(from); w <= to; w = addWeek(w)) byWeek.set(w, 0);
  for (const e of entries) {
    const rows = e.data[field.key];
    if (!Array.isArray(rows) || e.local_date < from || e.local_date > to) continue;
    const w = weekStart(e.local_date);
    byWeek.set(w, (byWeek.get(w) ?? 0) + rows.length);
  }
  return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

function addWeek(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 7);
  return t.toISOString().slice(0, 10);
}
