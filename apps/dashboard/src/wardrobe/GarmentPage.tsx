// Añadir una prenda (foto + tipo + armario y poco más) y ver/editar su ficha. El modo ráfaga deja el formulario
// listo para la siguiente prenda: pensado para la carga inicial del armario, foto tras foto.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CARE_DRY, CARE_IRON, CARE_PROGRAMS, CATEGORIES, CATEGORY_GROUPS, COLORS, FITS, FORMALITY_LABELS, PATTERNS, SEASONS, STATUSES,
  WARMTH_LABELS, categoryLabel, colorLabel, facetCounts, type Garment, type GarmentMove,
} from '@shared/wardrobe.ts';
import { Link, navigate } from '../router';
import { explainError, rpc } from '../supabase';
import { showToast } from '../toast';
import { removeGarmentPhoto, uploadGarmentPhoto, type PhotoKind } from './photo';
import { loadMoves, reloadWardrobe, useSignedUrls, useWardrobe } from './store';
import { Pick, WardrobeHead, uuid } from './ui';

interface Draft {
  name: string; category: string; closet_id: string; price: string; currency: string; subtype: string; colors: string[];
  pattern: string; material: string; fit: string; size: string; quantity: string; brand: string; store: string;
  purchased_on: string; seasons: string[]; formality: number | null; warmth: number | null; care_program: string;
  care_dry: string; care_iron: string; care_note: string; status: string; notes: string;
}

const EMPTY: Draft = {
  name: '', category: '', closet_id: '', price: '', currency: 'CHF', subtype: '', colors: [], pattern: '', material: '', fit: '', size: '',
  quantity: '1', brand: '', store: '', purchased_on: '', seasons: [], formality: null, warmth: null, care_program: '', care_dry: '',
  care_iron: '', care_note: '', status: 'active', notes: '',
};

const fromGarment = (g: Garment): Draft => ({
  name: g.name, category: g.category, closet_id: g.closet_id ?? '', price: g.price === null ? '' : String(g.price), currency: g.currency,
  subtype: g.subtype, colors: g.colors, pattern: g.pattern ?? '', material: g.material, fit: g.fit ?? '', size: g.size, quantity: String(g.quantity),
  brand: g.brand, store: g.store, purchased_on: g.purchased_on ?? '', seasons: g.seasons, formality: g.formality, warmth: g.warmth,
  care_program: g.care_program ?? '', care_dry: g.care_dry ?? '', care_iron: g.care_iron ?? '', care_note: g.care_note, status: g.status, notes: g.notes,
});

const nul = (s: string) => (s.trim() === '' ? null : s.trim());

/** Campos de la BD a partir del borrador (todos; al editar se envían solo los que cambian). */
function payload(d: Draft): Record<string, unknown> {
  const price = d.price.trim() === '' ? null : Number(d.price.replace(',', '.'));
  return {
    name: d.name.trim(), category: d.category, subtype: d.subtype.trim(), colors: d.colors, pattern: nul(d.pattern), material: d.material.trim(),
    fit: nul(d.fit), size: d.size.trim(), quantity: Math.max(1, Math.round(Number(d.quantity) || 1)), brand: d.brand.trim(), store: d.store.trim(),
    price, currency: d.currency.trim().toUpperCase() || 'CHF', purchased_on: nul(d.purchased_on), status: d.status, seasons: d.seasons,
    formality: d.formality, warmth: d.warmth, care_program: nul(d.care_program), care_dry: nul(d.care_dry), care_iron: nul(d.care_iron),
    care_note: d.care_note.trim(), notes: d.notes.trim(),
  };
}

const BURST_KEY = 'lifeos.wardrobe.burst';
const LAST_CLOSET_KEY = 'lifeos.wardrobe.closet';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

const KIND_LABEL: Record<PhotoKind, string> = { main: 'Foto de la prenda', label: 'Etiqueta (tejido y lavado)', detail: 'Detalle' };

export function GarmentPage({ id }: { id?: string }) {
  const w = useWardrobe();
  const garment = id ? w.garments.find((g) => g.id === id) : undefined;
  const activeClosets = w.closets.filter((c) => c.status === 'active');

  const [d, setD] = useState<Draft>(EMPTY);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [files, setFiles] = useState<Partial<Record<PhotoKind, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<PhotoKind, string>>>({});
  const [working, setWorking] = useState<PhotoKind | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [burst, setBurst] = useState(() => read(BURST_KEY) === '1');
  const [added, setAdded] = useState(0);
  const [moves, setMoves] = useState<GarmentMove[]>([]);
  const reqId = useRef(uuid());

  // Edición: el borrador se carga una vez cuando llega la prenda. Alta: armario y moneda de la última vez.
  useEffect(() => {
    if (id) {
      if (garment && loadedFor !== garment.id) { setD(fromGarment(garment)); setLoadedFor(garment.id); }
    } else if (!loadedFor && w.loaded) {
      const last = read(LAST_CLOSET_KEY);
      const first = activeClosets.find((c) => c.id === last) ?? activeClosets[0];
      setD((cur) => ({ ...cur, closet_id: first?.id ?? '' }));
      setLoadedFor('new');
    }
  }, [id, garment, loadedFor, w.loaded, activeClosets]);

  useEffect(() => {
    if (!id) return;
    let live = true;
    loadMoves(id).then((m) => { if (live) setMoves(m); }).catch(() => { /* el historial es opcional */ });
    return () => { live = false; };
  }, [id, w.garments]);

  useEffect(() => () => { Object.values(previews).forEach((u) => u && URL.revokeObjectURL(u)); }, [previews]);

  const photos = id ? w.photosBy.get(id) : undefined;
  const urls = useSignedUrls(photos ? Object.values(photos).flatMap((p) => (p ? [p.path] : [])) : []);
  const knownStores = useMemo(() => facetCounts(w.garments, (g) => g.store).map((x) => x.value), [w.garments]);
  const knownBrands = useMemo(() => facetCounts(w.garments, (g) => g.brand).map((x) => x.value), [w.garments]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }));

  const dirty = useMemo(() => (garment ? JSON.stringify(d) !== JSON.stringify(fromGarment(garment)) : true), [d, garment]);
  const closetName = (cid: string | null) => (cid ? w.closets.find((c) => c.id === cid)?.name ?? '?' : 'En tránsito');

  async function pickPhoto(kind: PhotoKind, file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!id) {
      setFiles((cur) => ({ ...cur, [kind]: file }));
      setPreviews((cur) => ({ ...cur, [kind]: URL.createObjectURL(file) }));
      return;
    }
    setWorking(kind);
    try {
      await uploadGarmentPhoto(id, kind, file);
      await reloadWardrobe();
      showToast({ text: 'Foto guardada.' });
    } catch (e) {
      setError(explainError(e));
    } finally {
      setWorking(null);
    }
  }

  async function dropPhoto(kind: PhotoKind) {
    if (!id) {
      setFiles((cur) => { const n = { ...cur }; delete n[kind]; return n; });
      setPreviews((cur) => { const n = { ...cur }; delete n[kind]; return n; });
      return;
    }
    setWorking(kind);
    try {
      await removeGarmentPhoto(id, kind);
      await reloadWardrobe();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setWorking(null);
    }
  }

  async function save() {
    setError(null);
    if (!d.category) { setError('Elige el tipo de prenda.'); return; }
    const data = payload(d);
    if (!data.name) data.name = [categoryLabel(d.category), d.colors[0] ? colorLabel(d.colors[0]).toLowerCase() : ''].join(' ').trim();
    setWorking('save');
    try {
      if (garment) {
        const before = payload(fromGarment(garment));
        const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
        if (Object.keys(changed).length) await rpc('save_garment', { p_data: changed, p_id: garment.id, p_request_id: null });
        await reloadWardrobe();
        showToast({ text: 'Guardado.' });
        return;
      }
      const body = { ...data, ...(d.closet_id ? { closet_id: d.closet_id } : {}) };
      const newId = await rpc<string>('save_garment', { p_data: body, p_id: null, p_request_id: reqId.current });
      if (d.closet_id) write(LAST_CLOSET_KEY, d.closet_id);
      const failed: string[] = [];
      for (const kind of ['main', 'label', 'detail'] as PhotoKind[]) {
        const f = files[kind];
        if (!f) continue;
        try { await uploadGarmentPhoto(newId, kind, f); } catch (e) { failed.push(`${KIND_LABEL[kind]}: ${explainError(e)}`); }
      }
      await reloadWardrobe();
      if (failed.length) {
        showToast({ text: 'Prenda guardada, pero una foto falló. Súbela desde su ficha.' });
        setError(failed.join(' · '));
        navigate(`/armario/p/${newId}`, true);
        return;
      }
      if (burst) {
        setAdded((n) => n + 1);
        reqId.current = uuid();
        setFiles({});
        setPreviews({});
        setD((cur) => ({ ...EMPTY, closet_id: cur.closet_id, category: cur.category, currency: cur.currency, store: cur.store, purchased_on: cur.purchased_on }));
        showToast({ text: `Guardada: ${String(data.name)}.` });
        window.scrollTo(0, 0);
      } else {
        showToast({ text: 'Prenda guardada.' });
        navigate(`/armario/p/${newId}`, true);
      }
    } catch (e) {
      setError(explainError(e));
    } finally {
      setWorking(null);
    }
  }

  async function act(fn: () => Promise<unknown>, ok: string, undo?: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reloadWardrobe();
      showToast({ text: ok, action: undo ? { label: 'Deshacer', run: async () => { await undo(); await reloadWardrobe(); } } : undefined });
    } catch (e) {
      setError(explainError(e));
    }
  }

  if (id && w.loaded && !garment) {
    return <main><WardrobeHead title="Prenda" back={{ to: '/armario', label: 'Armario' }} /><p>No encuentro esa prenda.</p></main>;
  }
  if (id && !garment) return <main><p className="muted">Cargando…</p></main>;

  const busy = working !== null;
  const slot = (kind: PhotoKind) => {
    const existing = photos?.[kind];
    const src = previews[kind] ?? (existing ? urls[existing.path] : undefined);
    return (
      <div className="photo-slot" key={kind}>
        <div className={kind === 'main' ? 'photo-box main' : 'photo-box'}>
          {src ? <img src={src} alt={KIND_LABEL[kind]} /> : <span className="muted small">{working === kind ? 'Procesando…' : 'Sin foto'}</span>}
        </div>
        <span className="label">{KIND_LABEL[kind]}</span>
        <div className="row gap wrap-row">
          <label className="btn small">
            {src ? 'Cambiar' : 'Hacer o elegir foto'}
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { void pickPhoto(kind, e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {src ? <button type="button" className="link danger" disabled={busy} onClick={() => void dropPhoto(kind)}>Quitar</button> : null}
        </div>
      </div>
    );
  };

  return (
    <main className="entry-form">
      <WardrobeHead title={garment ? garment.name : 'Añadir prenda'} back={{ to: '/armario', label: 'Armario' }}
        sub={garment ? `${categoryLabel(garment.category)} · en ${closetName(garment.closet_id)}${garment.worn ? ' · usada, a lavar' : ''}` : burst ? `Modo ráfaga${added ? ` · ${added} guardadas en esta tanda` : ''}` : undefined} />

      {error ? <p className="error" role="alert">{error}</p> : null}

      <section className="card stack" aria-label="Fotos">
        {slot('main')}
        {!garment ? <p className="muted small">Consejo: con la prenda extendida sobre un fondo liso. Para un recorte limpio, en Fotos mantén pulsada la prenda → «Levantar sujeto» → guárdala y sube ese PNG: se centra y normaliza sola.</p> : null}
        <details>
          <summary>Etiqueta y detalle (ayudan a Claude a leer tejido y cuidados)</summary>
          <div className="stack">{slot('label')}{slot('detail')}</div>
        </details>
      </section>

      <section className="card stack" aria-label="Ficha básica">
        <div className="field">
          <span className="label">Tipo</span>
          {CATEGORY_GROUPS.map((grp) => (
            <div key={grp} className="cat-group">
              <span className="muted small">{grp}</span>
              <Pick label={grp} options={CATEGORIES.filter((c) => c.group === grp).map((c) => ({ key: c.key, label: c.label }))} value={d.category ? [d.category] : []} onChange={(v) => set('category', v[0] ?? '')} />
            </div>
          ))}
        </div>
        {!garment ? (
          <div className="field">
            <span className="label">Armario</span>
            <Pick label="Armario" options={activeClosets.map((c) => ({ key: c.id, label: c.name }))} value={d.closet_id ? [d.closet_id] : []} onChange={(v) => set('closet_id', v[0] ?? '')} />
          </div>
        ) : null}
        <div className="field">
          <label className="label" htmlFor="g-name">Nombre <span className="muted small">(opcional: si lo dejas vacío, tipo + color)</span></label>
          <input id="g-name" value={d.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder="Camisa Oxford azul" />
        </div>
        <div className="field">
          <span className="label">Color <span className="muted small">(hasta 3, el principal primero)</span></span>
          <Pick multi max={3} label="Color" options={COLORS.map((c) => ({ key: c.key, label: c.label, swatch: c.hex }))} value={d.colors} onChange={(v) => set('colors', v)} />
        </div>
        <div className="field row gap">
          <div className="grow">
            <label className="label" htmlFor="g-price">Precio</label>
            <input id="g-price" type="text" inputMode="decimal" value={d.price} onChange={(e) => set('price', e.target.value)} placeholder="79,90" />
          </div>
          <div>
            <label className="label" htmlFor="g-cur">Moneda</label>
            <select id="g-cur" value={d.currency} onChange={(e) => set('currency', e.target.value)}>
              {['CHF', 'EUR', 'USD', 'GBP'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="field row gap">
          <div className="grow">
            <label className="label" htmlFor="g-store">Tienda</label>
            <input id="g-store" list="w-stores" value={d.store} maxLength={60} onChange={(e) => set('store', e.target.value)} placeholder="Zara, Uniqlo…" />
            <datalist id="w-stores">{knownStores.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div className="grow">
            <label className="label" htmlFor="g-date">Fecha de compra</label>
            <input id="g-date" type="date" value={d.purchased_on} onChange={(e) => set('purchased_on', e.target.value)} />
          </div>
        </div>
      </section>

      <button type="button" className="link" aria-expanded={more} onClick={() => setMore(!more)}>{more || garment ? 'Datos adicionales' : 'Más datos (talla, tejido, cuidados…)'} {more ? '▲' : '▼'}</button>
      {more || garment ? (
        <section className="card stack" aria-label="Datos adicionales">
          <div className="field row gap">
            <div className="grow"><label className="label" htmlFor="g-brand">Marca</label>
              <input id="g-brand" list="w-brands" value={d.brand} maxLength={60} onChange={(e) => set('brand', e.target.value)} />
              <datalist id="w-brands">{knownBrands.map((s) => <option key={s} value={s} />)}</datalist></div>
            <div><label className="label" htmlFor="g-size">Talla</label>
              <input id="g-size" value={d.size} maxLength={20} onChange={(e) => set('size', e.target.value)} style={{ width: 90 }} /></div>
            <div><label className="label" htmlFor="g-qty">Cantidad</label>
              <input id="g-qty" type="number" inputMode="numeric" min={1} max={99} value={d.quantity} onChange={(e) => set('quantity', e.target.value)} style={{ width: 80 }} /></div>
          </div>
          <div className="field"><label className="label" htmlFor="g-sub">Subtipo</label>
            <input id="g-sub" value={d.subtype} maxLength={40} onChange={(e) => set('subtype', e.target.value)} placeholder="Oxford, chino, bomber, zapatilla…" /></div>
          <div className="field"><span className="label">Estampado</span>
            <Pick label="Estampado" options={PATTERNS.map((p) => ({ key: p.key, label: p.label }))} value={d.pattern ? [d.pattern] : []} onChange={(v) => set('pattern', v[0] ?? '')} /></div>
          <div className="field"><label className="label" htmlFor="g-mat">Tejido / composición</label>
            <input id="g-mat" value={d.material} maxLength={160} onChange={(e) => set('material', e.target.value)} placeholder="100 % algodón" /></div>
          <div className="field"><span className="label">Corte</span>
            <Pick label="Corte" options={FITS.map((p) => ({ key: p.key, label: p.label }))} value={d.fit ? [d.fit] : []} onChange={(v) => set('fit', v[0] ?? '')} /></div>
          <div className="field"><span className="label">Estaciones</span>
            <Pick multi label="Estaciones" options={SEASONS.map((s) => ({ key: s.key, label: s.label }))} value={d.seasons} onChange={(v) => set('seasons', v)} /></div>
          <div className="field"><span className="label">Formalidad</span>
            <Pick label="Formalidad" options={[1, 2, 3, 4, 5].map((n) => ({ key: n, label: `${n} · ${FORMALITY_LABELS[n]}` }))} value={d.formality ? [d.formality] : []} onChange={(v) => set('formality', v[0] ?? null)} /></div>
          <div className="field"><span className="label">Abrigo</span>
            <Pick label="Abrigo" options={[1, 2, 3, 4, 5].map((n) => ({ key: n, label: `${n} · ${WARMTH_LABELS[n]}` }))} value={d.warmth ? [d.warmth] : []} onChange={(v) => set('warmth', v[0] ?? null)} /></div>
          <div className="field"><span className="label">Lavado (de la etiqueta)</span>
            <Pick label="Lavado" options={CARE_PROGRAMS.map((p) => ({ key: p.key, label: p.label }))} value={d.care_program ? [d.care_program] : []} onChange={(v) => set('care_program', v[0] ?? '')} /></div>
          <div className="field"><span className="label">Secado</span>
            <Pick label="Secado" options={CARE_DRY.map((p) => ({ key: p.key, label: p.label }))} value={d.care_dry ? [d.care_dry] : []} onChange={(v) => set('care_dry', v[0] ?? '')} /></div>
          <div className="field"><span className="label">Plancha</span>
            <Pick label="Plancha" options={CARE_IRON.map((p) => ({ key: p.key, label: p.label }))} value={d.care_iron ? [d.care_iron] : []} onChange={(v) => set('care_iron', v[0] ?? '')} /></div>
          <div className="field"><label className="label" htmlFor="g-care">Nota de cuidado</label>
            <input id="g-care" value={d.care_note} maxLength={500} onChange={(e) => set('care_note', e.target.value)} placeholder="Lavar del revés, no usar suavizante…" /></div>
          {garment ? (
            <div className="field"><span className="label">Estado</span>
              <Pick label="Estado" options={STATUSES.filter((s) => s.key !== 'archived').map((s) => ({ key: s.key, label: s.label }))} value={[d.status]} onChange={(v) => set('status', v[0] ?? 'active')} /></div>
          ) : null}
          <div className="field"><label className="label" htmlFor="g-notes">Notas</label>
            <textarea id="g-notes" rows={3} value={d.notes} maxLength={1000} onChange={(e) => set('notes', e.target.value)} /></div>
        </section>
      ) : null}

      {!garment ? (
        <label className="check-line"><input type="checkbox" checked={burst} onChange={(e) => { setBurst(e.target.checked); write(BURST_KEY, e.target.checked ? '1' : '0'); }} /> Seguir añadiendo después de guardar (ráfaga: se mantiene el armario, el tipo y la tienda)</label>
      ) : null}

      <div className="sticky-actions">
        <button type="button" className="btn primary wide" disabled={busy || (garment ? !dirty : false)} onClick={() => void save()}>
          {working === 'save' ? 'Guardando…' : garment ? 'Guardar cambios' : burst ? 'Guardar y siguiente' : 'Guardar prenda'}
        </button>
      </div>

      {garment ? (
        <>
          <section className="card stack" aria-label="Análisis de Claude">
            <h2>Análisis de Claude</h2>
            {garment.analysis ? <AnalysisView analysis={garment.analysis} by={garment.analysis_by} at={garment.analysis_at} />
              : <p className="muted">Pendiente. Pídeselo a Claude en el chat («analiza las prendas nuevas del armario»): lee la foto y la etiqueta y guarda aquí su análisis, siempre marcado como estimación.</p>}
          </section>

          <section className="card stack" aria-label="Mover y lavado">
            <h2>Mover y lavado</h2>
            <div className="row gap wrap-row">
              {activeClosets.filter((c) => c.id !== garment.closet_id).map((c) => (
                <button key={c.id} type="button" className="btn small" onClick={() => void act(
                  () => rpc('move_garments', { p_ids: [garment.id], p_to: c.id, p_request_id: uuid(), p_note: '' }), `Movida a ${c.name}.`,
                  () => rpc('move_garments', { p_ids: [garment.id], p_to: garment.closet_id, p_request_id: uuid(), p_note: 'deshacer' }))}>Mover a {c.name}</button>
              ))}
              {garment.closet_id ? <button type="button" className="btn small" onClick={() => void act(() => rpc('move_garments', { p_ids: [garment.id], p_to: null, p_request_id: uuid(), p_note: '' }), 'En tránsito.')}>En tránsito</button> : null}
              <button type="button" className="btn small" onClick={() => void act(() => rpc('mark_worn', { p_ids: [garment.id], p_worn: !garment.worn }), garment.worn ? 'Marcada como limpia.' : 'Marcada como usada.')}>
                {garment.worn ? 'Ya está lavada' : 'Marcar usada'}
              </button>
            </div>
            {moves.length ? (
              <details>
                <summary>Historial de traslados ({moves.length})</summary>
                <ul className="list compact">
                  {moves.map((m) => (
                    <li key={m.id}><span className="grow">{closetName(m.from_closet)} → {closetName(m.to_closet)}{m.note ? ` · ${m.note}` : ''}</span>
                      <span className="muted small">{new Date(m.occurred_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</span></li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <section className="card danger-zone stack">
            {garment.status === 'archived'
              ? <button type="button" className="btn" onClick={() => void act(() => rpc('save_garment', { p_data: { status: 'active' }, p_id: garment.id }), 'Prenda recuperada.')}>Recuperar prenda</button>
              : <button type="button" className="btn danger" onClick={() => void act(
                () => rpc('save_garment', { p_data: { status: 'archived' }, p_id: garment.id }), 'Prenda archivada.',
                () => rpc('save_garment', { p_data: { status: 'active' }, p_id: garment.id }))}>Archivar (ya no la tengo)</button>}
            <p className="muted small">Archivar no borra nada: la prenda sale del armario y de las propuestas, y se puede recuperar buscando por estado «Archivada».</p>
          </section>
          <p className="muted small"><Link to="/armario">Volver al armario</Link></p>
        </>
      ) : null}
    </main>
  );
}

function label(k: string): string {
  const m: Record<string, string> = {
    style: 'Estilo', pairs_with: 'Combina con', avoid_with: 'Mejor evitar con', occasions: 'Ocasiones', versatility: 'Versatilidad',
    fabric: 'Tejido (etiqueta)', care: 'Cuidados', notes: 'Notas', confidence: 'Confianza', season: 'Estación', warmth: 'Abrigo', fit: 'Corte',
  };
  return m[k] ?? k.replace(/_/g, ' ');
}

function AnalysisView({ analysis, by, at }: { analysis: Record<string, unknown>; by: string | null; at: string | null }) {
  return (
    <>
      <dl className="values">
        {Object.entries(analysis).map(([k, v]) => (
          <div key={k}><dt>{label(k)}</dt><dd>{Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : String(v)}</dd></div>
        ))}
      </dl>
      <p className="muted small">Estimación de {by?.startsWith('agent:') ? 'Claude' : 'ti'}{at ? ` · ${new Date(at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}. No es una medición.</p>
    </>
  );
}
