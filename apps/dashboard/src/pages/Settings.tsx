import { useEffect, useState } from 'react';
import { api, fetchAll, mcpUrl, rpc, supabase } from '../supabase';
import { useAsync, useStructure } from '../data';
import { discard, flushOutbox, readOutbox, type Pending } from '../outbox';

interface Activity { ts: string; actor: string; action: string; table_name: string; row_id: string | null }

const ACTION_LABEL: Record<string, string> = {
  'entry.create': 'Registro nuevo', 'entry.correct': 'Corrección', 'entry.void': 'Registro borrado',
  'area.create': 'Área creada', 'area.update': 'Área modificada', 'area.archived': 'Área archivada', 'area.active': 'Área recuperada', 'area.purge': 'Área borrada',
  'form.create': 'Cuestionario creado', 'form.update': 'Cuestionario modificado', 'form.archived': 'Cuestionario archivado', 'form.active': 'Cuestionario recuperado',
  'field.create': 'Campo creado', 'field.update': 'Campo modificado', 'field.archived': 'Campo archivado', 'field.active': 'Campo recuperado',
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
      const [areas, forms, fields, entries, versions, proposals] = await Promise.all(
        ['areas', 'forms', 'fields', 'entries', 'entry_versions', 'proposals'].map((v) =>
          fetchAll<unknown>((a, b) => api().from(v).select('*').range(a, b))),
      );
      const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), areas, forms, fields, entries, entry_versions: versions, proposals }, null, 2)], { type: 'application/json' });
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
        <p className="small">Descarga todo (estructura, registros y su historial) en un archivo JSON. Las copias automáticas cifradas las hace GitHub cada día.</p>
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
