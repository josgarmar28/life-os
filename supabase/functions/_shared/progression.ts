// Doble progresión por línea y lectura del cuestionario previo (entrenamiento/05 §2, §9.1 y §9.4).
// Es una ayuda en la sala, no una decisión: muestra lo que dice la regla con tus últimos datos.
import type { Entry } from './model.ts';
import type { Exercise, LoadKind } from './plans.ts';

export interface SetLog {
  kg: number | null;
  reps: number | null;
  rir: number | null;
  molestia: number | null;
}

export interface Exposure {
  date: string;
  sets: SetLog[];
}

export type Readiness = 'normal' | 'baja' | 'minima';

/** Cuestionario de 30 s: cinco ítems de 1 a 5 (5 = mejor). §9.1. Sin respuestas = normal. */
export function readiness(items: (number | null)[], dolor: number | null): { level: Readiness; text: string } {
  const vals = items.filter((v): v is number => v !== null);
  if (vals.length < items.length) return { level: 'normal', text: 'Sin cuestionario completo: sesión normal.' };
  const low = vals.filter((v) => v <= 2).length;
  const sum = vals.reduce((a, b) => a + b, 0);
  if (low >= 3 || sum <= 10 || dolor === 1) {
    return { level: 'minima', text: 'Sesión mínima: una serie menos por ejercicio (mínimo 2 en abdomen y en el primero), RIR 2-3 y sin subidas.' };
  }
  if (low >= 2 || sum <= 12) {
    return { level: 'baja', text: 'Baja confianza: la carga prevista, sin subir hoy y RIR +1 en compuestos.' };
  }
  return { level: 'normal', text: 'Sesión normal.' };
}

/** Series que tocan hoy según el cuestionario (§9.1, sesión mínima). */
export function setsToday(ex: Exercise, level: Readiness, isFirst: boolean): number {
  const n = ex.sets ?? 0;
  if (level !== 'minima') return n;
  const floor = isFirst || /abdomen/i.test(ex.muscle ?? '') ? 2 : 1;
  return Math.max(Math.min(n, floor), n - 1);
}

/** Últimas exposiciones de una línea (más reciente primero) a partir de las sesiones guardadas. */
export function exposuresFor(ex: Pick<Exercise, 'key' | 'name'>, sessions: Entry[], limit = 3): Exposure[] {
  const out: Exposure[] = [];
  const sorted = [...sessions].sort((a, b) => b.local_date.localeCompare(a.local_date) || b.occurred_at.localeCompare(a.occurred_at));
  for (const s of sorted) {
    const rows = Array.isArray(s.data.series) ? (s.data.series as Record<string, unknown>[]) : [];
    const mine = rows.filter((r) => (r.linea ? r.linea === ex.key : r.ejercicio === ex.name));
    if (!mine.length) continue;
    const n = (v: unknown) => (typeof v === 'number' ? v : null);
    out.push({ date: s.local_date, sets: mine.map((r) => ({ kg: n(r.carga_kg), reps: n(r.reps), rir: n(r.rir), molestia: n(r.molestia) })) });
    if (out.length >= limit) break;
  }
  return out;
}

export type Action = 'calibrar' | 'subir' | 'repetir' | 'mantener' | 'revisar' | 'parar';

export interface Suggestion {
  action: Action;
  /** Carga propuesta (kg) o null si depende de la máquina. */
  kg: number | null;
  title: string;
  why: string;
}

function loadOf(e: Exposure): number | null {
  const kgs = e.sets.map((s) => s.kg).filter((k): k is number => k !== null);
  return kgs.length ? kgs[0] : null;
}

function meetsCriterion(e: Exposure, ex: Exercise): boolean {
  const [, hi] = ex.reps!;
  const rirMin = ex.rir?.[0] ?? 0;
  const sets = e.sets.slice(0, ex.sets);
  if (sets.length < (ex.sets ?? 1)) return false;
  const total = sets.reduce((a, s) => a + (s.reps ?? 0), 0);
  return total >= sets.length * hi && sets.every((s) => (s.reps ?? 0) >= hi - 1 && s.rir !== null && s.rir >= rirMin);
}

function shortcut(e: Exposure, ex: Exercise): boolean {
  const [, hi] = ex.reps!;
  const rirMin = ex.rir?.[0] ?? 0;
  const sets = e.sets.slice(0, ex.sets);
  return sets.length >= (ex.sets ?? 1) && sets.every((s) => (s.reps ?? 0) >= hi + 2 && s.rir !== null && s.rir >= rirMin);
}

/** Escalón de carga por tipo (§2.2). null = siguiente placa o par: depende de la máquina. */
export function loadStep(kind: LoadKind | undefined, kg: number): { kg: number | null; text: string } {
  switch (kind ?? 'discos') {
    case 'discos':
      if (kg < 20) return { kg: 0.5, text: '+0,4-1 kg (simétrico)' };
      if (kg < 60) return { kg: 1.5, text: '+1-2 kg (simétrico)' };
      if (kg < 120) return { kg: 2.5, text: '+2-4 kg (simétrico)' };
      return { kg: 4, text: '+4-5 kg (simétrico)' };
    case 'barra':
      return { kg: 2, text: '+1-2,5 kg' };
    case 'hack':
      return { kg: 2.5, text: '+2-5 kg' };
    case 'hibrida':
      return { kg: null, text: 'primero repeticiones; el stack (~2,27 kg) solo si es ≤5 % de la carga' };
    case 'mancuerna':
      return { kg: null, text: 'siguiente par; si el salto es >10 %, amplía el techo +3-4 reps' };
    case 'corporal':
      return { kg: null, text: 'más inclinación o 1-2 kg entre los pies' };
    default:
      return { kg: null, text: 'siguiente placa del selector o de la polea' };
  }
}

const round = (x: number) => Math.round(x * 10) / 10;
const fmt = (x: number) => String(round(x)).replace('.', ',');

export function suggest(ex: Exercise, history: Exposure[], level: Readiness): Suggestion {
  if (!ex.reps || !ex.sets) return { action: 'repetir', kg: null, title: 'Según el plan', why: '' };
  const [lo, hi] = ex.reps;
  const last = history[0];
  if (!last) {
    return {
      action: 'calibrar', kg: null, title: 'Primera vez: calibra la carga',
      why: `Busca una carga que te deje en ${lo}-${hi} reps con RIR ${ex.rir ? `${ex.rir[0]}-${ex.rir[1]}` : 'objetivo'}. Las semanas 1-2 no cuentan para estancamiento.`,
    };
  }
  const pain = Math.max(...last.sets.map((s) => s.molestia ?? 0));
  const kg = loadOf(last);
  if (pain >= 5) {
    return { action: 'parar', kg: null, title: 'Molestia roja la última vez', why: `Llegaste a ${pain}/10. No repitas este ejercicio sin valoración profesional.` };
  }
  if (pain >= 3) {
    return {
      action: 'revisar', kg: kg !== null ? round(kg * 0.85) : null, title: 'Molestia ámbar: no progresa',
      why: `La última vez ${pain}/10. Ajusta tope, asiento o agarre, o baja un 10-20 %. Si sigue ≥3, para este ejercicio.`,
    };
  }
  const lastText = `${last.date.slice(8)}/${last.date.slice(5, 7)}: ${kg !== null ? `${fmt(kg)} kg × ` : ''}${last.sets.map((s) => s.reps ?? '–').join(', ')}`;
  const sameLoad = history[1] && loadOf(history[1]) === kg;
  const up = shortcut(last, ex) || (meetsCriterion(last, ex) && sameLoad && meetsCriterion(history[1], ex));
  if (up) {
    if (level !== 'normal') {
      return { action: 'mantener', kg, title: 'Tocaba subir, hoy no', why: `Cumpliste el criterio (${lastText}), pero el cuestionario dice ${level === 'baja' ? 'baja confianza' : 'sesión mínima'}: misma carga.` };
    }
    const step = loadStep(ex.load, kg ?? 0);
    return {
      action: 'subir', kg: kg !== null && step.kg !== null ? round(kg + step.kg) : null,
      title: kg !== null && step.kg !== null ? `Sube a ${fmt(kg + step.kg)} kg` : 'Sube carga',
      why: `${lastText}: cumples el criterio. Escalón ${step.text}; vuelve a la parte baja del rango (serie 1 ≥ ${lo + 1}).`,
    };
  }
  const target = last.sets.slice(0, ex.sets).findIndex((s) => (s.reps ?? 0) < hi);
  const goal = target >= 0 ? `+1 rep en la serie ${target + 1} (${(last.sets[target].reps ?? 0) + 1})` : `${hi} reps en todas`;
  return {
    action: 'repetir', kg, title: kg !== null ? `Repite ${fmt(kg)} kg` : 'Repite la carga',
    why: `${lastText}. Objetivo: ${goal}.${meetsCriterion(last, ex) ? ' Si lo vuelves a cumplir, la próxima sube.' : ''}`,
  };
}
