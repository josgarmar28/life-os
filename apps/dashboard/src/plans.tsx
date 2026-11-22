// Planes (horario, rutina, menú), semanas, pedidos y despensa: se cargan una vez y se comparten.
// Los planes y la semana se guardan también en el teléfono para abrir el horario y el entreno sin cobertura.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { localDate } from '@shared/stats.ts';
import { planFor, type MealsPlan, type PlanRow, type SchedulePlan, type TrainingPlan, type WeekRow } from '@shared/plans.ts';
import type { StockMove } from '@shared/shopping.ts';
import { api, fetchAll } from './supabase';
import { isNetworkError } from './outbox';
import { useStructure } from './data';

export interface OrderRow {
  id: string;
  status: 'ordered' | 'received' | 'cancelled';
  delivery_date: string;
  items: { product: string; packages: number; amount: number; price?: number }[];
  total: number | null;
  note: string;
  created_at: string;
}

interface Data {
  plans: PlanRow[];
  weeks: WeekRow[];
  orders: OrderRow[];
  moves: StockMove[];
}

interface Ctx extends Data {
  loading: boolean;
  offline: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const KEY = 'lifeos.plans';
const EMPTY: Data = { plans: [], weeks: [], orders: [], moves: [] };
const PlansCtx = createContext<Ctx | null>(null);

function readCache(): Data | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Data>) } : null;
  } catch {
    return null;
  }
}

async function load(tz: string): Promise<Data> {
  const [plans, weeks, orders, moves] = await Promise.all([
    fetchAll<PlanRow>((a, b) => api().from('plans').select('*').order('version').range(a, b)),
    fetchAll<WeekRow>((a, b) => api().from('weeks').select('week_start,telework,away,note').order('week_start').range(a, b)),
    fetchAll<OrderRow>((a, b) => api().from('shopping_orders').select('*').order('created_at', { ascending: false }).range(a, b), 100, 100),
    fetchAll<{ product: string; kind: StockMove['kind']; qty: number; occurred_at: string }>((a, b) =>
      api().from('stock_moves').select('product,kind,qty,occurred_at').order('occurred_at').range(a, b)),
  ]);
  return {
    plans,
    weeks,
    orders,
    moves: moves.map((m) => ({ ...m, qty: Number(m.qty), local_date: localDate(new Date(m.occurred_at), tz) })),
  };
}

export function PlansProvider({ children }: { children: ReactNode }) {
  const s = useStructure();
  const [d, setD] = useState<Data>(() => readCache() ?? EMPTY);
  const [loading, setLoading] = useState(() => !readCache());
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const fresh = await load(s.timezone);
      setD(fresh);
      setOffline(false);
      setError(null);
      try { localStorage.setItem(KEY, JSON.stringify(fresh)); } catch { /* sin almacenamiento */ }
    } catch (e) {
      if (isNetworkError(e)) setOffline(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [s.timezone]);
  useEffect(() => {
    void reload();
    const on = () => void reload();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [reload]);
  return <PlansCtx.Provider value={{ ...d, loading, offline, error, reload }}>{children}</PlansCtx.Provider>;
}

export function usePlans(): Ctx {
  const c = useContext(PlansCtx);
  if (!c) throw new Error('PlansProvider missing');
  return c;
}

/** Los tres planes que rigen en `date` (o el próximo, como vista previa). */
export function usePlansFor(date: string) {
  const p = usePlans();
  return useMemo(() => ({
    schedule: planFor<SchedulePlan>(p.plans, 'schedule', date),
    training: planFor<TrainingPlan>(p.plans, 'training', date),
    meals: planFor<MealsPlan>(p.plans, 'meals', date),
  }), [p.plans, date]);
}

export function shortDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat('es-ES', { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

export function fmtNum(x: number, d = 1): string {
  return (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('es-ES');
}

export function fmtChf(x: number): string {
  return `${x.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CHF`;
}
