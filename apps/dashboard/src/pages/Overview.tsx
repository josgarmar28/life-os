import { useMemo } from 'react';
import { addDays, formatValue, localDate, summarizeForm, formatNumber } from '@shared/stats.ts';
import { CADENCE_LABEL } from '@shared/model.ts';
import { loadEntries, useAsync, useStructure } from '../data';
import { Link } from '../router';
import { Sparkline } from '../components/Sparkline';

export function Overview() {
  const s = useStructure();
  const today = localDate(new Date(), s.timezone);
  const areas = s.areas.filter((a) => a.status === 'active');
  const forms = s.forms.filter((f) => f.status === 'active' && areas.some((a) => a.id === f.area_id));
  const formIds = forms.map((f) => f.id).join(',');
  const entries = useAsync(() => loadEntries({ formIds: forms.map((f) => f.id), from: addDays(today, -59), to: today }), [formIds, today]);

  const summaries = useMemo(
    () => new Map(forms.map((f) => [f.id, summarizeForm(f, s.fields, entries.data ?? [], today)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries.data, s.fields, formIds, today],
  );
  const pendingToday = forms.filter((f) => summaries.get(f.id)?.status.done === false);
  const dateLabel = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: s.timezone }).format(new Date());

  return (
    <main>
      <header className="page-head">
        <h1>Hoy</h1>
        <p className="muted cap">{dateLabel}</p>
      </header>

      {s.pendingProposals ? (
        <Link to="/propuestas" className="banner">Claude tiene {s.pendingProposals} {s.pendingProposals === 1 ? 'propuesta' : 'propuestas'} para que decidas.</Link>
      ) : null}

      {pendingToday.length ? (
        <section className="card">
          <h2>Pendiente</h2>
          <ul className="todo">
            {pendingToday.map((f) => {
              const a = areas.find((x) => x.id === f.area_id)!;
              return (
                <li key={f.id}>
                  <Link to={`/a/${a.slug}/${f.slug}/nuevo`} className="todo-item">
                    <span>{a.icon} {f.name}</span>
                    <span className="muted small">{summaries.get(f.id)?.status.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : entries.data ? <p className="ok-line">Todo lo previsto para hoy está registrado.</p> : null}

      {entries.error ? <p className="error">No se pudieron cargar los datos: {entries.error}</p> : null}

      <div className="grid">
        {areas.map((a) => {
          const own = forms.filter((f) => f.area_id === a.id);
          return (
            <section className="card" key={a.id}>
              <div className="card-head">
                <h2 className="area-h"><Link to={`/a/${a.slug}`} className="area-title"><span className="icon">{a.icon}</span>{a.name}</Link></h2>
              </div>
              {own.map((f) => {
                const sum = summaries.get(f.id);
                const done = sum?.status.done;
                return (
                  <div key={f.id} className="form-line">
                    <div className="form-line-head">
                      <span className={done === true ? 'dot ok' : done === false ? 'dot todo' : 'dot'} aria-hidden="true" />
                      <span className="grow">{f.name}</span>
                      <span className="muted small">{sum?.status.last ? `último ${sum.status.last.slice(5).split('-').reverse().join('/')}` : CADENCE_LABEL[f.cadence]}</span>
                      <Link to={`/a/${a.slug}/${f.slug}/nuevo`} className="btn small">Registrar</Link>
                    </div>
                    {sum?.fields.map((x) => (
                      <div key={x.field.id} className="metric">
                        <div className="metric-text">
                          <span className="muted small">{x.field.label}</span>
                          <span className="metric-value">{x.last ? formatValue(x.field, x.last.value) : '—'}</span>
                          <span className="muted small">
                            {x.avg7 !== null ? `media 7 d: ${formatNumber(x.avg7, 1)}${x.n7 < 4 ? ` (${x.n7} d)` : ''}` : 'sin datos esta semana'}
                            {x.delta7 !== null && Math.abs(x.delta7) >= 0.05 ? ` · ${x.delta7 > 0 ? '+' : ''}${formatNumber(x.delta7, 1)} vs. semana anterior` : ''}
                          </span>
                        </div>
                        <Sparkline series={x.series} today={today} />
                      </div>
                    ))}
                  </div>
                );
              })}
              {!own.length ? <p className="muted small">Sin formularios. <Link to={`/gestion/${a.slug}`}>Añadir uno</Link></p> : null}
            </section>
          );
        })}
      </div>
      {!areas.length && !s.loading ? (
        <p className="muted">No hay áreas activas. <Link to="/gestion">Crea la primera</Link>.</p>
      ) : null}
    </main>
  );
}
