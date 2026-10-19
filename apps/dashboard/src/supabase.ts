import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Falta configuración: la app muestra una pantalla explicándolo en lugar de fallar. */
export const configured = Boolean(url && key);

// La clave pública (publishable o "anon") es pública por diseño: el acceso real lo decide RLS.
// Flujo implícito: el enlace del correo funciona aunque se pida desde la app y se abra en Safari
// (PKCE exigiría abrirlo en el mismo navegador que lo pidió).
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'lifeos.auth' },
});

export const api = () => supabase.schema('api');

export const mcpUrl = url ? `${url}/functions/v1/mcp` : '';

/** Lee todas las filas de una consulta paginando (PostgREST limita filas por respuesta). */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  max = 20000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await api().rpc(fn, args);
  if (error) throw new DbError(error.message);
  return data as T;
}

export class DbError extends Error {}

/** Mensajes de la base de datos (en inglés) en español claro. */
export function explainError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const rules: [RegExp, string][] = [
    [/^(.*): required$/m, '$1: es obligatorio'],
    [/^(.*): (.*) is outside \[(.*), (.*)\]$/m, '$1: $2 está fuera del rango [$3, $4]'],
    [/^(.*): expected a whole number$/m, '$1: debe ser un número entero'],
    [/^(.*): expected a number$/m, '$1: debe ser un número'],
    [/^(.*): "(.*)" is not one of the options$/m, '$1: "$2" no es una opción válida'],
    [/^(.*): (.*) is required in every row$/m, '$1: falta $2 en alguna fila'],
    [/the entry has no values/, 'El registro está vacío'],
    [/occurred_at is in the future/, 'La fecha está en el futuro'],
    [/form or area is archived/, 'El formulario o el área están archivados'],
    [/only the current version/, 'Ese registro ya se había corregido o borrado; recarga la página'],
    [/duplicate key value.*slug/, 'Ya existe otro con ese identificador'],
    [/duplicate key value.*key/, 'Ya existe un campo con esa clave en este formulario'],
    [/confirmation name does not match/, 'El nombre no coincide'],
    [/archive the area before/, 'Primero archiva el área'],
    [/not authorized/, 'Sin acceso: esta cuenta no es la del dueño'],
    [/immutable; archive it/, 'La clave y el tipo no se pueden cambiar: archiva el campo y crea otro'],
    [/Failed to fetch|NetworkError|Load failed/i, 'Sin conexión'],
  ];
  for (const [re, es] of rules) if (re.test(raw)) return raw.replace(re, es);
  return raw;
}
