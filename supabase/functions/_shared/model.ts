// Tipos compartidos por el dashboard (Vite) y el conector MCP (Deno).
// Reflejan las vistas del esquema `api` (supabase/migrations/20261018000001_core_areas.sql).

export type Status = 'active' | 'archived';
export type Cadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'per_session' | 'free';
export type FieldType =
  | 'number' | 'integer' | 'scale' | 'boolean' | 'text' | 'choice' | 'multi' | 'date' | 'time' | 'duration' | 'table';
export type Quality = 'measured' | 'manual' | 'estimated';
export type Source = 'dashboard' | 'claude' | 'import';

export const FIELD_TYPES: FieldType[] = [
  'number', 'integer', 'scale', 'boolean', 'text', 'choice', 'multi', 'date', 'time', 'duration', 'table',
];
export const CADENCES: Cadence[] = ['daily', 'weekly', 'biweekly', 'monthly', 'per_session', 'free'];
export const NUMERIC_TYPES: FieldType[] = ['number', 'integer', 'scale', 'duration'];

export interface Area {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
  status: Status;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface Form {
  id: string;
  area_id: string;
  slug: string;
  name: string;
  description: string;
  cadence: Cadence;
  sort_order: number;
  status: Status;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface Option {
  value: string;
  label?: string;
}

export interface Column {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  min?: number | null;
  max?: number | null;
  options?: Option[];
  required?: boolean;
}

export interface Field {
  id: string;
  form_id: string;
  key: string;
  label: string;
  help: string;
  type: FieldType;
  unit: string;
  min: number | null;
  max: number | null;
  step: number | null;
  options: Option[];
  columns: Column[];
  required: boolean;
  on_overview: boolean;
  sort_order: number;
  status: Status;
}

export type EntryData = Record<string, unknown>;

export interface Entry {
  id: string;
  form_id: string;
  area_id: string;
  occurred_at: string;
  local_date: string;
  data: EntryData;
  note: string;
  source: Source;
  quality: Quality;
  supersedes_id: string | null;
  actor: string;
  created_at: string;
}

export interface Proposal {
  id: string;
  kind: 'area.save' | 'form.save' | 'field.save' | 'form.archive' | 'field.archive' | 'note';
  payload: Record<string, unknown>;
  payload_hash: string;
  rationale: string;
  status: 'pending' | 'rejected' | 'applied' | 'failed' | 'expired';
  actor: string;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  result: Record<string, unknown> | null;
}

export const CADENCE_LABEL: Record<Cadence, string> = {
  daily: 'Diario',
  weekly: 'Semanal',
  biweekly: 'Cada dos semanas',
  monthly: 'Mensual',
  per_session: 'Por sesión',
  free: 'Libre',
};

export const TYPE_LABEL: Record<FieldType, string> = {
  number: 'Número',
  integer: 'Número entero',
  scale: 'Escala',
  boolean: 'Sí / no',
  text: 'Texto',
  choice: 'Una opción',
  multi: 'Varias opciones',
  date: 'Fecha',
  time: 'Hora',
  duration: 'Duración (min)',
  table: 'Tabla (filas)',
};

export function byOrder<T extends { sort_order: number; name?: string; label?: string }>(a: T, b: T): number {
  return a.sort_order - b.sort_order || String(a.name ?? a.label ?? '').localeCompare(String(b.name ?? b.label ?? ''));
}
