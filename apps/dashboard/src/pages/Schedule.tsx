import { useEffect, useRef, useState } from 'react';
import { addDays, localDate, weekStart } from '@shared/stats.ts';
import {
  agendaFor, isoWeekday, localTime, nowAndNext, weekSettings, WEEKDAYS, WEEKDAY_NAME, WEEKDAY_SHORT,
  type AgendaItem, type MealsPlan, type Recipe, type Weekday,
} from '@shared/plans.ts';
import { useStructure } from '../data';
import { Link } from '../router';
import { explainError, rpc } from '../supabase';
import { shortDate, usePlans, usePlansFor } from '../plans';

export function Schedule({ date: initial }: { date?: string }) {
  const s = useStructure();
  const p = usePlans();
  const today = localDate(new Date(), s.timezone);
  const date = initial ?? today;
  const plans = usePlansFor(date);
  const ws = weekStart(date);
  const agenda = agendaFor({
    date, schedule: plans.schedule?.content ?? null, training: plans.training?.content ?? null,
    meals: plans.meals?.content ?? null, weeks: p.weeks, deliveries: p.orders,
  });
  const current = date === today ? nowAndNext(agenda.items, localTime(new Date(), s.timezone)).now : null;
  // Al abrir el día de hoy, el bloque actual queda a la vista (no las 05:00).
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !current) return;
    scrolled.current = true;
    document.querySelector('ol.agenda li.now')?.scrollIntoView({ block: 'center' });
  }, [current]);

  if (!plans.schedule && !p.loading) {
    return (
      <main>
        <header className="page-head"><h1>Horario</h1></header>
        <p>Aún no hay horario. Impórtalo en <Link to="/ajustes">Ajustes → Planes</Link> o pídeselo a Claude.</p>
      </main>
    );
  }

  return (
    <main>
      <header className="page-head">
        <h1>Horario</h1>
        <div className="row gap week-nav">
          <Link to={`/horario/${addDays(ws, -7)}`} className="btn small ghost" aria-label="Semana anterior">‹</Link>
          <span className="grow center">{shortDate(ws, { day: 'numeric', month: 'short' })} – {shortDate(addDays(ws, 6), { day: 'numeric', month: 'short' })}</span>
          <Link to={`/horario/${addDays(ws, 7)}`} className="btn small ghost" aria-label="Semana siguiente">›</Link>
        </div>
        <nav className="day-chips" aria-label="Día">
          {WEEKDAYS.map((wd) => {
            const d = addDays(ws, wd - 1);
            return (
              <Link key={wd} to={`/horario/${d}`} className={d === date ? 'day-chip on' : d === today ? 'day-chip today' : 'day-chip'}
                aria-current={d === date ? 'date' : undefined} aria-label={WEEKDAY_NAME[wd]}>
                <span>{WEEKDAY_SHORT[wd]}</span><small>{d.slice(8)}</small>
              </Link>
            );
          })}
        </nav>
      </header>

      {plans.schedule?.preview ? <p className="banner">Vista previa: este horario empieza el {shortDate(plans.schedule.row.valid_from, { day: 'numeric', month: 'long' })}.</p> : null}
      <WeekSettings key={ws} weekStartDate={ws} />

      <h2 className="cap">{WEEKDAY_NAME[isoWeekday(date)]} {Number(date.slice(8))}
        <span className="muted small"> · {agenda.away ? 'fuera de casa' : agenda.telework ? 'teletrabajo' : isoWeekday(date) <= 5 ? 'oficina' : 'fin de semana'}</span>
      </h2>
      <AgendaList items={agenda.items} current={current?.id ?? null} date={date} meals={plans.meals?.content ?? null} />
    </main>
  );
}

function WeekSettings({ weekStartDate }: { weekStartDate: string }) {
  const p = usePlans();
  const plans = usePlansFor(weekStartDate);
  const cur = weekSettings(p.weeks, plans.schedule?.content ?? null, weekStartDate);
  const [open, setOpen] = useState(false);
  const [tele, setTele] = useState<Weekday[]>(cur.telework);
  const [away, setAway] = useState<Weekday[]>(cur.away);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = (ds: Weekday[]) => (ds.length ? [...ds].sort().map((d) => WEEKDAY_SHORT[d]).join(', ') : 'ninguno');

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await rpc('save_week', { p_week_start: weekStartDate, p_telework: tele, p_away: away, p_note: '' });
      await p.reload();
      setOpen(false);
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }
  const toggle = (list: Weekday[], set: (x: Weekday[]) => void, d: Weekday) => set(list.includes(d) ? list.filter((x) => x !== d) : [...list, d]);

  if (!open) {
    return (
      <p className="week-settings">
        <span className="grow">Teletrabajo: <strong>{names(cur.telework)}</strong>{cur.chosen ? '' : ' (por defecto)'}
          {cur.away.length ? <> · Fuera: <strong>{names(cur.away)}</strong></> : null}</span>
        <button className="btn small ghost" onClick={() => { setTele(cur.telework); setAway(cur.away); setOpen(true); }}>Cambiar</button>
      </p>
    );
  }
  return (
    <section className="card">
      <h2>Esta semana</h2>
      <p className="muted small">El teletrabajo decide qué bloques salen (autobús, cocina corta, entrega). Los días fuera de casa no gastan de la despensa.</p>
      <div className="stack">
        <div><span className="label">Teletrabajo</span>
          <div className="chips" role="group" aria-label="Teletrabajo">{WEEKDAYS.slice(0, 5).map((d) => (
            <button key={d} type="button" className={tele.includes(d) ? 'chip on' : 'chip'} aria-pressed={tele.includes(d)} onClick={() => toggle(tele, setTele, d)}>{WEEKDAY_SHORT[d]}</button>
          ))}</div></div>
        <div><span className="label">Fuera de casa</span>
          <div className="chips" role="group" aria-label="Fuera de casa">{WEEKDAYS.map((d) => (
            <button key={d} type="button" className={away.includes(d) ? 'chip on' : 'chip'} aria-pressed={away.includes(d)} onClick={() => toggle(away, setAway, d)}>{WEEKDAY_SHORT[d]}</button>
          ))}</div></div>
        {error ? <p className="error">{error}</p> : null}
        <div className="row gap">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>Guardar semana</button>
          <button className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
        </div>
      </div>
    </section>
  );
}

export function AgendaList({ items, current, date, meals, compact }: { items: AgendaItem[]; current: string | null; date: string; meals: MealsPlan | null; compact?: boolean }) {
  if (!items.length) return <p className="muted">Nada en el horario este día.</p>;
  return (
    <ol className="agenda">
      {items.map((it) => (
        <li key={it.id} className={it.id === current ? 'slot now' : 'slot'} aria-current={it.id === current ? 'step' : undefined}>
          <span className="slot-time">{it.start}{it.end ? <small>{it.end}</small> : null}</span>
          <div className="slot-body">
            <div className="slot-title">{it.icon ? <span aria-hidden="true">{it.icon} </span> : null}{it.title}{it.id === current ? <span className="tag new">Ahora</span> : null}</div>
            {it.detail && !compact ? <p className="muted small">{it.detail}</p> : null}
            <SlotExtra it={it} date={date} meals={meals} compact={compact} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function SlotExtra({ it, date, meals, compact }: { it: AgendaItem; date: string; meals: MealsPlan | null; compact?: boolean }) {
  const s = useStructure();
  if (it.training) {
    const n = it.training.exercises.length;
    return (
      <div className="slot-extra">
        <span><strong>{it.training.name}</strong> <span className="muted small">· {n} {n === 1 ? 'ejercicio' : 'ejercicios'}</span></span>
        {it.training.kind !== 'descanso' ? <Link to={`/entreno/${date}`} className="btn small primary">Entrenar</Link> : null}
      </div>
    );
  }
  if (it.meal) {
    return (
      <div className="slot-extra col">
        <RecipeLine recipe={it.meal.recipe} meals={meals} servings={1} compact={compact} />
        {it.meal.meal.note ? <span className="muted small">{it.meal.meal.note}</span> : null}
      </div>
    );
  }
  if (it.cook) {
    return (
      <div className="slot-extra col">
        {it.cook.recipes.map((r) => <RecipeLine key={r.recipe.key} recipe={r.recipe} meals={meals} servings={r.servings} note={r.note} compact={compact} />)}
        {it.cook.session.notes && !compact ? <span className="muted small">{it.cook.session.notes}</span> : null}
      </div>
    );
  }
  if (it.delivery) return <div className="slot-extra"><span>{it.delivery.items} productos</span><Link to="/compra/pedidos" className="btn small">Recibir</Link></div>;
  if (it.link?.kind === 'shopping') return <div className="slot-extra"><Link to="/compra" className="btn small">Ver la compra</Link></div>;
  if (it.link?.kind === 'form') {
    const link = it.link;
    const area = s.areas.find((a) => a.slug === link.area);
    const form = s.forms.find((f) => f.area_id === area?.id && f.slug === link.form);
    return form ? <div className="slot-extra"><span className="muted small">{form.name}</span><Link to={`/a/${link.area}/${link.form}/nuevo`} className="btn small">Registrar</Link></div> : null;
  }
  return null;
}

function RecipeLine({ recipe, meals, servings, note, compact }: { recipe: Recipe; meals: MealsPlan | null; servings: number; note?: string; compact?: boolean }) {
  const name = (k: string) => meals?.products.find((p) => p.key === k);
  const label = `${recipe.name}${servings > 1 ? ` × ${servings}` : ''}`;
  if (compact) return <span>{label}</span>;
  return (
    <details className="recipe">
      <summary>{label}{note ? <span className="muted small"> · {note}</span> : null}</summary>
      <ul className="list compact">
        {recipe.ingredients.map((g) => {
          const p = name(g.product);
          return <li key={g.product}><span className="grow">{p?.name ?? g.product}</span><span className="muted">{(g.amount * servings).toLocaleString('es-ES')} {p?.unit ?? ''}</span></li>;
        })}
      </ul>
      {recipe.notes ? <p className="muted small">{recipe.notes}</p> : null}
    </details>
  );
}

/** Tarjeta de "Hoy": lo que toca ahora y lo siguiente. */
export function NowCard() {
  const s = useStructure();
  const p = usePlans();
  const today = localDate(new Date(), s.timezone);
  const plans = usePlansFor(today);
  if (!plans.schedule) return null;
  const agenda = agendaFor({
    date: today, schedule: plans.schedule.content, training: plans.training?.content ?? null,
    meals: plans.meals?.content ?? null, weeks: p.weeks, deliveries: p.orders,
  });
  const { now, next } = nowAndNext(agenda.items, localTime(new Date(), s.timezone));
  const shown = [now, next].filter((x): x is AgendaItem => Boolean(x));
  return (
    <section className="card now-card" aria-label="Ahora">
      <div className="card-head"><h2>Ahora</h2><Link to="/horario" className="small">Todo el día</Link></div>
      {plans.schedule.preview ? <p className="muted small">Vista previa: el horario empieza el {shortDate(plans.schedule.row.valid_from, { day: 'numeric', month: 'long' })}.</p> : null}
      {shown.length ? <AgendaList items={shown} current={now?.id ?? null} date={today} meals={plans.meals?.content ?? null} compact />
        : <p className="muted">Nada más hoy en el horario.</p>}
    </section>
  );
}
