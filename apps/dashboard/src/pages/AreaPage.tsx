import { useState } from 'react';
import { addDays, formatValue, localDate } from '@shared/stats.ts';
import { CADENCE_LABEL } from '@shared/model.ts';
import { loadEntries, useAsync, useStructure } from '../data';
import { Link } from '../router';
import { send } from '../outbox';
import { explainError } from '../supabase';

export function AreaPage({ slug }: { slug: string }) {
  const s = useStructure();
  const area = s.areas.find((a) => a.slug === slug);
  const today = localDate(new Date(), s.timezone);
  const [days, setDays] = useState(30);
  const forms = s.forms.filter((f) => f.area_id === area?.id && f.status === 'active');
  const entries = useAsync(
    () => loadEntries({ formIds: forms.map((f) => f.id), from: addDays(today, -(days - 1)), to: today }),
    [area?.id, forms.length, days, today],
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
            {own.length ? (
              <ul className="entries">
                {own.map((e) => (
                  <li key={e.id} className="entry">
                    <div className="entry-head">
                      <strong>{e.local_date.split('-').reverse().join('/')}</strong>
                      <span className="muted small">
                        {new Date(e.occurred_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: s.timezone })}
                        {e.source === 'claude' ? ' · Claude' : ''}{e.quality === 'estimated' ? ' · estimado' : ''}
                      </span>
                      <span className="grow" />
                      <Link to={`/a/${area.slug}/${f.slug}/editar/${e.id}`} className="link">Editar</Link>
                      <button className="link danger" onClick={() => void remove(e.id)}>Borrar</button>
                    </div>
                    <dl className="values">
                      {fields.filter((x) => e.data[x.key] !== undefined).map((x) => (
                        <div key={x.key}>
                          <dt>{x.label}</dt>
                          <dd>
                            {x.type === 'table' && Array.isArray(e.data[x.key]) ? (
                              <ul className="rows">
                                {(e.data[x.key] as Record<string, unknown>[]).map((r, i) => (
                                  <li key={i}>{x.columns.filter((c) => r[c.key] !== undefined).map((c) => `${c.label}: ${formatValue({ type: c.type, unit: c.unit ?? '', options: c.options ?? [], columns: [] }, r[c.key])}`).join(' · ')}</li>
                                ))}
                              </ul>
                            ) : formatValue(x, e.data[x.key])}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {e.note ? <p className="note">{e.note}</p> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="muted small">Sin registros en los últimos {days} días.</p>}
          </section>
        );
      })}
      <div className="row center">
        {days < 365 ? <button className="btn ghost" onClick={() => setDays(days < 90 ? 90 : 365)}>Ver más días</button> : null}
      </div>
    </main>
  );
}
