import { useState } from 'react';
import type { FieldType, Proposal } from '@shared/model.ts';
import { CADENCE_LABEL, TYPE_LABEL } from '@shared/model.ts';
import { loadProposals, useAsync, useStructure } from '../data';
import { explainError, rpc } from '../supabase';

const KIND_LABEL: Record<Proposal['kind'], string> = {
  'area.save': 'Crear o cambiar un área',
  'form.save': 'Crear o cambiar un cuestionario',
  'field.save': 'Crear o cambiar un campo',
  'form.archive': 'Archivar un cuestionario',
  'field.archive': 'Archivar un campo',
  note: 'Recomendación',
};
const STATUS_LABEL: Record<Proposal['status'], string> = {
  pending: 'Pendiente', applied: 'Aplicada', rejected: 'Rechazada', failed: 'Falló', expired: 'Caducada',
};

export function Proposals() {
  const s = useStructure();
  const list = useAsync(loadProposals, []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(p: Proposal, approve: boolean) {
    setBusy(p.id);
    setError(null);
    try {
      // El hash ata la aprobación a exactamente lo que ves en pantalla.
      const r = await rpc<{ status: string; error?: string }>('decide_proposal', { p_id: p.id, p_approve: approve, p_payload_hash: p.payload_hash });
      if (r.status === 'failed') setError(`No se pudo aplicar: ${explainError(new Error(r.error ?? ''))}`);
      await Promise.all([list.reload(), s.reload()]);
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  const pending = (list.data ?? []).filter((p) => p.status === 'pending');
  const done = (list.data ?? []).filter((p) => p.status !== 'pending');
  return (
    <main>
      <header className="page-head"><h1>Propuestas de Claude</h1>
        <p className="muted">Claude no cambia la estructura por su cuenta: lo propone y tú decides.</p></header>
      {error ? <p className="error">{error}</p> : null}
      {list.loading && !list.data ? <p className="muted">Cargando…</p> : null}
      {!pending.length && list.data ? <p className="ok-line">No hay nada pendiente.</p> : null}
      {pending.map((p) => (
        <section className="card" key={p.id}>
          <h2>{KIND_LABEL[p.kind]}</h2>
          <p>{p.rationale}</p>
          <Summary p={p} />
          <details>
            <summary className="muted small">Ver el contenido exacto</summary>
            <pre className="payload">{JSON.stringify(p.payload, null, 2)}</pre>
          </details>
          <p className="muted small">Caduca el {new Date(p.expires_at).toLocaleDateString('es-ES')}</p>
          <div className="row gap">
            <button className="btn primary" disabled={busy === p.id} onClick={() => void decide(p, true)}>Aprobar</button>
            <button className="btn ghost" disabled={busy === p.id} onClick={() => void decide(p, false)}>Rechazar</button>
          </div>
        </section>
      ))}
      {done.length ? (
        <section className="card">
          <h2>Historial</h2>
          <ul className="list">
            {done.slice(0, 30).map((p) => (
              <li key={p.id}><span className="grow">{KIND_LABEL[p.kind]}: {p.rationale}</span> <span className="muted small">{STATUS_LABEL[p.status]}</span></li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

type P = Record<string, unknown>;
const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function fieldLine(f: P) {
  const range = f.min != null || f.max != null ? ` ${text(f.min ?? '…')}–${text(f.max ?? '…')}` : '';
  const opts = Array.isArray(f.options) && f.options.length ? `: ${(f.options as P[]).map((o) => text(o.label ?? o.value)).join(', ')}` : '';
  const cols = Array.isArray(f.columns) && f.columns.length ? ` (${(f.columns as P[]).map((c) => text(c.label)).join(', ')})` : '';
  return `${text(f.label) || text(f.key)} · ${TYPE_LABEL[f.type as FieldType] ?? text(f.type)}${f.unit ? ` en ${text(f.unit)}` : ''}${range}${opts}${cols}${f.required ? ' · obligatorio' : ''}`;
}

/** Lo que cambia, en palabras: nombre del área y del cuestionario, si es nuevo o modifica algo, y sus campos. */
function Summary({ p }: { p: Proposal }) {
  const s = useStructure();
  const x = p.payload as P;
  const area = s.areas.find((a) => a.id === x.area_id || a.slug === (x.area ?? (p.kind === 'area.save' ? x.slug : undefined)) || (p.kind === 'area.save' && a.id === x.id));
  const form = s.forms.find((f) => f.id === x.form_id || (p.kind.startsWith('form.') && f.id === x.id)
    || (area && f.area_id === area.id && f.slug === (x.form ?? (p.kind.startsWith('form.') ? x.slug : undefined))));
  const field = p.kind.startsWith('field.') ? s.fields.find((f) => f.id === x.id || (form && f.form_id === form.id && f.key === x.key)) : undefined;
  const isNew = p.kind === 'area.save' ? !area : p.kind === 'form.save' ? !form : p.kind === 'field.save' ? !field : false;
  const where = [area ? `${area.icon} ${area.name}` : text(x.area), form?.name ?? text(x.form)].filter(Boolean).join(' › ');
  const tag = p.kind.endsWith('.archive') || p.kind === 'note' ? null : <span className={isNew ? 'tag new' : 'tag'}>{isNew ? 'Nuevo' : 'Modifica'}</span>;

  switch (p.kind) {
    case 'area.save':
      return <p>{tag} <strong>{text(x.icon)} {text(x.name)}</strong>{area && area.name !== x.name ? <span className="muted"> (antes: {area.name})</span> : null}</p>;
    case 'form.save':
      return (
        <div>
          <p>{tag} <strong>{text(x.name)}</strong> <span className="muted">en {where || 'área desconocida'} · {CADENCE_LABEL[x.cadence as keyof typeof CADENCE_LABEL] ?? text(x.cadence)}</span></p>
          {Array.isArray(x.fields) && x.fields.length ? <ul className="list compact">{(x.fields as P[]).map((f, i) => <li key={i}>{fieldLine(f)}</li>)}</ul> : null}
        </div>
      );
    case 'field.save':
      return <p>{tag} <span className="muted">{where} ›</span> {fieldLine(x)}{field && field.label !== x.label ? <span className="muted"> (antes: {field.label})</span> : null}</p>;
    case 'form.archive':
      return <p>Archivar <strong>{form?.name ?? text(x.form ?? x.id)}</strong> <span className="muted">en {area?.name ?? text(x.area)}</span>. Los datos se conservan.</p>;
    case 'field.archive':
      return <p>Archivar el campo <strong>{field?.label ?? text(x.key ?? x.id)}</strong> <span className="muted">de {where}</span>. Los datos se conservan.</p>;
    default:
      return <p className="note">{text(x.text)}</p>;
  }
}
