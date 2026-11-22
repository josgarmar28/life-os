import { useEffect, useState } from 'react';
import { api, explainError, fetchAll, mcpUrl, rpc, supabase } from '../supabase';
import { useAsync, useStructure } from '../data';
import { discard, flushOutbox, readOutbox, type Pending } from '../outbox';
import { PLAN_LABEL, parsePlanFile, planSummary, type PlanFileItem, type PlanKind, type PlanRow } from '@shared/plans.ts';
import { shortDate, usePlans } from '../plans';

interface Activity { ts: string; actor: string; action: string; table_name: string; row_id: string | null }

const ACTION_LABEL: Record<string, string> = {
  'entry.create': 'Registro nuevo', 'entry.correct': 'Corrección', 'entry.void': 'Registro borrado',
  'area.create': 'Área creada', 'area.update': 'Área modificada', 'area.archived': 'Área archivada', 'area.active': 'Área recuperada', 'area.purge': 'Área borrada',
  'form.create': 'Cuestionario creado', 'form.update': 'Cuestionario modificado', 'form.archived': 'Cuestionario archivado', 'form.active': 'Cuestionario recuperado',
  'field.create': 'Campo creado', 'field.update': 'Campo modificado', 'field.archived': 'Campo archivado', 'field.active': 'Campo recuperado',
  'plan.save': 'Plan guardado', 'plan.archived': 'Plan archivado', 'plan.active': 'Plan recuperado', 'week.save': 'Semana ajustada',
  'stock.record': 'Despensa actualizada', 'order.create': 'Pedido hecho', 'order.received': 'Pedido recibido', 'order.cancelled': 'Pedido cancelado',
  'proposal.create': 'Propuesta nueva', 'proposal.applied': 'Propuesta aprobada', 'proposal.rejected': 'Propuesta rechazada', 'proposal.failed': 'Propuesta fallida', 'proposal.expired': 'Propuesta caducada',
};

export function Settings() {
  const s = useStructure();
  const activity = useAsync(() => rpc<Activity[]>('recent_activity', { p_limit: 40 }), []);
  const [outbox, setOutbox] = useState<Pending[]>(readOutbox());
  const [email, setEmail] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const on = () => setOutbox(readOutbox());
    window.addEventListener('lifeos-outbox', on);
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
    return () => window.removeEventListener('lifeos-outbox', on);
  }, []);

  async function exportAll() {
    setExporting(true);
    try {
      const views = ['areas', 'forms', 'fields', 'entries', 'entry_versions', 'proposals', 'plans', 'weeks', 'stock_moves', 'shopping_orders'];
      const rows = await Promise.all(views.map((v) => fetchAll<unknown>((a, b) => api().from(v).select('*').range(a, b))));
      const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
      views.forEach((v, i) => { out[v] = rows[i]; });
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `lifeos-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  }

  return (
    <main>
      <header className="page-head"><h1>Ajustes</h1><p className="muted">{email} · zona horaria {s.timezone}</p></header>

      {outbox.length ? (
        <section className="card">
          <h2>Pendiente de enviar ({outbox.length})</h2>
          <ul className="list">
            {outbox.map((p, i) => (
              <li key={p.queuedAt + i}>
                <span className="grow">{p.label}{p.error ? <span className="error small"> · {p.error}</span> : null}</span>
                {p.error ? <button className="link danger" onClick={() => discard(i)}>Descartar</button> : null}
              </li>
            ))}
          </ul>
          <button className="btn" onClick={() => void flushOutbox()}>Reintentar ahora</button>
        </section>
      ) : null}

      <PlansCard />

      <PasswordCard />

      <section className="card">
        <h2>Conector de Claude</h2>
        <p className="small">En Claude: Ajustes › Conectores › Añadir conector personalizado, con esta URL. Al conectar, te pedirá entrar aquí y aprobar el acceso.</p>
        <code className="copy">{mcpUrl || 'Sin configurar'}</code>
        <p className="muted small">Claude puede leer y registrar datos. Para cambiar áreas, cuestionarios o campos solo puede proponer; decides tú en Propuestas.</p>
      </section>

      <section className="card">
        <h2>Instalar en el iPhone</h2>
        <p className="small">En Safari: botón Compartir › «Añadir a pantalla de inicio». Se abre como una app y funciona sin conexión para registrar (se envía al volver la red).</p>
      </section>

      <section className="card">
        <h2>Tus datos</h2>
        <p className="small">Descarga todo (estructura, registros y su historial, planes, despensa y pedidos) en un archivo JSON. Las copias automáticas cifradas las hace GitHub cada día.</p>
        <button className="btn" disabled={exporting} onClick={() => void exportAll()}>{exporting ? 'Preparando…' : 'Exportar todo'}</button>
      </section>

      <section className="card">
        <h2>Actividad reciente</h2>
        {activity.error ? <p className="error">{activity.error}</p> : null}
        <ul className="list">
          {(activity.data ?? []).map((a, i) => (
            <li key={i}>
              <span className="grow">{ACTION_LABEL[a.action] ?? a.action}{a.actor.startsWith('agent:') ? ' · Claude' : ''}</span>
              <span className="muted small">{new Date(a.ts).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short', timeZone: s.timezone })}</span>
            </li>
          ))}
        </ul>
      </section>

      <button className="btn ghost wide" onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button>
    </main>
  );
}

// Contraseña para entrar desde la app del iPhone (que no comparte sesión con Safari) y en la
// pantalla de consentimiento del conector. Mínimo 10 caracteres; mejor una frase larga del gestor.
function PasswordCard() {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    if (pw.length < 10) return setMsg({ ok: false, text: 'Usa al menos 10 caracteres.' });
    if (pw !== pw2) return setMsg({ ok: false, text: 'Las dos contraseñas no coinciden.' });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      const text = /reauthentication|recent/i.test(error.message)
        ? 'Por seguridad, cierra sesión, entra de nuevo con un enlace por correo y vuelve a intentarlo.'
        : /weak|pwned|leaked/i.test(error.message) ? 'Esa contraseña es débil o ha aparecido en filtraciones; elige otra.'
          : /same|different from the old/i.test(error.message) ? 'Es la misma contraseña que ya tenías.' : error.message;
      return setMsg({ ok: false, text });
    }
    setPw('');
    setPw2('');
    setMsg({ ok: true, text: 'Contraseña guardada. Ya puedes entrar con ella desde la app del iPhone.' });
  }

  return (
    <section className="card">
      <h2>Contraseña</h2>
      <p className="small">Para entrar desde la app del iPhone y al conectar Claude. Guárdala en tu gestor de contraseñas.</p>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label>Nueva contraseña<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>Repítela<input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        <button className="btn" disabled={busy || !pw}>Guardar contraseña</button>
      </form>
      {msg ? <p className={msg.ok ? 'ok-line small' : 'error'}>{msg.text}</p> : null}
    </section>
  );
}

// Planes: horario, rutina y menú. Se importan desde un archivo JSON (los tuyos están en tu carpeta privada
// del proyecto, nunca en el repositorio). Cada importación crea una versión nueva; las anteriores se guardan.
function PlansCard() {
  const p = usePlans();
  const [file, setFile] = useState<{ name: string; plans: PlanFileItem[]; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function read(f: File | undefined) {
    setMsg(null);
    if (!f) return setFile(null);
    try {
      setFile({ name: f.name, ...parsePlanFile(JSON.parse(await f.text())) });
    } catch {
      setFile({ name: f.name, plans: [], errors: ['No es un JSON válido'] });
    }
  }

  async function save() {
    if (!file?.plans.length) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const pl of file.plans) await rpc('save_plan', { p_kind: pl.kind, p_name: pl.name, p_valid_from: pl.valid_from, p_content: pl.content });
      await p.reload();
      setMsg({ ok: true, text: `Guardado: ${file.plans.map((x) => PLAN_LABEL[x.kind]).join(', ')}.` });
      setFile(null);
    } catch (e) {
      setMsg({ ok: false, text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(r: PlanRow, status: 'active' | 'archived') {
    try {
      await rpc('set_plan_status', { p_id: r.id, p_status: status });
      await p.reload();
    } catch (e) {
      setMsg({ ok: false, text: explainError(e) });
    }
  }

  function download(r: PlanRow) {
    const blob = new Blob([JSON.stringify({ kind: r.kind, name: r.name, valid_from: r.valid_from, content: r.content }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `plan-${r.kind}-v${r.version}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const kinds: PlanKind[] = ['schedule', 'training', 'meals'];
  return (
    <section className="card">
      <h2>Planes</h2>
      <p className="small">Horario, rutina y menú con su compra. Importa el archivo de planes (o pide a Claude una versión nueva y apruébala en Propuestas). Cada versión rige desde su fecha; las anteriores se guardan.</p>
      {kinds.map((k) => {
        const rows = p.plans.filter((r) => r.kind === k).sort((a, b) => b.version - a.version);
        return (
          <div key={k} className="plan-group">
            <h3>{PLAN_LABEL[k]}</h3>
            {!rows.length ? <p className="muted small">Sin importar.</p> : (
              <ul className="list compact">
                {rows.slice(0, 5).map((r) => (
                  <li key={r.id} className={r.status === 'archived' ? 'dim' : ''}>
                    <span className="grow">v{r.version} · {r.name}<span className="muted small"> · desde {shortDate(r.valid_from, { day: 'numeric', month: 'short', year: 'numeric' })}{r.source === 'claude' ? ' · de Claude' : ''}{r.status === 'archived' ? ' · archivado' : ''}</span></span>
                    <button className="link" onClick={() => download(r)}>Descargar</button>
                    <button className="link" onClick={() => void setStatus(r, r.status === 'archived' ? 'active' : 'archived')}>{r.status === 'archived' ? 'Recuperar' : 'Archivar'}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <label>Importar archivo de planes (.json)<input type="file" accept="application/json,.json" onChange={(e) => void read(e.target.files?.[0])} /></label>
      {file ? (
        <div className="stack">
          {file.errors.length ? <ul className="error small">{file.errors.slice(0, 12).map((e) => <li key={e}>{e}</li>)}</ul> : null}
          {file.plans.map((pl) => (
            <details key={pl.kind + pl.name} open>
              <summary><strong>{PLAN_LABEL[pl.kind]}</strong>: {pl.name} <span className="muted small">· desde {shortDate(pl.valid_from, { day: 'numeric', month: 'short', year: 'numeric' })}</span></summary>
              <ul className="list compact">{planSummary(pl.kind, pl.content).slice(0, 12).map((l, i) => <li key={i}>{l}</li>)}</ul>
            </details>
          ))}
          <button className="btn primary" disabled={busy || !file.plans.length || file.errors.length > 0} onClick={() => void save()}>
            {busy ? 'Guardando…' : `Guardar ${file.plans.length} ${file.plans.length === 1 ? 'plan' : 'planes'}`}
          </button>
        </div>
      ) : null}
      {msg ? <p className={msg.ok ? 'ok-line small' : 'error'}>{msg.text}</p> : null}
    </section>
  );
}
