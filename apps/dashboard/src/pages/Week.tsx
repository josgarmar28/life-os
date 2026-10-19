// Semana: todas las áreas juntas, día a día. Sirve para ver cómo se influyen (sueño, energía,
// estrés, entreno, peso, comida) y para la revisión semanal del domingo.
import { localDate } from '@shared/stats.ts';
import { formatDuration, formatNumber, addDays } from '@shared/stats.ts';
import { summarizeWeek, weekRange, type WeekIndicator } from '@shared/week.ts';
import { loadEntries, useAsync, useStructure } from '../data';
import { Link } from '../router';

const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const longDate = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { ...opts, timeZone: 'UTC' });

function cell(ind: WeekIndicator, v: number | null) {
  if (v === null) return '·';
  if (ind.field.type === 'duration') return formatDuration(v).replace(' min', '′').replace(' h ', 'h');
  return formatNumber(v, ind.field.type === 'number' ? 1 : 0);
}

function delta(ind: WeekIndicator) {
  if (ind.delta === null) return null;
  const d = ind.delta;
  const shown = ind.field.type === 'duration' ? `${Math.round(d)} min` : formatNumber(Math.abs(d), 1);
  if (Math.abs(d) < 1e-9) return <span className="muted small">= semana anterior</span>;
  return <span className="muted small">{d > 0 ? '▲' : '▼'} {ind.field.type === 'duration' ? shown.replace('-', '') : shown} vs. anterior</span>;
}

export function Week({ date }: { date?: string }) {
  const s = useStructure();
  const today = localDate(new Date(), s.timezone);
  const { start, end, fetchFrom } = weekRange(date ?? today);
  const active = s.forms.filter((f) => f.status === 'active');
  const entries = useAsync(() => loadEntries({ formIds: active.map((f) => f.id), from: fetchFrom, to: end }), [start, active.length]);
  const w = entries.data ? summarizeWeek(s.areas, s.forms, s.fields, entries.data, start, today) : null;
  const isCurrent = start === weekRange(today).start;

  return (
    <main>
      <header className="page-head">
        <h1>Semana</h1>
        <div className="row gap week-nav">
          <Link to={`/semana/${addDays(start, -7)}`} className="btn small ghost" aria-label="Semana anterior">‹</Link>
          <span className="grow center">{longDate(start, { day: 'numeric', month: 'short' })} – {longDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          {!isCurrent ? <Link to={`/semana/${addDays(start, 7)}`} className="btn small ghost" aria-label="Semana siguiente">›</Link> : <span className="btn small ghost disabled" aria-hidden="true">›</span>}
        </div>
      </header>
      {entries.error ? <p className="error">{entries.error}</p> : null}
      {!w ? <p className="muted">Cargando…</p> : (
        <>
          <section className="card">
            <h2>Día a día</h2>
            {w.indicators.length ? (
              <div className="week-grid" role="table" aria-label="Indicadores por día">
                <div className="wrow head" role="row">
                  {w.dates.map((d, i) => (
                    <span key={d} role="columnheader" className={d === today ? 'today' : ''}>{DOW[i]}<small>{Number(d.slice(8))}</small></span>
                  ))}
                </div>
                {w.indicators.map((ind) => (
                  <div key={ind.field.id} className="wblock" role="rowgroup">
                    <div className="wlabel">
                      <span>{ind.area.icon} {ind.field.label}{ind.field.unit && ind.field.type !== 'duration' ? ` (${ind.field.unit})` : ''}</span>
                      <span className="muted small">{ind.avg !== null ? `media ${cell(ind, ind.avg)}` : 'sin datos'}</span>
                    </div>
                    <div className="wrow" role="row">
                      {ind.days.map((v, i) => <span key={i} role="cell" className={v === null ? 'empty' : ''}>{cell(ind, v)}</span>)}
                    </div>
                    {delta(ind) ? <div className="wdelta">{delta(ind)}</div> : null}
                  </div>
                ))}
              </div>
            ) : <p className="muted small">Marca campos numéricos como "Mostrar en la vista general" para verlos aquí.</p>}
          </section>

          <section className="card">
            <h2>Registros de la semana</h2>
            <ul className="list week-forms">
              {w.forms.map((f) => (
                <li key={f.form.id}>
                  <span className="grow">{f.area.icon} {f.form.name}</span>
                  {f.form.cadence === 'daily' ? (
                    <span className="dots" aria-label={`${f.days.length} de ${f.expected} días`}>
                      {w.dates.map((d, i) => <span key={d} className={f.days.includes(d) ? 'dot ok' : i < w.elapsed ? 'dot todo' : 'dot'} />)}
                    </span>
                  ) : null}
                  <span className="muted small count">
                    {f.expected !== null ? `${f.form.cadence === 'daily' ? f.days.length : Math.min(f.count, 1)}/${f.expected}` : `${f.count}`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted small">Pide a Claude "revisa mi semana en LIFE OS": ve esto mismo y te propone ajustes.</p>
          </section>
        </>
      )}
    </main>
  );
}
