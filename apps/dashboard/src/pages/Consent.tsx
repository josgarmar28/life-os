// Pantalla de consentimiento del servidor OAuth de Supabase (Authorization Path = /oauth/consent).
// Aquí apruebas que Claude acceda a LIFE OS con tu cuenta. Supabase redirige con ?authorization_id=…
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

interface Details {
  authorization_id: string;
  redirect_uri: string;
  client: { name: string; uri: string };
  scope: string;
}

export function Consent({ search }: { search: string }) {
  const id = new URLSearchParams(search).get('authorization_id') ?? '';
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('Falta authorization_id en la dirección.');
      return;
    }
    void supabase.auth.oauth.getAuthorizationDetails(id).then(({ data, error: err }) => {
      if (err || !data) return setError(err?.message ?? 'No se encontró la solicitud.');
      if ('redirect_url' in data && !('authorization_id' in data)) return window.location.replace(data.redirect_url);
      setDetails(data as Details);
    });
  }, [id]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error: err } = approve
      ? await supabase.auth.oauth.approveAuthorization(id)
      : await supabase.auth.oauth.denyAuthorization(id);
    if (err || !data) {
      setBusy(false);
      return setError(err?.message ?? 'Error al decidir.');
    }
    window.location.replace(data.redirect_url);
  }

  let host = '';
  try {
    host = details ? new URL(details.redirect_uri).host : '';
  } catch {
    host = details?.redirect_uri ?? '';
  }
  const trusted = host === 'claude.ai' || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

  return (
    <main className="login">
      <h1>Conectar con LIFE OS</h1>
      {error ? <p className="error">{error}</p> : null}
      {details ? (
        <section className="card">
          <p><strong>{details.client.name || 'Una aplicación'}</strong> quiere acceder a tu LIFE OS con tu cuenta.</p>
          <p className="small">Te devolverá a: <strong>{host}</strong></p>
          {!trusted ? <p className="error">Ese destino no es claude.ai. Si no lo esperabas, rechaza.</p> : null}
          {host.startsWith('localhost') || host.startsWith('127.') ? <p className="muted small">Destino local (Claude Code en tu ordenador). Apruébalo solo si lo acabas de iniciar tú.</p> : null}
          <p className="muted small">Podrá leer tus áreas y registros, registrar datos y proponer cambios. No podrá cambiar la estructura ni aprobar nada sin ti.</p>
          <div className="row gap">
            <button className="btn primary" disabled={busy} onClick={() => void decide(true)}>Permitir</button>
            <button className="btn ghost" disabled={busy} onClick={() => void decide(false)}>Rechazar</button>
          </div>
        </section>
      ) : !error ? <p className="muted">Cargando…</p> : null}
    </main>
  );
}
