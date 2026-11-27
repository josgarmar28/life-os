// Armario: cuadrícula con buscador, filtros, selección para mover prendas y marcar uso.
import { useMemo, useState } from 'react';
import {
  CATEGORIES, COLORS, EMPTY_FILTERS, FORMALITY_LABELS, SEASONS, SORTS, STATUSES, activeFilterCount, categoryLabel, closetCounts,
  facetCounts, filterGarments, sortGarments, spent, storageUsage, totalPieces, type Filters, type SortKey,
} from '@shared/wardrobe.ts';
import { Link } from '../router';
import { explainError, rpc } from '../supabase';
import { showToast } from '../toast';
import { reloadWardrobe, useSignedUrls, useWardrobe } from './store';
import { ColorDots, Pick, Thumb, WardrobeHead, money, uuid } from './ui';

export function ClosetPage() {
  const w = useWardrobe();
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>('recent');
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Los filtros de tienda y marca ofrecen lo que ya hay en el armario (sin contar las archivadas).
  const live = useMemo(() => w.garments.filter((g) => g.status !== 'archived'), [w.garments]);
  const stores = useMemo(() => facetCounts(live, (g) => g.store), [live]);
  const brands = useMemo(() => facetCounts(live, (g) => g.brand), [live]);
  const shown = useMemo(() => sortGarments(filterGarments(w.garments, f), sort), [w.garments, f, sort]);
  const counts = useMemo(() => closetCounts(w.garments, w.closets.filter((c) => c.status === 'active')), [w.garments, w.closets]);
  const urls = useSignedUrls(shown.map((g) => w.photosBy.get(g.id)?.main?.thumb_path).filter((p): p is string => Boolean(p)));
  const usage = storageUsage(w.photos);
  const wornCount = live.filter((g) => g.worn).length;
  const nFilters = activeFilterCount(f);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const closetName = (id: string | null) => (id ? w.closets.find((c) => c.id === id)?.name ?? '' : 'En tránsito');

  const toggle = (id: string) => setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const stop = () => { setSelecting(false); setSel([]); };

  async function move(to: string | null) {
    if (!sel.length) return;
    setBusy(true);
    try {
      const n = await rpc<number>('move_garments', { p_ids: sel, p_to: to, p_request_id: uuid(), p_note: '' });
      await reloadWardrobe();
      showToast({ text: n ? `${n} ${n === 1 ? 'prenda movida' : 'prendas movidas'} a ${closetName(to)}.` : 'Ya estaban ahí.' });
      stop();
    } catch (e) {
      showToast({ text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function mark(worn: boolean) {
    if (!sel.length) return;
    setBusy(true);
    try {
      const n = await rpc<number>('mark_worn', { p_ids: sel, p_worn: worn });
      await reloadWardrobe();
      showToast({ text: `${n} ${n === 1 ? 'prenda marcada' : 'prendas marcadas'} como ${worn ? 'usada' : 'limpia'}.` });
      stop();
    } catch (e) {
      showToast({ text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  const active = w.closets.filter((c) => c.status === 'active');

  return (
    <main>
      <WardrobeHead title="Armario" sub={w.loaded ? `${totalPieces(w.garments)} piezas${spent(live).length ? ` · ${spent(live).map((s) => money(s.total, s.currency)).join(' + ')}` : ''}` : undefined}>
        <div className="row gap wrap-row">
          <Link to="/armario/nueva" className="btn primary small">+ Añadir prenda</Link>
          <Link to="/armario/lavado" className="btn small">Lavado{wornCount ? <span className="badge">{wornCount}</span> : null}</Link>
          <button type="button" className={selecting ? 'btn small on' : 'btn small'} onClick={() => (selecting ? stop() : setSelecting(true))}>
            {selecting ? 'Cancelar selección' : 'Seleccionar'}
          </button>
        </div>
      </WardrobeHead>

      {w.error ? <p className="error pad">{w.error}</p> : null}

      <nav className="subtabs scroll" aria-label="Armarios">
        <button type="button" className={f.closet === '' ? 'on' : ''} onClick={() => set('closet', '')}>Todos</button>
        {counts.map((c) => (
          <button key={c.id} type="button" className={f.closet === c.id ? 'on' : ''} onClick={() => set('closet', c.id)}>{c.name} <span className="muted small">{c.count}</span></button>
        ))}
      </nav>

      <div className="search-row">
        <input type="search" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Buscar prenda, marca, tienda…" aria-label="Buscar prendas" enterKeyHint="search" />
        <button type="button" className={open || nFilters ? 'btn small on' : 'btn small'} aria-expanded={open} onClick={() => setOpen(!open)}>
          Filtros{nFilters ? ` (${nFilters})` : ''}
        </button>
      </div>

      {open ? (
        <section className="card filters" aria-label="Filtros">
          <label className="label">Tipo</label>
          <Pick multi label="Tipo" options={CATEGORIES.map((c) => ({ key: c.key, label: c.label }))} value={f.categories} onChange={(v) => set('categories', v)} />
          <label className="label">Color</label>
          <Pick multi label="Color" options={COLORS.map((c) => ({ key: c.key, label: c.label, swatch: c.hex }))} value={f.colors} onChange={(v) => set('colors', v)} />
          <label className="label">Estación</label>
          <Pick multi label="Estación" options={SEASONS.map((s) => ({ key: s.key, label: s.label }))} value={f.seasons} onChange={(v) => set('seasons', v)} />
          {stores.length ? (<><label className="label">Tienda</label>
            <Pick multi label="Tienda" options={stores.map((s) => ({ key: s.value, label: `${s.value} (${s.count})` }))} value={f.stores} onChange={(v) => set('stores', v)} /></>) : null}
          {brands.length ? (<><label className="label">Marca</label>
            <Pick multi label="Marca" options={brands.map((s) => ({ key: s.value, label: `${s.value} (${s.count})` }))} value={f.brands} onChange={(v) => set('brands', v)} /></>) : null}
          <label className="label">Formalidad</label>
          <Pick multi label="Formalidad" options={[1, 2, 3, 4, 5].map((n) => ({ key: n, label: `${n} · ${FORMALITY_LABELS[n]}` }))} value={f.formality} onChange={(v) => set('formality', v)} />
          <label className="label">Estado</label>
          <Pick multi label="Estado" options={STATUSES.map((s) => ({ key: s.key, label: s.label }))} value={f.statuses} onChange={(v) => set('statuses', v)} />
          <label className="label">Uso</label>
          <Pick label="Uso" options={[{ key: 'worn', label: 'Usadas (a lavar)' }, { key: 'clean', label: 'Limpias' }]} value={f.worn ? [f.worn] : []} onChange={(v) => set('worn', (v[0] ?? '') as Filters['worn'])} />
          <label className="label">Análisis de Claude</label>
          <Pick label="Análisis" options={[{ key: 'pending', label: 'Pendientes' }, { key: 'done', label: 'Hechos' }]} value={f.analysis ? [f.analysis] : []} onChange={(v) => set('analysis', (v[0] ?? '') as Filters['analysis'])} />
          <label className="label">Precio</label>
          <div className="row gap">
            <input type="number" inputMode="decimal" min={0} placeholder="Desde" aria-label="Precio desde" value={f.priceMin ?? ''} onChange={(e) => set('priceMin', e.target.value === '' ? null : Number(e.target.value))} />
            <input type="number" inputMode="decimal" min={0} placeholder="Hasta" aria-label="Precio hasta" value={f.priceMax ?? ''} onChange={(e) => set('priceMax', e.target.value === '' ? null : Number(e.target.value))} />
          </div>
          <label className="label" htmlFor="w-sort">Ordenar por</label>
          <select id="w-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {nFilters ? <button type="button" className="link" onClick={() => setF({ ...EMPTY_FILTERS, q: f.q, closet: f.closet })}>Borrar filtros</button> : null}
        </section>
      ) : null}

      {w.loading && !w.loaded ? <p className="muted">Cargando…</p> : null}
      {w.loaded && !shown.length ? (
        <p className="muted pad">
          {live.length ? 'Ninguna prenda coincide con la búsqueda.' : <>Aún no hay prendas. <Link to="/armario/nueva">Añade la primera</Link>: con una foto y el tipo basta.</>}
        </p>
      ) : null}

      <p className="muted small count-line" aria-live="polite">{shown.length ? `${shown.length} ${shown.length === 1 ? 'prenda' : 'prendas'}` : ''}</p>
      <ul className="wgrid">
        {shown.map((g) => {
          const on = sel.includes(g.id);
          const inner = (
            <>
              <Thumb g={g} photo={w.photosBy.get(g.id)?.main} urls={urls} />
              {g.worn ? <span className="corner worn" title="Usada, a lavar">🧺</span> : null}
              {selecting ? <span className={on ? 'pick-mark on' : 'pick-mark'} aria-hidden="true">{on ? '✓' : ''}</span> : null}
              <span className="wname">{g.name}</span>
              <span className="wmeta muted small">
                {categoryLabel(g.category)} <ColorDots colors={g.colors} />
                {!f.closet ? ` · ${closetName(g.closet_id)}` : ''}
                {g.status !== 'active' ? ` · ${STATUSES.find((s) => s.key === g.status)?.label}` : ''}
                {!g.analysis ? ' · sin analizar' : ''}
              </span>
            </>
          );
          return (
            <li key={g.id} className={on ? 'wcard sel' : 'wcard'}>
              {selecting
                ? <button type="button" className="wlink" aria-pressed={on} aria-label={`${on ? 'Quitar' : 'Elegir'} ${g.name}`} onClick={() => toggle(g.id)}>{inner}</button>
                : <Link to={`/armario/p/${g.id}`} className="wlink">{inner}</Link>}
            </li>
          );
        })}
      </ul>

      <p className="muted small">
        <Link to="/armario/armarios">Gestionar armarios</Link>
        {' · '}Fotos: {(usage.bytes / 1e6).toFixed(usage.bytes < 1e7 ? 1 : 0)} MB de 1000 MB gratuitos
      </p>
      {usage.warn ? <p className="banner">Las fotos ocupan el {Math.round(usage.pct)} % del almacenamiento gratuito. Evita fotos de detalle innecesarias o archiva prendas que ya no tengas.</p> : null}

      {selecting ? (
        <div className="select-bar" role="region" aria-label="Acciones sobre la selección">
          <div className="row gap wrap-row">
            <strong>{sel.length} elegidas</strong>
            <button type="button" className="link" onClick={() => setSel(shown.map((g) => g.id))}>Elegir las {shown.length}</button>
          </div>
          <div className="row gap wrap-row">
            {active.map((c) => <button key={c.id} type="button" className="btn small" disabled={!sel.length || busy} onClick={() => void move(c.id)}>Mover a {c.name}</button>)}
            <button type="button" className="btn small" disabled={!sel.length || busy} onClick={() => void move(null)}>En tránsito</button>
            <button type="button" className="btn small" disabled={!sel.length || busy} onClick={() => void mark(true)}>Marcar usada</button>
            <button type="button" className="btn small" disabled={!sel.length || busy} onClick={() => void mark(false)}>Marcar limpia</button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
