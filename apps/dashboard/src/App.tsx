import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, rpc, supabase } from './supabase';
import { StructureProvider, useStructure } from './data';
import { Link, match, useLocation } from './router';
import { flushOutbox, readOutbox } from './outbox';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { AreaPage } from './pages/AreaPage';
import { EntryForm } from './pages/EntryForm';
import { ManageArea, ManageList } from './pages/Manage';
import { Proposals } from './pages/Proposals';
import { Settings } from './pages/Settings';
import { Consent } from './pages/Consent';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [owner, setOwner] = useState<boolean | null>(null);
  const loc = useLocation();

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return setOwner(null);
    void rpc<{ is_owner: boolean }>('whoami', {}).then((w) => setOwner(w.is_owner)).catch(() => setOwner(false));
    void flushOutbox();
    const on = () => void flushOutbox();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [session]);

  if (!configured) {
    return <main className="login"><h1>LIFE OS</h1><p>Falta la configuración de Supabase (VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY). La pone el workflow de despliegue.</p></main>;
  }
  if (session === undefined) return <main className="login"><p className="muted">Cargando…</p></main>;
  if (!session) return <Login />;
  if (match('/oauth/consent', loc.path)) return <Consent search={loc.search} />;
  if (owner === null) return <main className="login"><p className="muted">Comprobando acceso…</p></main>;
  if (!owner) {
    return (
      <main className="login">
        <h1>Sin acceso</h1>
        <p>Esta cuenta no es la dueña de este LIFE OS.</p>
        <button className="btn" onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button>
      </main>
    );
  }
  return (
    <StructureProvider>
      <Shell path={loc.path} />
    </StructureProvider>
  );
}

function Shell({ path }: { path: string }) {
  const s = useStructure();
  const [queued, setQueued] = useState(readOutbox().length);
  useEffect(() => {
    const on = () => setQueued(readOutbox().length);
    window.addEventListener('lifeos-outbox', on);
    return () => window.removeEventListener('lifeos-outbox', on);
  }, []);

  let page;
  let m: Record<string, string> | null;
  if (path === '/' || path === '') page = <Overview />;
  else if ((m = match('/a/:area/:form/nuevo', path))) page = <EntryForm key={path} areaSlug={m.area} formSlug={m.form} />;
  else if ((m = match('/a/:area/:form/editar/:id', path))) page = <EntryForm key={path} areaSlug={m.area} formSlug={m.form} entryId={m.id} />;
  else if (path === '/a') page = <AreasIndex />;
  else if ((m = match('/a/:area', path))) page = <AreaPage key={path} slug={m.area} />;
  else if (path === '/gestion') page = <ManageList />;
  else if ((m = match('/gestion/:area', path))) page = <ManageArea key={path} slug={m.area} />;
  else if (path === '/propuestas') page = <Proposals />;
  else if (path === '/ajustes') page = <Settings />;
  else page = <main><p>Página no encontrada.</p><Link to="/">Ir al inicio</Link></main>;

  const isOn = (to: string) =>
    to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`) || (to === '/a' && path.startsWith('/gestion'));
  const tab = (to: string, label: string, badge?: number) => (
    <Link to={to} className={isOn(to) ? 'tab on' : 'tab'}>
      {label}{badge ? <span className="badge">{badge}</span> : null}
    </Link>
  );

  return (
    <>
      {queued ? <Link to="/ajustes" className="banner top">{queued} {queued === 1 ? 'registro pendiente' : 'registros pendientes'} de enviar</Link> : null}
      {s.error ? <p className="error pad">No se pudo cargar la estructura: {s.error}</p> : null}
      {s.loading ? <p className="muted pad">Cargando…</p> : page}
      <nav className="tabs">
        {tab('/', 'Hoy')}
        {tab('/a', 'Áreas')}
        {tab('/propuestas', 'Propuestas', s.pendingProposals)}
        {tab('/ajustes', 'Ajustes')}
      </nav>
    </>
  );
}

function AreasIndex() {
  const s = useStructure();
  return (
    <main>
      <header className="page-head"><h1>Áreas</h1></header>
      <ul className="area-list">
        {s.areas.filter((a) => a.status === 'active').map((a) => (
          <li key={a.id}>
            <Link to={`/a/${a.slug}`} className="area-tile">
              <span className="icon">{a.icon}</span>
              <span className="grow">{a.name}</span>
              <span className="muted small">{s.forms.filter((f) => f.area_id === a.id && f.status === 'active').length} cuestionarios</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/gestion" className="btn wide">Crear, modificar o archivar áreas</Link>
    </main>
  );
}
