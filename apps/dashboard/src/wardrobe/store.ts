// Datos del armario compartidos entre pantallas. A diferencia de la estructura, NO se guardan en el teléfono
// (son datos personales): sin conexión se avisa y se vuelve a pedir al volver la red.
import { useEffect, useMemo, useState } from 'react';
import type { Closet, Garment, GarmentMove, GarmentPhoto } from '@shared/wardrobe.ts';
import { api, fetchAll } from '../supabase';
import { clearSignedUrls, signedUrls } from './photo';

interface State {
  closets: Closet[];
  garments: Garment[];
  photos: GarmentPhoto[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

let state: State = { closets: [], garments: [], photos: [], loaded: false, loading: false, error: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function reloadWardrobe(): Promise<void> {
  state = { ...state, loading: true };
  emit();
  try {
    const [closets, garments, photos] = await Promise.all([
      fetchAll<Closet>((a, b) => api().from('closets').select('*').order('sort_order').range(a, b)),
      fetchAll<Garment>((a, b) => api().from('garments').select('*').order('created_at', { ascending: false }).range(a, b)),
      fetchAll<GarmentPhoto>((a, b) => api().from('garment_photos').select('*').range(a, b)),
    ]);
    state = { closets, garments, photos, loaded: true, loading: false, error: null };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    state = { ...state, loading: false, error: /Failed to fetch|NetworkError|Load failed/i.test(m) || !navigator.onLine ? 'Sin conexión: el armario necesita red.' : m };
  }
  emit();
}

/** Al cerrar sesión: nada del armario queda en memoria. */
export function clearWardrobe() {
  state = { closets: [], garments: [], photos: [], loaded: false, loading: false, error: null };
  clearSignedUrls();
  emit();
}

export function useWardrobe() {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    if (!state.loaded && !state.loading) void reloadWardrobe();
    return () => { listeners.delete(l); };
  }, []);
  const photosBy = useMemo(() => {
    const m = new Map<string, Partial<Record<GarmentPhoto['kind'], GarmentPhoto>>>();
    for (const p of state.photos) m.set(p.garment_id, { ...m.get(p.garment_id), [p.kind]: p });
    return m;
  }, [state.photos]);
  return { ...state, photosBy, reload: reloadWardrobe };
}

export async function loadMoves(garmentId: string): Promise<GarmentMove[]> {
  const { data, error } = await api().from('garment_moves').select('*').eq('garment_id', garmentId).order('occurred_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as GarmentMove[];
}

/** Direcciones firmadas de las rutas pedidas (se piden juntas y se guardan en memoria). */
export function useSignedUrls(paths: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join('|');
  useEffect(() => {
    if (!paths.length) return;
    let live = true;
    signedUrls(paths).then((u) => { if (live) setUrls((cur) => ({ ...cur, ...u })); }).catch(() => { /* sin foto: se ve el hueco */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}
