// Resumen al terminar la sesión: qué has hecho, qué has mejorado respecto a la última vez y qué toca la próxima.
import type { Entry } from '@shared/model.ts';
import type { Exercise, TrainingMode } from '@shared/plans.ts';
import { exposuresFor, suggest, type Exposure } from '@shared/progression.ts';

export interface DoneLine {
  key: string;
  name: string;
  machine?: string;
  sets: { kg: number | null; reps: number | null; rir: number | null }[];
}

export interface LineSummary {
  name: string;
  /** Lo de hoy: "70 kg × 10, 10, 9". */
  today: string;
  /** Comparación con la última vez. */
  change: string;
  /** true mejor, false peor, null sin comparación o igual. */
  better: boolean | null;
  /** Lo que dice la regla para la próxima sesión ("Sube a 72,5 kg"). */
  next: string;
}

export interface SessionSummary {
  minutes: number | null;
  setsDone: number;
  setsPlanned: number;
  /** Kilos movidos (carga × reps) en las series con carga. */
  volume: number;
  improved: number;
  lines: LineSummary[];
}

const fmt = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
const first = (e: Exposure) => e.sets.map((s) => s.kg).find((k): k is number => k !== null) ?? null;
const repsOf = (e: Exposure, n: number) => e.sets.slice(0, n).reduce((a, s) => a + (s.reps ?? 0), 0);

function todayText(e: Exposure): string {
  const kgs = e.sets.map((s) => s.kg);
  const same = kgs.every((k) => k === kgs[0]);
  if (same) return `${kgs[0] !== null ? `${fmt(kgs[0])} kg × ` : ''}${e.sets.map((s) => s.reps ?? '–').join(', ')}`;
  return e.sets.map((s) => `${s.kg !== null ? fmt(s.kg) : '–'}×${s.reps ?? '–'}`).join(' · ');
}

export function sessionSummary(args: {
  date: string;
  exercises: Exercise[];
  lines: DoneLine[];
  history: Entry[];
  mode: TrainingMode;
  setsPlanned: number;
  startedAt: string | null;
  endedAt: Date;
}): SessionSummary {
  const past = args.history.filter((e) => e.local_date < args.date);
  const lines: LineSummary[] = [];
  let volume = 0;
  let setsDone = 0;
  for (const l of args.lines) {
    const sets = l.sets.filter((s) => s.reps !== null);
    if (!sets.length) continue;
    setsDone += sets.length;
    volume += sets.reduce((a, s) => a + (s.kg ?? 0) * (s.reps ?? 0), 0);
    const ex = args.exercises.find((x) => x.key === l.key);
    const now: Exposure = { date: args.date, sets: sets.map((s) => ({ ...s, molestia: null })), ...(l.machine ? { machine: l.machine } : {}) };
    const prevs = ex ? exposuresFor(ex, past) : [];
    const prev = prevs[0];
    let change = 'Primera vez: carga de referencia';
    let better: boolean | null = null;
    if (prev) {
      const [a, b] = [first(now), first(prev)];
      if (a !== null && b !== null && a > b) { change = `Subes de ${fmt(b)} a ${fmt(a)} kg`; better = true; }
      else if (a !== null && b !== null && a < b) { change = `Bajas de ${fmt(b)} a ${fmt(a)} kg`; better = false; }
      else {
        const n = Math.min(now.sets.length, prev.sets.length);
        const d = repsOf(now, n) - repsOf(prev, n);
        if (d > 0) { change = `+${d} ${d === 1 ? 'rep' : 'reps'} respecto al ${prev.date.slice(8)}/${prev.date.slice(5, 7)}`; better = true; }
        else if (d < 0) { change = `${d} ${d === -1 ? 'rep' : 'reps'} respecto al ${prev.date.slice(8)}/${prev.date.slice(5, 7)}`; better = false; }
        else change = 'Igual que la última vez';
      }
    }
    const next = ex ? suggest(ex, [now, ...prevs], 'normal', args.mode).title : '';
    lines.push({ name: l.name, today: todayText(now), change, better, next });
  }
  const minutes = args.startedAt ? Math.max(0, Math.round((args.endedAt.getTime() - Date.parse(args.startedAt)) / 60000)) : null;
  return { minutes, setsDone, setsPlanned: args.setsPlanned, volume: Math.round(volume), improved: lines.filter((x) => x.better).length, lines };
}
