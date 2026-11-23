// Modo entreno: la sesión del día serie a serie, con la última vez, la sugerencia de la doble
// progresión, el descanso y el registro de molestias. Funciona sin cobertura: el borrador se guarda
// en el teléfono a cada toque y, al terminar, el registro va a la cola si no hay red.
import { useEffect, useMemo, useRef, useState } from 'react';
import { beep, unlockAudio, useFocusMode, useTick, useWakeLock } from '../workout';
import type { Entry, Field } from '@shared/model.ts';
import { addDays, localDate } from '@shared/stats.ts';
import { gymForDate, HOME_GYM, isoWeekday, localTime, trainingGyms, WEEKDAY_NAME, WEEKDAY_SHORT, type Exercise, type TrainingDay, type TrainingMode, type TrainingPlan, type Weekday } from '@shared/plans.ts';
import { exposuresFor, kgStep, machineChanged, machineOptions, readiness, setsToday, suggest, type Exposure, type Readiness } from '@shared/progression.ts';
import { loadEntries, useStructure } from '../data';
import { Link, navigate } from '../router';
import { explainError, rpc } from '../supabase';
import { send } from '../outbox';
import { shortDate, usePlans } from '../plans';

interface SetDraft { kg: string; reps: string; rir: string; molestia: string; zona: string; done: boolean }
interface LineDraft { key: string; name: string; machine: string; sets: SetDraft[] }
interface Draft {
  date: string;
  /** Gimnasio (slug); los borradores antiguos no lo tienen = el de casa. */
  gym?: string;
  template: Weekday;
  startedAt: string | null;
  pre: (number | null)[];
  lines: LineDraft[];
  cardio: Record<string, { minutes: string; rpe: string; done: boolean }>;
  notes: string;
  requestId: string;
  cardioRequestId: string;
}

const PRE = [
  { key: 'pre_sueno', label: 'Sueño' },
  { key: 'pre_estres', label: 'Estrés (5 = nada)' },
  { key: 'pre_dolor', label: 'Dolor muscular (5 = nada)' },
  { key: 'pre_energia', label: 'Energía' },
  { key: 'pre_motivacion', label: 'Motivación' },
];
const HISTORY_KEY = 'lifeos.workouts';
const draftKey = (date: string) => `lifeos.workout.${date}`;
const num = (s: string) => { const t = s.trim().replace(',', '.'); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
const fmtKg = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
/** Primera serie sin hacer de la sesión (línea y serie), o null si está todo hecho. */
function firstPending(d: Draft | null): { line: number; set: number } | null {
  if (!d) return null;
  for (let li = 0; li < d.lines.length; li++) {
    const si = d.lines[li].sets.findIndex((x) => !x.done);
    if (si >= 0) return { line: li, set: si };
  }
  return null;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;

function readJson<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}
function writeJson(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
}

function newDraft(date: string, gym: string, mode: TrainingMode, day: TrainingDay, history: Entry[], level: Readiness): Draft {
  const lifts = day.exercises.filter((x) => x.type === 'compuesto' || x.type === 'aislamiento');
  return {
    date, gym, template: day.weekday, startedAt: null, pre: PRE.map(() => null), notes: '',
    requestId: crypto.randomUUID(), cardioRequestId: crypto.randomUUID(),
    lines: lifts.map((ex, i) => {
      const hist = exposuresFor(ex, history);
      const sug = suggest(ex, hist, level, mode);
      const kg = sug.kg ?? hist[0]?.sets[0]?.kg ?? null;
      // Serie en un toque: carga sugerida y, si toca repetir o mantener, las reps y el RIR de la última vez.
      const same = sug.action === 'repetir' || sug.action === 'mantener';
      const prev = (j: number, k: 'reps' | 'rir') => { const v = same ? hist[0]?.sets[j]?.[k] : null; return v === null || v === undefined ? '' : String(v); };
      return {
        key: ex.key, name: ex.name, machine: machineOptions(ex.machine)[0] ?? '',
        sets: Array.from({ length: setsToday(ex, level, i === 0) }, (_, j) => ({ kg: kg !== null ? fmtKg(kg) : '', reps: prev(j, 'reps'), rir: prev(j, 'rir'), molestia: '', zona: '', done: false })),
      };
    }),
    cardio: Object.fromEntries(day.exercises.filter((x) => x.type === 'cardio' || x.type === 'movilidad')
      .map((x) => [x.key, { minutes: x.minutes ? String(x.minutes) : '', rpe: '', done: false }])),
  };
}

export function Training({ date: initial }: { date?: string }) {
  const s = useStructure();
  const p = usePlans();
  const today = localDate(new Date(), s.timezone);
  const date = initial ?? today;

  const area = s.areas.find((a) => a.slug === 'entreno');
  const sesionForm = s.forms.find((f) => f.area_id === area?.id && f.slug === 'sesion');
  const cardioForm = s.forms.find((f) => f.area_id === area?.id && f.slug === 'cardio');

  // Historial de sesiones (para "la última vez"), también guardado en el teléfono para el gimnasio sin red.
  const [history, setHistory] = useState<Entry[]>(() => readJson<Entry[]>(HISTORY_KEY) ?? []);
  useEffect(() => {
    if (!sesionForm) return;
    void loadEntries({ formIds: [sesionForm.id], from: addDays(today, -180), to: today })
      .then((rows) => { setHistory(rows); writeJson(HISTORY_KEY, rows); })
      .catch(() => { /* sin red: se usa la copia */ });
  }, [sesionForm?.id, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const [draft, setDraftState] = useState<Draft | null>(() => readJson<Draft>(draftKey(date)));
  const setDraft = (d: Draft | null) => {
    setDraftState(d);
    if (d) writeJson(draftKey(d.date), d);
    else try { localStorage.removeItem(draftKey(date)); } catch { /* nada */ }
  };

  // Un plan de entreno por gimnasio; cada uno con su historial (las líneas tienen claves propias).
  // El del día sale de los periodos ("en España del X al Y"); se puede cambiar para una sesión suelta.
  const gyms = useMemo(() => trainingGyms(p.plans, date), [p.plans, date]);
  const [chosenGym, setChosenGym] = useState<string | null>(null);
  const dayGym = gymForDate(p.periods, date);
  const wanted = draft?.gym ?? chosenGym ?? dayGym;
  const current = gyms.find((g) => g.gym === wanted) ?? gyms[0] ?? null;
  const gym = current?.gym ?? HOME_GYM;
  const plan: TrainingPlan | null = current?.plan.content ?? null;
  const mode: TrainingMode = current?.mode ?? 'progresion';

  const weekday = isoWeekday(date);
  const template = draft?.template ?? (plan?.days.find((d) => d.weekday === weekday) ? weekday : null);
  const day = plan?.days.find((d) => d.weekday === template) ?? null;

  const level = draft ? readiness(draft.pre, draft.pre[2]) : { level: 'normal' as Readiness, text: '' };
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(() => firstPending(readJson<Draft>(draftKey(date)))?.line ?? 0);
  /** Serie que se corrige tocando su fila; si no, se edita la primera sin hacer de la línea abierta. */
  const [editing, setEditing] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [preOpen, setPreOpen] = useState(false);
  const timer = useRest();
  const active = Boolean(draft);
  useWakeLock(active);
  useFocusMode(active);
  const now = useTick(active);
  // Tras marcar una serie, la siguiente queda a la vista (sin buscarla con el dedo).
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!draft) { lastFocus.current = null; return; }
    const el = document.querySelector('.set-editor');
    const key = el?.getAttribute('data-focus') ?? null;
    if (el && lastFocus.current !== null && key !== lastFocus.current) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    lastFocus.current = key ?? '';
  });

  if (!plan && !p.loading) {
    return <main><header className="page-head"><h1>Entreno</h1></header><p>Aún no hay rutina. Impórtala en <Link to="/ajustes">Ajustes → Planes</Link> o pídesela a Claude.</p></main>;
  }
  if (!sesionForm) return <main><h1>Entreno</h1><p className="error">Falta el cuestionario Entrenamiento › Sesión de pesas.</p></main>;

  function start(d: TrainingDay) {
    setDraft(newDraft(date, gym, mode, d, history, 'normal'));
    setOpen(0);
  }

  const update = (fn: (d: Draft) => void) => {
    if (!draft) return;
    const copy = structuredClone(draft);
    fn(copy);
    setDraft(copy);
  };

  async function finish() {
    if (!draft || !day) return;
    const errs: string[] = [];
    const seriesField = s.fields.find((f) => f.form_id === sesionForm!.id && f.key === 'series' && f.status === 'active');
    const cols = new Set(seriesField?.columns.map((c) => c.key) ?? []);
    const rows: Record<string, unknown>[] = [];
    for (const l of draft.lines) {
      l.sets.forEach((st, i) => {
        if (!st.done && !st.reps.trim()) return;
        const [kg, reps, rir, mol] = [num(st.kg), num(st.reps), num(st.rir), num(st.molestia)];
        if (reps === null || Number.isNaN(reps)) errs.push(`${l.name}, serie ${i + 1}: faltan las repeticiones`);
        if ([kg, rir, mol].some((x) => Number.isNaN(x))) errs.push(`${l.name}, serie ${i + 1}: algún número no es válido`);
        const row: Record<string, unknown> = { ejercicio: l.name, maquina: l.machine || undefined, carga_kg: kg ?? undefined, reps: reps ?? undefined, rir: rir ?? undefined,
          molestia: mol ?? undefined, zona: st.zona.trim() || undefined, linea: l.key };
        rows.push(Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== undefined && cols.has(k))));
      });
    }
    const cardioItems = day.exercises.filter((x) => x.type === 'cardio' && num(draft.cardio[x.key]?.minutes ?? '') !== null);
    if (!rows.length && !cardioItems.length) errs.push('No hay nada que guardar: marca al menos una serie o el cardio.');
    setErrors(errs);
    if (errs.length) return;

    setBusy(true);
    const now = new Date();
    const occurredAt = date === today ? now.toISOString() : new Date(`${date}T08:00:00`).toISOString();
    const fieldsOf = (formId: string) => new Set(s.fields.filter((f: Field) => f.form_id === formId && f.status === 'active').map((f) => f.key));
    const pick = (formId: string, values: Record<string, unknown>) => {
      const keys = fieldsOf(formId);
      return Object.fromEntries(Object.entries(values).filter(([k, v]) => keys.has(k) && v !== null && v !== undefined && v !== ''));
    };
    let queued = false;
    try {
      if (rows.length) {
        const values = pick(sesionForm!.id, {
          ...Object.fromEntries(PRE.map((q, i) => [q.key, draft.pre[i]])),
          gimnasio: draft.gym ?? HOME_GYM,
          inicio: draft.startedAt ? localTime(new Date(draft.startedAt), s.timezone) : null,
          fin: date === today ? localTime(now, s.timezone) : null,
          series: rows,
          observaciones: draft.notes.trim() || null,
        });
        const r = await send('add_entry', {
          p_form_id: sesionForm!.id, p_values: values, p_request_id: draft.requestId, p_occurred_at: occurredAt,
          p_local_date: date, p_note: `${day.name}${level.level !== 'normal' ? ` · ${level.level === 'baja' ? 'baja confianza' : 'sesión mínima'}` : ''}`,
          p_quality: 'manual', p_supersedes_id: null,
        }, `🏋️ ${day.name} ${date}`);
        queued ||= r === 'queued';
      }
      if (cardioItems.length && cardioForm) {
        const main = cardioItems[0];
        const c = draft.cardio[main.key];
        const abs = draft.lines.filter((l) => /abdomen/i.test(day.exercises.find((x) => x.key === l.key)?.muscle ?? ''))
          .reduce((a, l) => a + l.sets.filter((st) => st.done || st.reps.trim()).length, 0);
        const mob = day.exercises.filter((x) => x.type === 'movilidad').some((x) => draft.cardio[x.key]?.done);
        const r = await send('add_entry', {
          p_form_id: cardioForm.id,
          p_values: pick(cardioForm.id, {
            tipo: main.key === 'airbike' ? 'airbike' : main.key === 'paseo' ? 'paseo' : 'otro',
            duracion: num(c.minutes), esfuerzo: num(c.rpe), abdomen_series: abs || null, movilidad: mob,
          }),
          p_request_id: draft.cardioRequestId, p_occurred_at: occurredAt, p_local_date: date, p_note: day.name, p_quality: 'manual', p_supersedes_id: null,
        }, `🚴 ${day.name} ${date}`);
        queued ||= r === 'queued';
      }
      setDraft(null);
      timer.stop();
      if (queued) alert('Sin conexión: la sesión queda guardada en el teléfono y se enviará sola al volver la conexión.');
      navigate('/a/entreno');
    } catch (e) {
      setErrors([explainError(e)]);
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <header className="page-head">
      <h1>Entreno</h1>
      <p className="muted cap">{shortDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}{day ? ` · ${day.name}` : ''}</p>
      {gyms.length > 1 && draft ? <p className="muted small">{current?.label}{mode === 'mantenimiento' ? ' · mantenimiento' : ''}</p> : null}
      {current?.plan.preview ? <p className="banner">Vista previa: esta rutina empieza el {shortDate(current.plan.row.valid_from, { day: 'numeric', month: 'long' })}.</p> : null}
    </header>
  );

  if (!draft) {
    const others = plan?.days.filter((d) => d.kind !== 'descanso') ?? [];
    return (
      <main>
        {header}
        {gyms.length > 1 ? (
          <section className="card">
            <h2>Gimnasio</h2>
            <div className="chips" role="radiogroup" aria-label="Gimnasio">
              {gyms.map((g) => (
                <button key={g.gym} type="button" role="radio" aria-checked={g.gym === gym} className={g.gym === gym ? 'chip on' : 'chip'}
                  onClick={() => setChosenGym(g.gym)}>{g.label}</button>
              ))}
            </div>
            {gym !== dayGym ? <p className="muted small">Cambio solo para esta sesión: este día es de {gyms.find((g) => g.gym === dayGym)?.label ?? dayGym}.</p> : null}
            {mode === 'mantenimiento' ? <p className="muted small">Mantenimiento: misma carga que la última vez aquí, RIR 1-2 y sin fallo. Su progreso va aparte y no decide escalones de {gyms.find((g) => g.gym === HOME_GYM)?.label ?? 'casa'}.</p> : null}
          </section>
        ) : null}
        {day && day.kind !== 'descanso' ? (
          <section className="card">
            <h2>{day.name}</h2>
            {day.notes ? <p className="muted small">{day.notes}</p> : null}
            <ol className="plan-list">
              {day.exercises.map((x) => <li key={x.key}><span className="grow">{x.name}{x.machine ? <span className="muted small"> · {x.machine}</span> : null}</span><span className="muted small">{target(x)}</span></li>)}
            </ol>
            {date > today ? <p className="muted small">Es un día futuro: aquí ves lo que toca; el registro se abre ese día.</p>
              : <button className="btn primary wide" onClick={() => start(day)}>Empezar</button>}
          </section>
        ) : <p>Hoy no toca sesión{day ? ` (${day.name})` : ''}.</p>}
        {others.length && date <= today ? (
          <details className="card">
            <summary>Hacer otra sesión (cambio de día)</summary>
            <div className="chips">{others.map((d) => <button key={d.weekday} className="chip" onClick={() => start(d)}>{WEEKDAY_SHORT[d.weekday]} · {d.name}</button>)}</div>
          </details>
        ) : null}
        {gyms.length > 1 ? <GymPeriods gyms={gyms.filter((g) => g.gym !== HOME_GYM)} today={today} /> : null}
        <p className="muted small"><Link to={`/entreno/${addDays(date, -1)}`}>← {WEEKDAY_NAME[isoWeekday(addDays(date, -1))]}</Link> · <Link to={`/entreno/${addDays(date, 1)}`}>{WEEKDAY_NAME[isoWeekday(addDays(date, 1))]} →</Link></p>
      </main>
    );
  }

  function doneSet(li: number, i: number) {
    if (!draft) return;
    const l = draft.lines[li];
    const st = l.sets[i];
    const reps = num(st.reps);
    if (reps === null || Number.isNaN(reps)) { setHint(`${l.name}, serie ${i + 1}: pon las repeticiones.`); return; }
    if ([num(st.kg), num(st.rir), num(st.molestia)].some((x) => Number.isNaN(x))) { setHint(`${l.name}, serie ${i + 1}: algún número no es válido.`); return; }
    setHint(null);
    unlockAudio();
    const wasDone = st.done;
    update((d) => {
      d.lines[li].sets[i].done = true;
      if (!d.startedAt) d.startedAt = new Date().toISOString();
      const next = d.lines[li].sets[i + 1];
      if (next && !next.kg && d.lines[li].sets[i].kg) next.kg = d.lines[li].sets[i].kg;
    });
    setEditing(null);
    if (wasDone) return; // corrección de una serie ya hecha: ni descanso ni cambio de ejercicio
    timer.start(day?.exercises.find((x) => x.key === l.key)?.rest_s ?? 120);
    if (!l.sets.some((x, j) => j !== i && !x.done)) {
      const nextLine = draft.lines.findIndex((x, j) => j > li && x.sets.some((y) => !y.done));
      if (nextLine >= 0) setOpen(nextLine);
    }
  }

  const discard = () => { if (confirm('¿Descartar esta sesión sin guardar?')) { setDraft(null); timer.stop(); } };
  const openLine = draft.lines[open];
  const pendingIdx = openLine ? openLine.sets.findIndex((x) => !x.done) : -1;
  const activeSet = openLine ? (editing ?? (pendingIdx >= 0 ? pendingIdx : null)) : null;
  const cur = openLine && activeSet !== null ? openLine.sets[activeSet] : null;
  const totalSets = draft.lines.reduce((a, l) => a + l.sets.length, 0);
  const doneSets = draft.lines.reduce((a, l) => a + l.sets.filter((x) => x.done).length, 0);
  const elapsed = draft.startedAt ? Math.max(0, Math.floor((now - Date.parse(draft.startedAt)) / 1000)) : 0;
  const preDone = draft.pre.every((v) => v !== null);
  const finishBtn = (cls: string) => <button className={cls} disabled={busy} onClick={() => void finish()}>{busy ? 'Guardando…' : 'Terminar y guardar'}</button>;

  return (
    <main className="workout">
      <header className="page-head workout-head">
        <h1>{day?.name ?? 'Entreno'}</h1>
        <p className="muted small">{shortDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}{gyms.length > 1 ? ` · ${current?.label}${mode === 'mantenimiento' ? ' (mantenimiento)' : ''}` : ''}</p>
      </header>
      <div className="session-bar">
        {timer.left !== null ? (
          <div className={timer.left <= 0 ? 'rest-bar done' : 'rest-bar'} role="timer" aria-live="polite">
            <span className="grow">{timer.left > 0 ? <>Descanso <strong>{mmss(timer.left)}</strong></> : <strong>¡Siguiente serie!</strong>}</span>
            {timer.left > 0 ? <>
              <button className="btn ghost" onClick={() => timer.add(-15)}>−15 s</button>
              <button className="btn ghost" onClick={() => timer.add(15)}>+15 s</button>
            </> : null}
            <button className="btn" onClick={() => timer.stop()}>{timer.left > 0 ? 'Saltar' : 'Vale'}</button>
          </div>
        ) : (
          <div className="progress-line">
            <span className="grow">Ejercicio {Math.min(open + 1, draft.lines.length || 1)} de {draft.lines.length || 1} · {doneSets}/{totalSets} series</span>
            <span className="muted tabular" aria-label="Tiempo de sesión">{mmss(elapsed)}</span>
          </div>
        )}
        <div className="progress" aria-hidden="true"><span style={{ width: `${totalSets ? (100 * doneSets) / totalSets : 0}%` }} /></div>
      </div>

      <section className="card">
        {preDone && !preOpen ? (
          <div className="row gap">
            <span className="grow small">Antes de empezar: {draft.pre.join(' · ')}.{level.level === 'normal' ? ` ${level.text}` : ''}</span>
            <button className="btn small ghost" onClick={() => setPreOpen(true)}>Cambiar</button>
          </div>
        ) : (
          <>
            <h2>Antes de empezar (30 s)</h2>
            {PRE.map((q, i) => (
              <div key={q.key} className="pre-row">
                <span className="grow small">{q.label}</span>
                <div className="chips tight" role="radiogroup" aria-label={q.label}>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={draft.pre[i] === v} className={draft.pre[i] === v ? 'chip on' : 'chip'}
                      onClick={() => update((d) => { d.pre[i] = d.pre[i] === v ? null : v; if (!d.startedAt) d.startedAt = new Date().toISOString(); })}>{v}</button>
                  ))}
                </div>
              </div>
            ))}
            {preDone ? <button className="btn small" onClick={() => setPreOpen(false)}>Listo</button> : null}
          </>
        )}
        {level.level !== 'normal' ? <p className="banner">{level.text}</p> : !preDone || preOpen ? <p className="muted small">{level.text}</p> : null}
      </section>

      {draft.lines.map((l, li) => {
        const ex = day?.exercises.find((x) => x.key === l.key);
        if (!ex) return null;
        const hist = exposuresFor(ex, history);
        return <LineCard key={l.key} ex={ex} line={l} hist={hist} level={level.level} mode={mode} open={open === li}
          activeSet={open === li ? activeSet : null}
          onOpen={() => { setOpen(li); setEditing(null); setHint(null); }}
          onEdit={(i) => { setEditing(i); setHint(null); }}
          onChange={(fn) => update((d) => fn(d.lines[li]))} />;
      })}

      {day?.exercises.filter((x) => x.type === 'cardio' || x.type === 'movilidad').map((x) => {
        const c = draft.cardio[x.key] ?? { minutes: '', rpe: '', done: false };
        return (
          <section key={x.key} className="card">
            <h2>{x.name}</h2>
            {x.notes ? <p className="muted small">{x.notes}</p> : null}
            {x.type === 'cardio' ? (
              <div className="row gap">
                <label className="grow">Minutos<input inputMode="decimal" value={c.minutes} onChange={(e) => update((d) => { d.cardio[x.key] = { ...c, minutes: e.target.value }; })} /></label>
                <label className="grow">Esfuerzo (RPE 1-10)<input inputMode="numeric" value={c.rpe} onChange={(e) => update((d) => { d.cardio[x.key] = { ...c, rpe: e.target.value }; })} /></label>
              </div>
            ) : (
              <label className="check"><input type="checkbox" checked={c.done} onChange={(e) => update((d) => { d.cardio[x.key] = { ...c, done: e.target.checked }; })} /> Hecha{x.minutes ? ` (${x.minutes} min)` : ''}</label>
            )}
          </section>
        );
      })}

      <section className="card">
        <label>Observaciones<textarea rows={2} value={draft.notes} onChange={(e) => update((d) => { d.notes = e.target.value; })} /></label>
      </section>
      {errors.length ? <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
      <div className="row gap end-actions">
        {cur ? finishBtn('btn grow') : null}
        <button className="btn ghost" onClick={discard}>Descartar</button>
      </div>
      <p className="muted small center"><Link to="/">Salir sin terminar</Link>: la sesión queda guardada en el teléfono.</p>

      <div className="focus-bar">
        {hint ? <p className="error small" role="alert">{hint}</p> : null}
        {cur && openLine && activeSet !== null ? (
          <button className="btn primary big" aria-label={`Serie ${activeSet + 1} hecha`} onClick={() => doneSet(open, activeSet)}>
            ✓ Serie {activeSet + 1} de {openLine.sets.length}{cur.kg ? ` · ${cur.kg} kg` : ''}{cur.reps ? ` × ${cur.reps}` : ''}
          </button>
        ) : finishBtn('btn primary big')}
      </div>
    </main>
  );
}

/** Periodos en otro gimnasio: dentro de ellos, Entreno y Hoy usan la rutina de ese gimnasio. */
function GymPeriods({ gyms, today }: { gyms: { gym: string; label: string }[]; today: string }) {
  const p = usePlans();
  const [form, setForm] = useState<{ gym: string; from: string; to: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = (g: string) => gyms.find((x) => x.gym === g)?.label ?? g;
  const upcoming = p.periods.filter((x) => x.date_to >= today);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await p.reload();
      setForm(null);
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>En otro gimnasio</h2>
      <p className="muted small">Marca de qué día a qué día estás fuera: esos días el entreno y Hoy salen de la rutina de ese gimnasio, cada día con su sesión.</p>
      {upcoming.length ? (
        <ul className="plan-list">
          {upcoming.map((x) => (
            <li key={x.id}>
              <span className="grow">{label(x.gym)}: {shortDate(x.date_from, { day: 'numeric', month: 'short' })} – {shortDate(x.date_to, { day: 'numeric', month: 'short' })}{x.note ? <span className="muted small"> · {x.note}</span> : null}</span>
              <button className="btn small ghost" disabled={busy} aria-label={`Borrar el periodo del ${x.date_from}`}
                onClick={() => { if (confirm('¿Borrar este periodo?')) void run(() => rpc('delete_gym_period', { p_id: x.id })); }}>Borrar</button>
            </li>
          ))}
        </ul>
      ) : null}
      {form ? (
        <div className="stack">
          {gyms.length > 1 ? (
            <label>Gimnasio<select value={form.gym} onChange={(e) => setForm({ ...form, gym: e.target.value })}>{gyms.map((g) => <option key={g.gym} value={g.gym}>{g.label}</option>)}</select></label>
          ) : null}
          <div className="row gap">
            <label className="grow">Desde<input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value, to: form.to < e.target.value ? e.target.value : form.to })} /></label>
            <label className="grow">Hasta<input type="date" value={form.to} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} /></label>
          </div>
          <label>Nota (opcional)<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <div className="row gap">
            <button className="btn primary grow" disabled={busy || !form.from || !form.to}
              onClick={() => void run(() => rpc('save_gym_period', { p_gym: form.gym, p_from: form.from, p_to: form.to, p_note: form.note }))}>{busy ? 'Guardando…' : 'Guardar periodo'}</button>
            <button className="btn ghost" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <button className="btn wide" onClick={() => setForm({ gym: gyms[0]?.gym ?? '', from: today, to: today, note: '' })}>Añadir periodo{gyms.length === 1 ? ` en ${gyms[0].label}` : ''}</button>
      )}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function target(x: Exercise): string {
  if (x.type === 'cardio' || x.type === 'movilidad') return x.minutes ? `${x.minutes} min` : '';
  return `${x.sets} × ${x.reps?.[0]}-${x.reps?.[1]}${x.per_side ? ' por lado' : ''}${x.rir ? ` · RIR ${x.rir[0]}-${x.rir[1]}` : ''}`;
}

function LineCard({ ex, line, hist, level, mode, open, activeSet, onOpen, onEdit, onChange }: {
  ex: Exercise; line: LineDraft; hist: Exposure[]; level: Readiness; mode: TrainingMode; open: boolean; activeSet: number | null;
  onOpen: () => void; onEdit: (i: number) => void; onChange: (fn: (l: LineDraft) => void) => void;
}) {
  const sug = useMemo(() => suggest(ex, hist, level, mode), [ex, hist, level, mode]);
  const done = line.sets.filter((s) => s.done).length;
  const last = hist[0];
  const [pickMachine, setPickMachine] = useState(false);
  const options = machineOptions(ex.machine);
  const custom = !options.includes(line.machine);
  const range = (r?: [number, number]) => (r ? `${r[0]}-${r[1]}` : '');
  return (
    <section className={open ? 'card line open' : 'card line'}>
      <button className="line-head" onClick={onOpen} aria-expanded={open}>
        <span className="grow">
          <strong>{line.name}</strong>
          <span className="muted small block">{line.machine ? `${line.machine} · ` : ''}{target(ex)}{ex.rest_s ? ` · ${mmss(ex.rest_s)}` : ''}</span>
        </span>
        <span className={done === line.sets.length ? 'tag new' : 'tag'}>{done}/{line.sets.length}</span>
      </button>
      {open ? (
        <>
          <div className={`suggestion ${sug.action}`}>
            <strong>{sug.title}</strong>
            <span className="small">{sug.why}</span>
            {level !== 'normal' && ex.type === 'compuesto' ? <span className="small">Hoy RIR +1 en este compuesto.</span> : null}
          </div>
          {machineChanged(line.machine, last) ? <p className="banner small">La última vez usaste otra máquina ({last!.machine}): las cargas no son comparables. Si es otra de verdad, calibra con RIR 3.</p> : null}
          {last ? <p className="muted small">Última vez ({last.date.slice(8)}/{last.date.slice(5, 7)}): {last.sets.map((s) => `${s.kg ?? '–'}×${s.reps ?? '–'}${s.rir !== null ? ` @${s.rir}` : ''}`).join(' · ')}</p> : null}
          {ex.notes ? <p className="muted small">{ex.notes}</p> : null}
          <div className="sets">
            {line.sets.map((st, i) => i === activeSet ? (
              <div key={i} className={st.done ? 'set-editor done' : 'set-editor'} role="group" aria-label={`Serie ${i + 1} de ${line.sets.length}`} data-focus={`${line.key}:${i}`}>
                <div className="row gap">
                  <strong className="grow">Serie {i + 1} de {line.sets.length}{st.done ? ' · corrigiendo' : ''}</strong>
                </div>
                <Stepper label={`Serie ${i + 1} kg`} unit="kg" value={st.kg} step={kgStep(ex.load, num(st.kg) || 0)} onChange={(v) => onChange((l) => { l.sets[i].kg = v; })} />
                <Stepper label={`Serie ${i + 1} reps`} unit="reps" value={st.reps} step={1} placeholder={range(ex.reps)} onChange={(v) => onChange((l) => { l.sets[i].reps = v; })} />
                <Stepper label={`Serie ${i + 1} RIR`} unit="RIR" value={st.rir} step={1} max={10} placeholder={range(ex.rir)} onChange={(v) => onChange((l) => { l.sets[i].rir = v; })} />
                <div className="row gap molestia">
                  <label className="grow inline">Molestia (0-10)
                    <input aria-label={`Serie ${i + 1} molestia 0-10`} inputMode="numeric" placeholder="0" value={st.molestia} onChange={(e) => onChange((l) => { l.sets[i].molestia = e.target.value; })} />
                  </label>
                </div>
                {Number(st.molestia.replace(',', '.')) >= 3 ? (
                  <input className="zona" aria-label={`Serie ${i + 1} zona de la molestia`} placeholder="¿Dónde? (hombro dcho., lumbar…)" value={st.zona}
                    onChange={(e) => onChange((l) => { l.sets[i].zona = e.target.value; })} />
                ) : null}
              </div>
            ) : (
              <button key={i} type="button" className={st.done ? 'set-row done' : 'set-row'} onClick={() => onEdit(i)} aria-label={`Serie ${i + 1}: ${st.done ? 'hecha, tocar para corregir' : 'pendiente'}`}>
                <span className="muted">{i + 1}</span>
                <span className="grow tabular">{st.kg ? `${st.kg} kg` : '–'} × {st.reps || '–'}{st.rir ? ` @${st.rir}` : ''}{Number(st.molestia) > 0 ? ` · molestia ${st.molestia}` : ''}</span>
                <span aria-hidden="true">{st.done ? '✓' : ''}</span>
              </button>
            ))}
          </div>
          <div className="row gap wrap">
            <button className="btn small ghost" onClick={() => onChange((l) => { const prev = l.sets[l.sets.length - 1]; l.sets.push({ kg: prev?.kg ?? '', reps: '', rir: '', molestia: '', zona: '', done: false }); })}>+ Serie</button>
            {line.sets.length > 1 ? <button className="btn small ghost" onClick={() => onChange((l) => { l.sets.pop(); })}>− Serie</button> : null}
            <button className="btn small ghost grow machine-btn" aria-expanded={pickMachine} onClick={() => setPickMachine(!pickMachine)}>Máquina: {line.machine || 'sin anotar'}</button>
          </div>
          {pickMachine ? (
            <div className="machine-pick">
              <div className="chips" role="radiogroup" aria-label="Máquina de hoy">
                {options.map((o) => (
                  <button key={o} type="button" role="radio" aria-checked={line.machine === o} className={line.machine === o ? 'chip on' : 'chip'}
                    onClick={() => { onChange((l) => { l.machine = o; }); setPickMachine(false); }}>{o}</button>
                ))}
                <button type="button" role="radio" aria-checked={custom} className={custom ? 'chip on' : 'chip'} onClick={() => { if (!custom) onChange((l) => { l.machine = ''; }); }}>Otra</button>
              </div>
              {custom ? <label>Máquina<input value={line.machine} placeholder="Nombre de la máquina" onChange={(e) => onChange((l) => { l.machine = e.target.value; })} /></label> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** Número con botones − / + grandes para la sala (se puede escribir igualmente). Vacío: el primer toque pone el mínimo del rango. */
function Stepper({ label, unit, value, step, max, placeholder, onChange }: {
  label: string; unit: string; value: string; step: number; max?: number; placeholder?: string; onChange: (v: string) => void;
}) {
  const bump = (dir: 1 | -1) => {
    const cur = num(value);
    const low = num(placeholder?.split('-')[0] ?? '');
    let v: number;
    if (cur === null || Number.isNaN(cur)) v = low !== null && !Number.isNaN(low) ? low : dir > 0 ? step : 0;
    else v = cur + dir * step;
    v = Math.max(0, Math.round(v * 100) / 100);
    if (max !== undefined) v = Math.min(max, v);
    onChange(fmtKg(v));
  };
  return (
    <div className="num-stepper">
      <span className="num-unit">{unit}</span>
      <button type="button" className="btn step" aria-label={`Restar ${unit} (${label.split(' ').slice(0, 2).join(' ').toLowerCase()})`} onClick={() => bump(-1)}>−</button>
      <input aria-label={label} inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="btn step" aria-label={`Sumar ${unit} (${label.split(' ').slice(0, 2).join(' ').toLowerCase()})`} onClick={() => bump(1)}>+</button>
    </div>
  );
}

/** Temporizador de descanso que sobrevive a bloquear el móvil (cuenta contra la hora de fin). */
function useRest() {
  const [end, setEnd] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const buzzed = useRef(false);
  const warned = useRef(false);
  useEffect(() => {
    if (end === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [end]);
  const left = end === null ? null : Math.ceil((end - now) / 1000);
  useEffect(() => {
    // Aviso a 10 s (un pitido grave) y al terminar (tres agudos).
    if (left !== null && left <= 10 && left > 0 && !warned.current) { warned.current = true; beep(1, 660); }
    if (left !== null && left <= 0 && !buzzed.current) { buzzed.current = true; beep(3, 988); }
  }, [left]);
  return {
    left,
    start: (seconds: number) => { buzzed.current = false; warned.current = seconds <= 10; setNow(Date.now()); setEnd(Date.now() + seconds * 1000); },
    add: (seconds: number) => setEnd((e) => (e === null ? e : e + seconds * 1000)),
    stop: () => setEnd(null),
  };
}
