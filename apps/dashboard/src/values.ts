// Conversión entre el estado de los formularios (texto) y los valores JSON que guarda la BD.
// La validación definitiva la hace la base de datos; aquí solo se evitan errores obvios antes de enviar.
import type { Column, EntryData, Field, FieldType } from '@shared/model.ts';

export type Cell = string | string[];
export type Row = Record<string, Cell>;
export type FormState = Record<string, Cell | Row[]>;

/** "7h40", "7:40", "7 h 40" o "460" -> 460 minutos. */
export function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  const hm = t.match(/^(\d+)\s*(?:h|:)\s*(\d{1,2})?\s*(?:m|min)?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const n = Number(t.replace(/\s*min$/, ''));
  return Number.isFinite(n) ? n : NaN;
}

export function parseNumber(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

interface Spec {
  key: string;
  label: string;
  type: FieldType;
  min?: number | null;
  max?: number | null;
  required?: boolean;
  options?: { value: string }[];
}

/** Valor JSON de una celda, o un error en español. undefined = vacío. */
export function toValue(spec: Spec, raw: Cell): { value?: unknown; error?: string } {
  const range = (n: number) =>
    (spec.min != null && n < spec.min) || (spec.max != null && n > spec.max)
      ? `${spec.label}: debe estar entre ${spec.min ?? '−∞'} y ${spec.max ?? '∞'}`
      : undefined;
  switch (spec.type) {
    case 'number':
    case 'integer':
    case 'scale':
    case 'duration': {
      const n = spec.type === 'duration' ? parseDuration(String(raw)) : parseNumber(String(raw));
      if (n === null) return {};
      if (Number.isNaN(n)) return { error: `${spec.label}: no es un número` };
      if (spec.type !== 'number' && spec.type !== 'duration' && !Number.isInteger(n)) {
        return { error: `${spec.label}: debe ser un número entero` };
      }
      const err = range(n);
      return err ? { error: err } : { value: n };
    }
    case 'boolean':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : {};
    case 'multi':
      return Array.isArray(raw) && raw.length ? { value: raw } : {};
    default: {
      const s = String(raw ?? '').trim();
      return s ? { value: s } : {};
    }
  }
}

export function toPayload(fields: Field[], state: FormState): { data: EntryData; errors: string[] } {
  const data: EntryData = {};
  const errors: string[] = [];
  for (const f of fields) {
    const raw = state[f.key];
    if (f.type === 'table') {
      const rows: Record<string, unknown>[] = [];
      for (const [i, row] of ((raw as Row[] | undefined) ?? []).entries()) {
        const out: Record<string, unknown> = {};
        for (const c of f.columns) {
          const r = toValue(c, row[c.key] ?? '');
          if (r.error) errors.push(`${f.label}, fila ${i + 1}: ${r.error}`);
          else if (r.value !== undefined) out[c.key] = r.value;
        }
        if (Object.keys(out).length) {
          for (const c of f.columns) {
            if (c.required && out[c.key] === undefined) errors.push(`${f.label}, fila ${i + 1}: falta ${c.label}`);
          }
          rows.push(out);
        }
      }
      if (rows.length) data[f.key] = rows;
      else if (f.required) errors.push(`${f.label}: es obligatorio`);
      continue;
    }
    const r = toValue(f, (raw as Cell | undefined) ?? '');
    if (r.error) errors.push(r.error);
    else if (r.value !== undefined) data[f.key] = r.value;
    else if (f.required) errors.push(`${f.label}: es obligatorio`);
  }
  if (!errors.length && !Object.keys(data).length) errors.push('Rellena al menos un dato');
  return { data, errors };
}

function toCell(type: FieldType, v: unknown): Cell {
  if (v === null || v === undefined) return type === 'multi' ? [] : '';
  if (type === 'multi') return Array.isArray(v) ? v.map(String) : [];
  if (type === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

export function fromData(fields: Field[], data: EntryData): FormState {
  const state: FormState = {};
  for (const f of fields) {
    const v = data[f.key];
    if (f.type === 'table') {
      state[f.key] = Array.isArray(v)
        ? v.map((row) => Object.fromEntries(f.columns.map((c: Column) => [c.key, toCell(c.type, (row as Record<string, unknown>)[c.key])])))
        : [];
    } else {
      state[f.key] = toCell(f.type, v);
    }
  }
  return state;
}

export function emptyRow(columns: Column[]): Row {
  return Object.fromEntries(columns.map((c) => [c.key, c.type === 'multi' ? [] : ''])) as Row;
}

/** "Sueño de calidad" -> "sueno-de-calidad" (sep "-") o "sueno_de_calidad" (sep "_"). */
export function slugify(s: string, sep: '-' | '_' = '-'): string {
  const base = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^\\${sep}+|\\${sep}+$`, 'g'), '');
  return (sep === '_' && /^[0-9]/.test(base) ? `c_${base}` : base).slice(0, 40);
}

/** Texto "valor = Etiqueta" o "Etiqueta" por línea -> opciones. */
export function parseOptions(text: string): { value: string; label: string }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.+?)\s*=\s*(.+)$/);
      return m ? { value: m[1].trim(), label: m[2].trim() } : { value: slugify(l, '_') || l, label: l };
    });
}

export function optionsToText(options: { value: string; label?: string }[]): string {
  return options.map((o) => (o.label && o.label !== o.value ? `${o.value} = ${o.label}` : o.value)).join('\n');
}
