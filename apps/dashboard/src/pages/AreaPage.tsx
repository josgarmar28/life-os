import { useState } from 'react';
import { addDays, fieldSeries, formatStat, formatValue, localDate, weekStart } from '@shared/stats.ts';
import type { Entry, Field } from '@shared/model.ts';
import { CADENCE_LABEL } from '@shared/model.ts';
import { loadEntries, useAsync, useStructure } from '../data';
import { Skeleton } from '../components/Skeleton';
import { Link } from '../router';
import { send } from '../outbox';
import { explainError } from '../supabase';
import { TrendChart } from '../components/TrendChart';
import { entrySummary, groupSets, keyFields, rowsPerWeek } from '../history';

const RANGES: [number, string][] = [[30, '30 días'], [90, '90 días'], [365, '1 año']];
const dayLabel = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  return `${t.toLocaleDateString('es-ES', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')} ${d.slice(8)}/${d.slice(5, 7)}`;
};

export function AreaPage({ slug }: { slug: string }) {
  const s = useStructure();
  const area = s.areas.find((a) => a.slug === slug);
  const today = localDate(new Date(), s.timezone);
  const [days, setDays] = useState(30);
  const forms = s.forms.filter((f) => f.area_id === area?.id && f.status === 'active');
  const entries = useAsync(
    () => loadEntries({ formIds: forms.map((f) => f.id), from: addDays(today, -(days - 1)), to: today }),
    [area?.id, forms.length, days, today],
    `area:${area?.id}:${days}:${today}`,
  );
  const [msg, setMsg] = useState<string | null>(null);

  if (!area) return <main><p>No existe esa área.</p><Link to="/">Volver</Link></main>;

  async function remove(id: string) {
    if (!confirm('¿Borrar este registro? Quedará en el historial, pero dejará de contar.')) return;
    try {
      await send('void_entry', { p_entry_id: id, p_request_id: crypto.randomUUID(), p_note: '' }, 'Borrado');
      await entries.reload();
    } catch (e) {
      setMsg(explainError(e));
    }
  }

  return (
    <main>
      <header className="page-head">
        <h1>{area.icon} {area.name}</h1>
        {area.description ? <p className="muted">{area.description}</p> : null}
        {area.status === 'archived' ? <p className="banner">Área archivada: no admite registros nuevos.</p> : null}
        <Link to={`/gestion/${area.slug}`} className="link">Editar área y cuestionarios</Link>
      </header>
      <div className="subtabs" role="radiogroup" aria-label="Periodo">
        {RANGES.map(([d, label]) => (
          <button key={d} type="button" role="radio" aria-checked={days === d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{label}</button>
        ))}
      </div>
      {msg ? <p className="error">{msg}</p> : null}
      {forms.map((f) => {
        const fields = s.fields.filter((x) => x.form_id === f.id);
        const own = (entries.data ?? []).filter((e) => e.form_id === f.id);
        return (
          <section className="card" key={f.id}>
            <div className="card-head">
              <h2>{f.name}</h2>
              <Link to={`/a/${area.slug}/${f.slug}/nuevo`} className="btn small primary">Registrar</Link>
            </div>
            <p className="muted small">{CADENCE_LABEL[f.cadence]}{f.description ? ` · ${f.description}` : ''}</p>
            {!entries.data && entries.loading ? <Skeleton rows={3} title={false} /> : <>
            <Trends fields={fields} entries={own} from={addDays(today, -(days - 1))} to={today} />
            {own.length ? (
              <ul className="entries">
                {own.map((e) => (
                  <li key={e.id} className="entry">
                    <details>
                      <summary>
                        <span className="entry-day">{dayLabel(e.local_date)}</span>
                        <span className="entry-sum">{entrySummary(fields, e)}</span>
                        <span className="chev" aria-hidden="true">›</span>
                      </summary>
                      <EntryDetail fields={fields} entry={e} timezone={s.timezone} />
                      <div className="entry-actions">
                        <Link to={`/a/${area.slug}/${f.slug}/editar/${e.id}`} className="btn small">Editar</Link>
                        <button className="btn small ghost danger" onClick={() => void remove(e.id)}>Borrar</button>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            ) : <p className="muted small">Sin registros en los últimos {days} días.</p>}
            </>}
          </section>
        );
      })}

    </main>
  );
}

/** Gráficas del periodo: las dos primeras a la vista y el resto plegadas. */
function Trends({ fields, entries, from, to }: { fields: Field[]; entries: Entry[]; from: string; to: string }) {
  const charts: { key: string; label: string; node: JSX.Element }[] = [];
  for (const f of fields) {
    if (f.type === 'table' && f.status === 'active') {
      const weeks = rowsPerWeek(f, entries, from, to);
      if (weeks.some((w) => w.value > 0)) {
        charts.push({ key: f.key, label: `${f.label} por semana`, node: <TrendChart series={weeks} from={weekStart(from)} to={to} label={`${f.label} por semana`} format={(v) => String(Math.round(v))} bars /> });
      }
    }
  }
  for (const f of keyFields(fields)) {
    const series = fieldSeries(f, entries, from, to);
    if (series.length < 2) continue;
    const fmt = (v: number) => formatStat(f, v);
    charts.push({ key: f.key, label: `${f.label}${f.unit && f.type !== 'duration' ? ` (${f.unit})` : ''}`, node: <TrendChart series={series} from={from} to={to} label={f.label} format={fmt} /> });
  }
  if (!charts.length) return null;
  const block = (c: (typeof charts)[number]) => (
    <figure key={c.key} className="trend-block">
      <figcaption className="muted small">{c.label}</figcaption>
      {c.node}
    </figure>
  );
  return (
    <div className="trends">
      {charts.slice(0, 2).map(block)}
      {charts.length > 2 ? (
        <details className="more">
          <summary>Más gráficas ({charts.length - 2})</summary>
          {charts.slice(2).map(block)}
        </details>
      ) : null}
      {charts.some((c) => !c.label.endsWith('por semana')) ? <p className="muted small legend"><span className="legend-dot" /> cada día · <span className="legend-line" /> media de 7 días</p> : null}
    </div>
  );
}

function EntryDetail({ fields, entry: e, timezone }: { fields: Field[]; entry: Entry; timezone: string }) {
  return (
    <div className="entry-detail">
      <p className="muted small">
        {new Date(e.occurred_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: timezone })}
        {e.source === 'claude' ? ' · lo registró Claude' : ''}{e.quality === 'estimated' ? ' · estimado' : ''}
      </p>
      <dl className="values">
        {fields.filter((x) => e.data[x.key] !== undefined && x.type !== 'table').map((x) => (
          <div key={x.key}>
            <dt>{x.label}</dt>
            <dd>{formatValue(x, e.data[x.key])}</dd>
          </div>
        ))}
      </dl>
      {fields.filter((x) => x.type === 'table' && Array.isArray(e.data[x.key])).map((x) => (
        <ul key={x.key} className="sets">
          {groupSets(x, e.data[x.key] as Record<string, unknown>[]).map((g, i) => (
            <li key={i}>
              <strong>{g.name}</strong>{g.machine ? <span className="muted small"> · {g.machine}</span> : null}
              <span className="block">{g.text}</span>
            </li>
          ))}
        </ul>
      ))}
      {e.note ? <p className="note">{e.note}</p> : null}
    </div>
  );
}
