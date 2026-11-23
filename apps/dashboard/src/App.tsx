import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, rpc, supabase } from './supabase';
import { clearLocalData, StructureProvider, useStructure } from './data';
import { Toaster } from './toast';
import { Link, match, useLocation } from './router';
import { flushOutbox, isNetworkError, readOutbox } from './outbox';
import { Login } from './pages/Login';
import { AreaCards, Overview } from './pages/Overview';
import { AreaPage } from './pages/AreaPage';
import { EntryForm } from './pages/EntryForm';
import { ManageArea, ManageList } from './pages/Manage';
import { Proposals } from './pages/Proposals';
import { Settings } from './pages/Settings';
import { Consent } from './pages/Consent';
import { Week } from './pages/Week';
import { Schedule } from './pages/Schedule';
import { Training } from './pages/Training';
import { Shopping } from './pages/Shopping';
import { More } from './pages/More';
import { PlansProvider } from './plans';
import { PageSkeleton } from './components/Skeleton';

const OWNER_KEY = 'lifeos.owner';
const readKey = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [owner, setOwner] = useState<boolean | null>(null);
  const loc = useLocation();

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === 'SIGNED_OUT') clearLocalData();
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return setOwner(null);
    // Sin red (gimnasio sin cobertura) se usa la última comprobación de este dispositivo para poder registrar.
    const uid = session.user.id;
    // Si este teléfono ya comprobó que es la cuenta dueña, abre sin esperar; la comprobación sigue detrás
    // (los datos los protege la base de datos igualmente).
    if (readKey(OWNER_KEY) === uid) setOwner(true);
    void rpc<{ is_owner: boolean }>('whoami', {})
      .then((w) => {
        setOwner(w.is_owner);
        try { if (w.is_owner) localStorage.setItem(OWNER_KEY, uid); else localStorage.removeItem(OWNER_KEY); } catch { /* sin almacenamiento */ }
      })
      .catch((e) => setOwner(isNetworkError(e) && readKey(OWNER_KEY) === uid));
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
      <PlansProvider>
        <Shell path={loc.path} />
      </PlansProvider>
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
  else if (path === '/semana') page = <Week />;
  else if ((m = match('/semana/:date', path)) && /^\d{4}-\d{2}-\d{2}$/.test(m.date)) page = <Week key={path} date={m.date} />;
  else if (path === '/horario') page = <Schedule />;
  else if ((m = match('/horario/:date', path)) && /^\d{4}-\d{2}-\d{2}$/.test(m.date)) page = <Schedule key={path} date={m.date} />;
  else if (path === '/entreno') page = <Training />;
  else if ((m = match('/entreno/:date', path)) && /^\d{4}-\d{2}-\d{2}$/.test(m.date)) page = <Training key={path} date={m.date} />;
  else if (path === '/compra') page = <Shopping tab="lista" />;
  else if (path === '/compra/despensa') page = <Shopping tab="despensa" />;
  else if (path === '/compra/pedidos') page = <Shopping tab="pedidos" />;
  else if (path === '/mas') page = <More />;
  else if (path === '/propuestas') page = <Proposals />;
  else if (path === '/ajustes') page = <Settings />;
  else page = <main><p>Página no encontrada.</p><Link to="/">Ir al inicio</Link></main>;

  const MORE = ['/mas', '/semana', '/a', '/gestion', '/propuestas', '/ajustes'];
  const under = (to: string) => path === to || path.startsWith(`${to}/`);
  const isOn = (to: string) => (to === '/' ? path === '/' : to === '/mas' ? MORE.some(under) : under(to));
  const tab = (to: string, label: string, badge?: number) => (
    <Link to={to} className={isOn(to) ? 'tab on' : 'tab'} aria-current={isOn(to) ? 'page' : undefined}>
      <TabIcon name={to} />
      <span>{label}{badge ? <span className="badge">{badge}</span> : null}</span>
    </Link>
  );

  return (
    <>
      {queued ? <Link to="/ajustes" className="banner top">{queued} {queued === 1 ? 'registro pendiente' : 'registros pendientes'} de enviar</Link> : null}
      {s.error === 'offline' ? <p className="banner top">Sin conexión: puedes registrar; se enviará al volver la red.</p>
        : s.error ? <p className="error pad">No se pudo cargar la estructura: {s.error}</p> : null}
      {s.loading ? <PageSkeleton /> : page}
      <Toaster />
      <nav className="tabs">
        {tab('/', 'Hoy')}
        {tab('/horario', 'Horario')}
        {tab('/entreno', 'Entreno')}
        {tab('/compra', 'Compra')}
        {tab('/mas', 'Más', s.pendingProposals)}
      </nav>
    </>
  );
}

function AreasIndex() {
  return (
    <main>
      <header className="page-head"><h1>Áreas</h1><p className="muted">Cada área con sus registros y tendencias.</p></header>
      <AreaCards />
      <Link to="/gestion" className="btn wide">Crear, modificar o archivar áreas</Link>
    </main>
  );
}

/** Iconos de la barra inferior (trazo, heredan el color de la pestaña). */
function TabIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    '/': 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    '/horario': 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    '/entreno': 'M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11',
    '/compra': 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6M9 20.5h.01M17 20.5h.01',
    '/mas': 'M5 12h.01M12 12h.01M19 12h.01',
  };
  return (
    <svg className="tab-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === '/mas' ? 3.2 : 1.9}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
