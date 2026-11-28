// Modo viaje: "Me voy a España" (o "Viene ella"). Formulario → vista previa día a día → Preparar viaje.
// Todo el cálculo está en @shared/trip.ts (el mismo que usa Claude por el conector); aquí solo se muestra y se aplica.
import { useEffect, useMemo, useState } from 'react';
import { localDate } from '@shared/stats.ts';
import { gymLabel, HOME_GYM, planFor, trainingGyms, type SchedulePlan } from '@shared/plans.ts';
import {
  checklistStatus, deriveTrip, dueChecklist, inputOf, planOfRow, TRIP_RULES, tripPayload, tripWarnings, upcomingTrips, validateTripInput,
  type TripInput, type TripKind, type TripOverrides, type TripPlan, type TripRow,
} from '@shared/trip.ts';
import { useStructure } from '../data';
import { Link, navigate } from '../router';
import { explainError, rpc } from '../supabase';
import { shortDate, usePlans } from '../plans';

const GYM_KEY = 'lifeos.trip.gym';
const readGym = (): { opens: string; commute: number } => {
  try {
    const v = JSON.parse(localStorage.getItem(GYM_KEY) ?? 'null') as { opens?: string; commute?: number } | null;
    if (v?.opens && Number.isInteger(v.commute)) return { opens: v.opens, commute: v.commute as number };
  } catch { /* sin almacenamiento */ }
  return { opens: TRIP_RULES.gymOpens, commute: TRIP_RULES.commuteMin };
};

const day = (d: string) => shortDate(d, { weekday: 'short', day: 'numeric', month: 'short' });
const range = (t: Pick<TripRow, 'date_from' | 'date_to'>) => `${shortDate(t.date_from, { day: 'numeric', month: 'short' })} – ${shortDate(t.date_to, { day: 'numeric', month: 'short' })}`;
const KIND_NAME: Record<TripKind, string> = { espana: 'Viaje a España', visita: 'Viene ella' };

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

export function TripList() {
  const s = useStructure();
  const p = usePlans();
  const today = localDate(new Date(), s.timezone);
  const live = p.trips.filter((t) => t.status !== 'cancelled');
  const next = upcomingTrips(p.trips, today);
  const past = live.filter((t) => !next.includes(t)).sort((a, b) => b.date_from.localeCompare(a.date_from)).slice(0, 5);
  return (
    <main>
      <header className="page-head"><h1>Viaje</h1><p className="muted">Prepara de una vez entreno, agenda, comida, compra y sueño.</p></header>
      <div className="stack">
        <Link to="/viaje/nuevo" className="btn primary wide">✈️ Me voy a España</Link>
        <Link to="/viaje/nuevo?tipo=visita" className="btn wide">Viene ella</Link>
      </div>
      {next.length ? <h2 className="cap">Próximos</h2> : null}
      {next.map((t) => <TripCard key={t.id} t={t} today={today} />)}
      {past.length ? <h2 className="cap">Anteriores</h2> : null}
      {past.map((t) => <TripCard key={t.id} t={t} today={today} />)}
      {!live.length ? <p className="muted">Aún no hay viajes.</p> : null}
    </main>
  );
}

function TripCard({ t, today }: { t: TripRow; today: string }) {
  const due = dueChecklist([t], today).length;
  return (
    <Link to={`/viaje/${t.id}`} className="card block-link">
      <div className="card-head">
        <h2>{KIND_NAME[t.kind]}</h2>
        {t.status === 'done' ? <span className="tag">hecho</span> : due ? <span className="badge">{due}</span> : null}
      </div>
      <p className="muted">{range(t)}{t.kind === 'espana' && t.gym ? ` · ${gymLabel(t.gym)}` : ''}</p>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Formulario con vista previa (crear y editar)
// ---------------------------------------------------------------------------

export function TripForm({ id, search }: { id?: string; search?: string }) {
  const s = useStructure();
  const p = usePlans();
  const today = localDate(new Date(), s.timezone);
  const editing = id ? p.trips.find((t) => t.id === id) ?? null : null;
  const gyms = useMemo(() => trainingGyms(p.plans, today).filter((g) => g.gym !== HOME_GYM), [p.plans, today]);
  const remembered = useMemo(readGym, []);
  const wantsVisit = new URLSearchParams(search ?? '').get('tipo') === 'visita';

  const [input, setInput] = useState<TripInput>(() => editing ? inputOf(editing) : {
    kind: wantsVisit ? 'visita' : 'espana', date_from: '', date_to: '', leave_time: '', return_leave_time: '', return_home_time: '',
    vacation_from: null, vacation_to: null, gym: gyms[0]?.gym ?? null, gym_opens: remembered.opens, commute_min: remembered.commute, note: '',
  });
  const [ov, setOv] = useState<TripOverrides>(() => editing ? {
    away: Object.fromEntries(planOfRow(editing).days.map((d) => [d.date, d.away])), gym_from: editing.gym_from, gym_to: editing.gym_to,
  } : {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reqId] = useState(() => crypto.randomUUID());
  // Con la edición cargada tarde (el teléfono abre sin red), se rellena cuando llega.
  useEffect(() => {
    if (id && editing && !input.date_from) {
      setInput(inputOf(editing));
      setOv({ away: Object.fromEntries(planOfRow(editing).days.map((d) => [d.date, d.away])), gym_from: editing.gym_from, gym_to: editing.gym_to });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const espana = input.kind === 'espana';
  const errors = validateTripInput(input);
  const plan: TripPlan | null = errors.length ? null : deriveTrip(input, ov);
  const schedule = planFor<SchedulePlan>(p.plans, 'schedule', input.date_from || today)?.content ?? null;
  const warnings = plan ? [...plan.warnings, ...tripWarnings(plan, {
    trips: p.trips, periods: p.periods, editing, orders: p.orders, schedule, gyms: gyms.map((g) => g.gym).concat(HOME_GYM),
  })] : [];

  // Al cambiar fechas u horas se vuelve a lo deducido: los cambios a mano eran de la vista previa anterior.
  const set = (patch: Partial<TripInput>) => { setInput((cur) => ({ ...cur, ...patch })); setOv({}); };

  async function save() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      if (plan.input.gym) {
        try { localStorage.setItem(GYM_KEY, JSON.stringify({ opens: plan.input.gym_opens || TRIP_RULES.gymOpens, commute: plan.input.commute_min ?? TRIP_RULES.commuteMin })); } catch { /* sin almacenamiento */ }
      }
      const newId = await rpc<string>('save_trip', { p_trip: tripPayload(plan, p.weeks, schedule), p_request_id: reqId, p_id: editing?.id ?? null });
      await p.reload();
      navigate(`/viaje/${editing?.id ?? newId}`, true);
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }

  if (id && !editing) {
    return <main><header className="page-head"><h1>Viaje</h1></header><p>{p.loading ? 'Cargando…' : 'No encuentro ese viaje.'}</p><Link to="/viaje">Volver</Link></main>;
  }
  if (editing && editing.status !== 'planned') {
    return <main><header className="page-head"><h1>Viaje</h1></header><p>Este viaje ya terminó y no se puede editar.</p><Link to={`/viaje/${editing.id}`}>Volver</Link></main>;
  }

  return (
    <main>
      <header className="page-head"><h1>{editing ? 'Editar viaje' : espana ? 'Me voy a España' : 'Viene ella'}</h1></header>
      <section className="card">
        <div className="stack">
          {!editing ? (
            <div className="chips" role="group" aria-label="Tipo de viaje">
              <button type="button" className={espana ? 'chip on' : 'chip'} aria-pressed={espana} onClick={() => set({ kind: 'espana', gym: gyms[0]?.gym ?? null })}>Voy yo a España</button>
              <button type="button" className={!espana ? 'chip on' : 'chip'} aria-pressed={!espana} onClick={() => set({ kind: 'visita', gym: null })}>Viene ella</button>
            </div>
          ) : null}
          <div className="row gap">
            <label className="grow">{espana ? 'Salgo de Pully' : 'Llega ella'}<input type="date" value={input.date_from} min={today}
              onChange={(e) => set({ date_from: e.target.value, date_to: input.date_to && input.date_to < e.target.value ? e.target.value : input.date_to })} /></label>
            <label>Hora<input type="time" value={input.leave_time ?? ''} onChange={(e) => set({ leave_time: e.target.value })} /></label>
          </div>
          {espana ? (
            <div className="row gap">
              <label className="grow">Salgo de España (hora)<input type="time" value={input.return_leave_time ?? ''} onChange={(e) => set({ return_leave_time: e.target.value })} /></label>
            </div>
          ) : null}
          <div className="row gap">
            <label className="grow">{espana ? 'Llego a Pully' : 'Se va ella'}<input type="date" value={input.date_to} min={input.date_from || today} onChange={(e) => set({ date_to: e.target.value })} /></label>
            <label>Hora<input type="time" value={input.return_home_time ?? ''} onChange={(e) => set({ return_home_time: e.target.value })} /></label>
          </div>
          {espana ? (
            <>
              <div className="row gap">
                <label className="grow">Vacaciones desde<input type="date" value={input.vacation_from ?? ''} min={input.date_from} max={input.date_to}
                  onChange={(e) => set({ vacation_from: e.target.value || null, vacation_to: e.target.value ? input.vacation_to ?? e.target.value : null })} /></label>
                <label className="grow">hasta<input type="date" value={input.vacation_to ?? ''} min={input.vacation_from ?? input.date_from} max={input.date_to}
                  onChange={(e) => set({ vacation_to: e.target.value || null, vacation_from: e.target.value ? input.vacation_from ?? e.target.value : null })} /></label>
              </div>
              <p className="muted small">Sin vacaciones, los días de entre semana del viaje trabajas en remoto desde España, con tu mismo horario y pausa.</p>
              {gyms.length ? (
                <div className="row gap">
                  <label className="grow">Gimnasio de allí
                    <select value={input.gym ?? ''} onChange={(e) => set({ gym: e.target.value || null })}>
                      <option value="">Ninguno</option>
                      {gyms.map((g) => <option key={g.gym} value={g.gym}>{g.label}</option>)}
                    </select></label>
                  {input.gym ? <>
                    <label>Abre<input type="time" value={input.gym_opens ?? ''} onChange={(e) => set({ gym_opens: e.target.value })} /></label>
                    <label>Trayecto (min)<input type="number" inputMode="numeric" min={0} max={180} value={input.commute_min ?? ''} onChange={(e) => set({ commute_min: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                  </> : null}
                </div>
              ) : <p className="muted small">No hay rutina de otro gimnasio importada: el viaje no cambiará el entreno.</p>}
            </>
          ) : null}
          <label>Nota (opcional)<input value={input.note ?? ''} maxLength={200} onChange={(e) => setInput({ ...input, note: e.target.value })} /></label>
        </div>
      </section>

      {!plan ? <p className="muted">{errors[0] ?? 'Rellena fechas y horas para ver la vista previa.'}</p> : (
        <Preview plan={plan} ov={ov} setOv={setOv} warnings={warnings} />
      )}
      {error ? <p className="error">{error}</p> : null}
      <div className="row gap">
        <button className="btn primary grow" disabled={busy || !plan} onClick={() => void save()}>{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Preparar viaje'}</button>
        <Link to={editing ? `/viaje/${editing.id}` : '/viaje'} className="btn ghost">Cancelar</Link>
      </div>
    </main>
  );
}

function Preview({ plan, ov, setOv, warnings }: { plan: TripPlan; ov: TripOverrides; setOv: (o: TripOverrides) => void; warnings: string[] }) {
  const ROLE = { salida: 'Salida', vuelta: 'Vuelta', fuera: 'Fuera', salida_vuelta: 'Ida y vuelta' } as const;
  const toggleAway = (date: string, away: boolean) => setOv({ ...ov, away: { ...Object.fromEntries(plan.days.map((d) => [d.date, d.away])), ...ov.away, [date]: !away } });
  return (
    <>
      {warnings.length ? (
        <section className="card" aria-label="Avisos">
          <h2>Ojo</h2>
          <ul className="rows">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      ) : null}
      <section className="card" aria-label="Vista previa">
        <h2>Día a día</h2>
        <p className="muted small">Toca «Fuera» para cambiar un día; lo que ves se aplicará al pulsar el botón.</p>
        <ul className="list trip-days">
          {plan.days.map((d) => (
            <li key={d.date}>
              <span className="trip-day"><strong>{day(d.date)}</strong><span className="muted small block">{ROLE[d.role]}</span></span>
              <span className="grow muted small">
                {d.vacation ? 'Vacaciones' : d.remote ? 'Teletrabajo en España' : d.role === 'fuera' || d.away ? '' : 'Día normal'}
                {d.gym ? <span className="block">Entreno en {gymLabel(d.gym)}</span> : null}
                {d.night ? <span className="block">Noche «{plan.night_tag === 'viaje' ? 'viaje' : 'atípico'}»</span> : null}
              </span>
              <button type="button" className={d.away ? 'chip on' : 'chip'} aria-pressed={d.away} aria-label={`${day(d.date)}: fuera de casa`} onClick={() => toggleAway(d.date, d.away)}>Fuera</button>
            </li>
          ))}
        </ul>
        {plan.input.gym && plan.gym_from && plan.gym_to ? (
          <div className="row gap">
            <label className="grow">Gimnasio desde<input type="date" value={plan.gym_from} min={plan.input.date_from} max={plan.input.date_to} onChange={(e) => setOv({ ...ov, gym_from: e.target.value || null, gym_to: plan.gym_to })} /></label>
            <label className="grow">hasta<input type="date" value={plan.gym_to} min={plan.gym_from} max={plan.input.date_to} onChange={(e) => setOv({ ...ov, gym_to: e.target.value || null, gym_from: plan.gym_from })} /></label>
          </div>
        ) : null}
      </section>
      <section className="card" aria-label="Qué se aplicará">
        <h2>Qué se aplicará</h2>
        <ul className="rows">{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </section>
      <section className="card" aria-label="Checklist">
        <h2>Checklist</h2>
        <ul className="rows">{plan.checklist.map((c) => <li key={c.key}>{c.label}<span className="muted small block">desde el {day(c.due)}{c.detail ? ` · ${c.detail}` : ''}</span></li>)}</ul>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Detalle: checklist, editar, cancelar, ya he vuelto
// ---------------------------------------------------------------------------

export function TripDetail({ id }: { id: string }) {
  const s = useStructure();
  const p = usePlans();
  const today = localDate(new Date(), s.timezone);
  const t = p.trips.find((x) => x.id === id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  if (!t) return <main><header className="page-head"><h1>Viaje</h1></header><p>{p.loading ? 'Cargando…' : 'No encuentro ese viaje.'}</p><Link to="/viaje">Volver</Link></main>;

  const plan = planOfRow(t);
  const items = checklistStatus(t, today);
  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await p.reload();
      after?.();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }
  return (
    <main>
      <header className="page-head">
        <h1>{KIND_NAME[t.kind]}</h1>
        <p className="muted">{range(t)}{t.status === 'done' ? ' · hecho' : t.status === 'cancelled' ? ' · cancelado' : ''}</p>
      </header>
      {t.status === 'planned' && t.date_to < today ? <p className="banner">El viaje ya terminó: pulsa «Ya he vuelto» para cerrarlo.</p> : null}
      {t.status !== 'cancelled' ? (
        <section className="card" aria-label="Checklist">
          <h2>Checklist</h2>
          <ul className="list">
            {items.map((c) => (
              <li key={c.key}>
                <label className="check-line">
                  <input type="checkbox" checked={c.done} disabled={busy || t.status !== 'planned'}
                    onChange={(e) => void run(() => rpc('set_trip_item', { p_id: t.id, p_key: c.key, p_done: e.target.checked }))} />
                  <span className="grow">{c.label}
                    <span className="muted small block">{c.due_now || c.done ? '' : `desde el ${day(c.due)} · `}{c.detail ?? ''}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {t.kind === 'espana' ? <p className="muted small">La lista de maleta desde los dos armarios llega en la siguiente versión.</p> : null}
        </section>
      ) : null}
      <section className="card" aria-label="Qué cambia">
        <h2>Qué cambia</h2>
        <ul className="rows">{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        <ul className="list trip-days">
          {plan.days.map((d) => (
            <li key={d.date}>
              <span className="trip-day"><strong>{day(d.date)}</strong></span>
              <span className="grow muted small">
                {d.away ? 'Fuera de casa' : 'En casa'}{d.vacation ? ' · vacaciones' : d.remote ? ' · teletrabajo en España' : ''}
                {d.gym ? ` · ${gymLabel(d.gym)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {error ? <p className="error">{error}</p> : null}
      {t.status === 'planned' ? (
        <div className="stack">
          <button className="btn primary" disabled={busy} onClick={() => void run(() => rpc('finish_trip', { p_id: t.id }))}>Ya he vuelto</button>
          <Link to={`/viaje/${t.id}/editar`} className="btn">Editar</Link>
          {confirming ? (
            <div className="row gap">
              <button className="btn danger grow" disabled={busy} onClick={() => void run(() => rpc('cancel_trip', { p_id: t.id }), () => navigate('/viaje', true))}>Sí, cancelar el viaje</button>
              <button className="btn ghost" onClick={() => setConfirming(false)}>No</button>
            </div>
          ) : <button className="btn ghost" onClick={() => setConfirming(true)}>Cancelar el viaje</button>}
          {confirming ? <p className="muted small">Se quitan el periodo de gimnasio y los días fuera y de teletrabajo que añadió el viaje; lo que cambiaste a mano se queda.</p> : null}
        </div>
      ) : null}
      <Link to="/viaje" className="btn ghost wide">‹ Todos los viajes</Link>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Aviso en Hoy
// ---------------------------------------------------------------------------

/** Tarjeta de "Hoy": viaje en curso o próximo (desde 7 días antes) con lo que toca ya. */
export function TripBanner() {
  const s = useStructure();
  const p = usePlans();
  const today = localDate(new Date(), s.timezone);
  const t = upcomingTrips(p.trips, today)[0];
  if (!t) return null;
  const days = Math.round((Date.parse(`${t.date_from}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days > 7) return null;
  const due = dueChecklist([t], today);
  const ongoing = days <= 0;
  const input = inputOf(t);
  const here = ongoing && t.kind === 'espana' && t.gym && t.gym_from && t.gym_to && today >= t.gym_from && today <= t.gym_to;
  return (
    <section className="card trip-banner" aria-label="Viaje">
      <div className="card-head">
        <h2>{ongoing ? (t.kind === 'espana' ? '✈️ De viaje' : 'Visita') : `${KIND_NAME[t.kind]} ${days === 1 ? 'mañana' : `en ${days} días`}`}</h2>
        <Link to={`/viaje/${t.id}`} className="small">Abrir</Link>
      </div>
      <p className="muted">{range(t)}{ongoing ? ` · vuelves el ${day(t.date_to)}` : ''}</p>
      {here ? <p>Gimnasio a las {(input.gym_opens ?? TRIP_RULES.gymOpens).slice(0, 5)} ({gymLabel(t.gym ?? '')}).</p> : null}
      {due.length ? <ul className="rows">{due.map((d) => <li key={d.item.key}>{d.item.label}</li>)}</ul> : null}
    </section>
  );
}
