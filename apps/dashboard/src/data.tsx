// Estructura (áreas, formularios, campos) cargada una vez y compartida; entradas bajo demanda.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Area, Entry, Field, Form, Proposal } from '@shared/model.ts';
import { byOrder } from '@shared/model.ts';
import { api, fetchAll, rpc } from './supabase';

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

export function StructureProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Structure>({ areas: [], forms: [], fields: [], timezone: 'Europe/Zurich', pendingProposals: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setS(await loadStructure());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
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

/** Hook genérico de carga asíncrona con recarga. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await fn(), error: null, loading: false });
    } catch (e) {
      setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void run();
  }, [run]);
  return { ...state, reload: run };
}
