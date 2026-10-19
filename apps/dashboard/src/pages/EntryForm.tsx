import { useEffect, useMemo, useState } from 'react';
import type { Entry } from '@shared/model.ts';
import { localDate } from '@shared/stats.ts';
import { useStructure } from '../data';
import { Link, navigate } from '../router';
import { api, explainError } from '../supabase';
import { send } from '../outbox';
import { ScalarInput, TableInput } from '../components/FieldInput';
import { fromData, toPayload, type Cell, type FormState, type Row } from '../values';

export function EntryForm({ areaSlug, formSlug, entryId }: { areaSlug: string; formSlug: string; entryId?: string }) {
  const s = useStructure();
  const area = s.areas.find((a) => a.slug === areaSlug);
  const form = s.forms.find((f) => f.area_id === area?.id && f.slug === formSlug);
  const fields = useMemo(() => s.fields.filter((f) => f.form_id === form?.id && f.status === 'active'), [s.fields, form?.id]);
  const today = localDate(new Date(), s.timezone);

  const [state, setState] = useState<FormState>(() => fromData(fields, {}));
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [estimated, setEstimated] = useState(false);
  const [prev, setPrev] = useState<Entry | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Un request_id por apertura del formulario: reenviar (doble toque, reintento) nunca duplica.
  const [requestId] = useState(() => crypto.randomUUID());

  // La estructura se refresca en segundo plano (y al volver la red): eso nunca debe borrar lo que
  // ya has escrito. Solo se recarga si cambian los campos (ids) o el registro que se corrige.
  const fieldsKey = fields.map((f) => f.id).join(',');
  useEffect(() => {
    if (!entryId) {
      setState((st) => ({ ...fromData(fields, {}), ...st }));
      return;
    }
    void api().from('entries').select('*').eq('id', entryId).maybeSingle().then(({ data, error }) => {
      if (error || !data) {
        setErrors(['Ese registro ya no existe o se corrigió después. Vuelve al área y ábrelo de nuevo.']);
        return;
      }
      const e = data as Entry;
      setPrev(e);
      setState(fromData(fields, e.data));
      setDate(e.local_date);
      setNote(e.note);
      setEstimated(e.quality === 'estimated');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fieldsKey resume `fields`
  }, [entryId, fieldsKey]);

  // Para tablas (p. ej. las series del gimnasio): partir de lo que hiciste la última vez.
  const hasTable = fields.some((f) => f.type === 'table');
  const [last, setLast] = useState<Entry | null>(null);
  useEffect(() => {
    if (entryId || !hasTable || !form?.id) return;
    void api().from('entries').select('*').eq('form_id', form.id)
      .order('local_date', { ascending: false }).order('occurred_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setLast((data as Entry | null) ?? null));
  }, [entryId, hasTable, form?.id]);

  if (!area || !form) return <main><p>No existe ese formulario.</p><Link to="/">Volver</Link></main>;

  const set = (key: string, v: Cell | Row[]) => setState((st) => ({ ...st, [key]: v }));

  async function submit() {
    const { data, errors: errs } = toPayload(fields, state);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    try {
      const occurredAt = prev ? prev.occurred_at : date === today ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString();
      const result = await send('add_entry', {
        p_form_id: form!.id,
        p_values: data,
        p_request_id: requestId,
        p_occurred_at: occurredAt,
        p_local_date: date,
        p_note: note,
        p_quality: estimated ? 'estimated' : 'manual',
        p_supersedes_id: prev?.id ?? null,
      }, `${area!.icon} ${form!.name} ${date}`);
      if (result === 'queued') alert('Sin conexión: el registro queda guardado en el teléfono y se enviará solo al volver la conexión.');
      navigate(`/a/${area!.slug}`);
    } catch (e) {
      setErrors([explainError(e)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="page-head">
        <Link to={`/a/${area.slug}`} className="link">← {area.icon} {area.name}</Link>
        <h1>{form.name}</h1>
        {form.description ? <p className="muted">{form.description}</p> : null}
        {prev ? <p className="banner">Estás corrigiendo un registro: se guarda como versión nueva y la anterior queda en el historial.</p> : null}
      </header>
      <form className="entry-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="field">
          <span className="label">Día</span>
          <input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} disabled={Boolean(prev)} />
        </label>
        {fields.map((f) => (
          <div className="field" key={f.id}>
            <label className="label" htmlFor={`f-${f.key}`}>{f.label}{f.required ? ' *' : ''}</label>
            {f.type === 'table' && last && Array.isArray(last.data[f.key]) && (last.data[f.key] as unknown[]).length ? (
              <button type="button" className="btn small ghost copy-last"
                onClick={() => set(f.key, (fromData([f], last.data)[f.key] as Row[]) ?? [])}>
                Copiar de la última vez ({last.local_date.slice(8)}/{last.local_date.slice(5, 7)}, {(last.data[f.key] as unknown[]).length} filas)
              </button>
            ) : null}
            {f.help ? <p className="muted small">{f.help}</p> : null}
            {f.type === 'table'
              ? <TableInput field={f} rows={(state[f.key] as Row[]) ?? []} onChange={(rows) => set(f.key, rows)} />
              : <ScalarInput id={`f-${f.key}`} type={f.type} label={f.label} unit={f.unit} min={f.min} max={f.max} step={f.step}
                  options={f.options} value={(state[f.key] as Cell) ?? ''} onChange={(v) => set(f.key, v)} />}
          </div>
        ))}
        <label className="field">
          <span className="label">Nota</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={estimated} onChange={(e) => setEstimated(e.target.checked)} />
          Son estimaciones (no medidas)
        </label>
        {errors.length ? <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
        <div className="sticky-actions">
          <button className="btn primary wide" disabled={busy}>{busy ? 'Guardando…' : prev ? 'Guardar corrección' : 'Guardar'}</button>
        </div>
      </form>
    </main>
  );
}
