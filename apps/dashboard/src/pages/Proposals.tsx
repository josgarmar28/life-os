import { useState } from 'react';
import type { Proposal } from '@shared/model.ts';
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
  const describeTarget = (p: Proposal) => {
    const x = p.payload as Record<string, string>;
    const form = s.forms.find((f) => f.id === (x.form_id ?? x.id));
    const area = s.areas.find((a) => a.id === (x.area_id ?? form?.area_id ?? x.id));
    return [area?.name, form?.name].filter(Boolean).join(' › ');
  };

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
          {describeTarget(p) ? <p className="muted small">{describeTarget(p)}</p> : null}
          <p>{p.rationale}</p>
          <pre className="payload">{JSON.stringify(p.payload, null, 2)}</pre>
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
