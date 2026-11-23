import { useMemo } from 'react';
import { addDays, dueToday, formatDelta, formatStat, formatValue, localDate, summarizeForm, weekStart } from '@shared/stats.ts';
import { CADENCE_LABEL } from '@shared/model.ts';
import { loadEntries, useAsync, useStructure } from '../data';
import { Link } from '../router';
import { Sparkline } from '../components/Sparkline';
import { NowCard } from './Schedule';

/** Datos de los últimos 60 días de todas las áreas activas y su resumen por cuestionario. */
function useSummaries() {
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
  return { s, today, areas, forms, entries, summaries };
}

export function Overview() {
  const { s, today, areas, forms, entries, summaries } = useSummaries();
  const pending = forms.filter((f) => summaries.get(f.id)?.status.done === false);
  const dueNow = pending.filter((f) => dueToday(f.cadence, summaries.get(f.id)!.status, today));
  const later = pending.filter((f) => !dueNow.includes(f));
  const dateLabel = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: s.timezone }).format(new Date());

  // Cifras clave: la primera métrica con datos de cada cuestionario diario (peso, sueño…), hasta 3,
  // y las series de pesas de esta semana.
  const tiles = forms.filter((f) => f.cadence === 'daily').flatMap((f) => {
    const m = summaries.get(f.id)?.fields.find((x) => x.last && x.series.length);
    const a = areas.find((x) => x.id === f.area_id)!;
    return m ? [{ key: f.id, area: a, label: m.field.label, sum: m }] : [];
  }).slice(0, 3);
  const sesion = forms.find((f) => f.slug === 'sesion' && areas.find((a) => a.id === f.area_id)?.slug === 'entreno');
  const ws = weekStart(today);
  const weekSets = sesion ? (entries.data ?? []).filter((e) => e.form_id === sesion.id && e.local_date >= ws)
    .reduce((n, e) => n + (Array.isArray(e.data.series) ? e.data.series.length : 0), 0) : null;

  const item = (f: (typeof forms)[number]) => {
    const a = areas.find((x) => x.id === f.area_id)!;
    return (
      <li key={f.id}>
        <Link to={`/a/${a.slug}/${f.slug}/nuevo`} className="todo-item">
          <span className="todo-icon" aria-hidden="true">{a.icon}</span>
          <span className="grow">{f.name}</span>
          <span className="muted small">{summaries.get(f.id)?.status.label}</span>
          <span className="chev" aria-hidden="true">›</span>
        </Link>
      </li>
    );
  };

  return (
    <main>
      <header className="page-head">
        <h1>Hoy</h1>
        <p className="muted cap">{dateLabel}</p>
      </header>

      <NowCard />

      {s.pendingProposals ? (
        <Link to="/propuestas" className="banner">Claude tiene {s.pendingProposals} {s.pendingProposals === 1 ? 'propuesta' : 'propuestas'} para que decidas.</Link>
      ) : null}

      {dueNow.length ? (
        <section className="card">
          <h2>Por registrar</h2>
          <ul className="todo">{dueNow.map(item)}</ul>
          {later.length ? (
            <details className="later">
              <summary className="muted small">Más adelante esta semana o este mes ({later.length})</summary>
              <ul className="todo">{later.map(item)}</ul>
            </details>
          ) : null}
        </section>
      ) : entries.data ? (
        <section className="card">
          <p className="ok-line">Todo lo previsto está registrado.</p>
          {later.length ? (
            <details className="later">
              <summary className="muted small">Más adelante esta semana o este mes ({later.length})</summary>
              <ul className="todo">{later.map(item)}</ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {entries.error ? <p className="error">No se pudieron cargar los datos: {entries.error}</p> : null}

      {tiles.length || weekSets !== null ? (
        <section className="card" aria-label="Resumen">
          <h2>Resumen</h2>
          <div className="tiles">
            {tiles.map((t) => (
              <Link key={t.key} to={`/a/${t.area.slug}`} className="tile">
                <span className="muted small">{t.area.icon} {t.label}</span>
                <span className="tile-value">{formatValue(t.sum.field, t.sum.last!.value)}</span>
                <span className="muted small">{t.sum.avg7 !== null ? `media 7 d: ${formatStat(t.sum.field, t.sum.avg7)}` : 'sin media aún'}{t.sum.delta7 !== null && Math.abs(t.sum.delta7) >= 0.05 ? ` (${formatDelta(t.sum.field, t.sum.delta7)})` : ''}</span>
                <Sparkline series={t.sum.series} today={today} height={28} />
              </Link>
            ))}
            {weekSets !== null ? (
              <Link to="/a/entreno" className="tile">
                <span className="muted small">🏋️ Series de pesas</span>
                <span className="tile-value">{weekSets}</span>
                <span className="muted small">esta semana</span>
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <Link to="/a" className="btn wide ghost">Todas las áreas y tendencias ›</Link>
      {!areas.length && !s.loading ? (
        <p className="muted">No hay áreas activas. <Link to="/gestion">Crea la primera</Link>.</p>
      ) : null}
    </main>
  );
}

/** Tarjetas de todas las áreas con sus métricas y tendencias (página Áreas). */
export function AreaCards() {
  const { today, areas, forms, entries, summaries } = useSummaries();
  return (
    <>
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
                            {x.avg7 !== null ? `media 7 d: ${formatStat(x.field, x.avg7)}${x.n7 < 4 ? ` (${x.n7} d)` : ''}` : 'sin datos esta semana'}
                            {x.delta7 !== null && Math.abs(x.delta7) >= 0.05 ? ` · ${formatDelta(x.field, x.delta7)} vs. semana anterior` : ''}
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
    </>
  );
}
