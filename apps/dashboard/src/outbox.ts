// Cola local de registros que no pudieron enviarse (sin cobertura en el gimnasio, por ejemplo).
// Cada registro lleva su request_id: reenviarlo nunca duplica (la BD es idempotente).
// Vive solo en este dispositivo y se vacía en cuanto se envía.
import { rpc } from './supabase';

const KEY = 'lifeos.outbox';

export interface Pending {
  fn: 'add_entry' | 'void_entry';
  args: Record<string, unknown>;
  label: string;
  queuedAt: string;
  error?: string;
}

export function readOutbox(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Pending[];
  } catch {
    return [];
  }
}

function write(items: Pending[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event('lifeos-outbox'));
}

export function isNetworkError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return !navigator.onLine || /Failed to fetch|NetworkError|Load failed|network/i.test(m);
}

/** Envía; si no hay red, encola y devuelve 'queued'. Los errores de validación se lanzan. */
export async function send(fn: Pending['fn'], args: Record<string, unknown>, label: string): Promise<'sent' | 'queued'> {
  return (await sendFull(fn, args, label)).status;
}

/** Como `send`, pero devuelve también lo que responde la base de datos (p. ej. el id del registro). */
export async function sendFull<T = unknown>(fn: Pending['fn'], args: Record<string, unknown>, label: string): Promise<{ status: 'sent'; data: T } | { status: 'queued' }> {
  try {
    return { status: 'sent', data: await rpc<T>(fn, args) };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    write([...readOutbox(), { fn, args, label, queuedAt: new Date().toISOString() }]);
    return { status: 'queued' };
  }
}

let flushing = false;

export async function flushOutbox(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const items = readOutbox();
    const keep: Pending[] = [];
    for (const [i, item] of items.entries()) {
      try {
        await rpc(item.fn, item.args);
      } catch (e) {
        if (isNetworkError(e)) {
          keep.push(...items.slice(i));
          break;
        }
        keep.push({ ...item, error: e instanceof Error ? e.message : String(e) });
      }
    }
    write(keep);
  } finally {
    flushing = false;
  }
}

export function discard(index: number) {
  const items = readOutbox();
  items.splice(index, 1);
  write(items);
}
