// Estructura (áreas, formularios, campos) cargada una vez y compartida; entradas bajo demanda.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Area, Entry, Field, Form, Proposal } from '@shared/model.ts';
import { byOrder } from '@shared/model.ts';
import { api, fetchAll, rpc } from './supabase';
import { isNetworkError } from './outbox';
import { clearWardrobe } from './wardrobe/store';

export interface Structure {
  areas: Area[];
  forms: Form[];
  fields: Field[];
  timezone: string;
  pendingProposals: number;
}

interface Ctx extends Structure {
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const StructureCtx = createContext<Ctx | null>(null);

export async function loadStructure(): Promise<Structure> {
  const [areas, forms, fields, who, pending] = await Promise.all([
    fetchAll<Area>((a, b) => api().from('areas').select('*').range(a, b)),
    fetchAll<Form>((a, b) => api().from('forms').select('*').range(a, b)),
    fetchAll<Field>((a, b) => api().from('fields').select('*').range(a, b)),
    rpc<{ timezone: string }>('whoami', {}),
    api().from('proposals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);
  return {
    areas: areas.sort(byOrder),
    forms: forms.sort(byOrder),
    fields: fields.sort(byOrder),
    timezone: who.timezone,
    pendingProposals: pending.count ?? 0,
  };
}

// Copia local de la ESTRUCTURA (cuestionarios, sin datos personales) para abrir la app y registrar
// sin cobertura; los registros hechos así van a la cola local (outbox) y se envían al volver la red.
const CACHE_KEY = 'lifeos.structure';
const EMPTY: Structure = { areas: [], forms: [], fields: [], timezone: 'Europe/Zurich', pendingProposals: 0 };

function readCache(): Structure | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Structure) : null;
  } catch {
    return null;
  }
}

export function StructureProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Structure>(() => readCache() ?? EMPTY);
  const [loading, setLoading] = useState(() => !readCache());
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const fresh = await loadStructure();
      setS(fresh);
      setError(null);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(fresh)); } catch { /* sin almacenamiento: no pasa nada */ }
    } catch (e) {
      const cached = readCache();
      if (cached && isNetworkError(e)) setError('offline');
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    const on = () => void reload();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [reload]);
  return <StructureCtx.Provider value={{ ...s, loading, error, reload }}>{children}</StructureCtx.Provider>;
}

export function useStructure(): Ctx {
  const c = useContext(StructureCtx);
  if (!c) throw new Error('StructureProvider missing');
  return c;
}

export async function loadEntries(q: { formIds: string[]; from?: string; to?: string }): Promise<Entry[]> {
  if (!q.formIds.length) return [];
  return fetchAll<Entry>((a, b) => {
    let query = api().from('entries').select('*').in('form_id', q.formIds);
    if (q.from) query = query.gte('local_date', q.from);
    if (q.to) query = query.lte('local_date', q.to);
    return query.order('local_date', { ascending: false }).order('occurred_at', { ascending: false }).range(a, b);
  });
}

export async function loadProposals(): Promise<Proposal[]> {
  return fetchAll<Proposal>((a, b) => api().from('proposals').select('*').order('created_at', { ascending: false }).range(a, b), 200, 400);
}

// Últimos datos cargados, guardados en este teléfono para abrir al instante (y sin cobertura) mientras
// llegan los nuevos. Solo en este dispositivo, y se borran al cerrar sesión.
const DATA_PREFIX = 'lifeos.cache.';

function readData<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(DATA_PREFIX + key);
    return raw ? (JSON.parse(raw) as { data: T }).data : null;
  } catch {
    return null;
  }
}

function writeData(key: string, data: unknown) {
  try { localStorage.setItem(DATA_PREFIX + key, JSON.stringify({ data })); } catch { /* sin espacio: se cargará de la red */ }
}

/** Otras copias con datos personales: planes y últimas sesiones de pesas. La cola sin enviar no se toca. */
const PERSONAL_KEYS = ['lifeos.plans', 'lifeos.workouts'];

/** Borra los datos guardados en el teléfono (al cerrar sesión). */
export function clearLocalData() {
  clearWardrobe();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(DATA_PREFIX) || PERSONAL_KEYS.includes(k))) localStorage.removeItem(k);
    }
  } catch { /* nada que borrar */ }
}

/**
 * Hook genérico de carga asíncrona con recarga. Con `cacheKey` (que incluya todo lo que cambia la
 * consulta) la pantalla abre con los últimos datos guardados y los sustituye al llegar los nuevos.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], cacheKey?: string) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>(
    () => ({ data: cacheKey ? readData<T>(cacheKey) : null, error: null, loading: true }),
  );
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fn();
      if (cacheKey) writeData(cacheKey, data);
      setState({ data, error: null, loading: false });
    } catch (e) {
      // Sin red y con datos guardados: se siguen viendo los guardados (el aviso de sin conexión ya sale arriba).
      setState((s) => (s.data !== null && isNetworkError(e)
        ? { ...s, loading: false }
        : { data: null, error: e instanceof Error ? e.message : String(e), loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, cacheKey]);
  // Al cambiar la consulta (otro día, otra área), se enseña lo guardado para la nueva.
  const [lastKey, setLastKey] = useState(cacheKey);
  if (cacheKey !== lastKey) {
    setLastKey(cacheKey);
    setState({ data: cacheKey ? readData<T>(cacheKey) : null, error: null, loading: true });
  }
  useEffect(() => {
    void run();
  }, [run]);
  // Tras deshacer un registro desde el aviso, las pantallas abiertas se recargan.
  useEffect(() => {
    const on = () => void run();
    window.addEventListener('lifeos-entries', on);
    return () => window.removeEventListener('lifeos-entries', on);
  }, [run]);
  return { ...state, reload: run };
}
