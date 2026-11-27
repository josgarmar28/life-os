// Gestión de armarios: renombrar, añadir y archivar (solo si están vacíos).
import { useState } from 'react';
import { closetCounts } from '@shared/wardrobe.ts';
import { explainError, rpc } from '../supabase';
import { showToast } from '../toast';
import { reloadWardrobe, useWardrobe } from './store';
import { WardrobeHead } from './ui';

export function ClosetsManage() {
  const w = useWardrobe();
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const counts = closetCounts(w.garments, w.closets);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    try { await fn(); await reloadWardrobe(); showToast({ text: ok }); } catch (e) { setError(explainError(e)); }
  }

  return (
    <main>
      <WardrobeHead title="Armarios" back={{ to: '/armario', label: 'Armario' }} sub="Cada prenda está en un armario. Para cambiarla, muévela desde Armario → Seleccionar." />
      {error ? <p className="error" role="alert">{error}</p> : null}
      <ul className="stack">
        {w.closets.map((c) => (
          <li key={c.id} className={c.status === 'archived' ? 'card archived' : 'card'}>
            <ClosetRow id={c.id} name={c.name} country={c.country ?? ''} archived={c.status === 'archived'} count={counts.find((x) => x.id === c.id)?.count ?? 0}
              onSave={(n, co) => run(() => rpc('save_closet', { p_name: n, p_country: co || null, p_note: c.note, p_id: c.id }), 'Guardado.')}
              onStatus={(s) => run(() => rpc('set_closet_status', { p_id: c.id, p_status: s }), s === 'archived' ? 'Armario archivado.' : 'Armario recuperado.')} />
          </li>
        ))}
      </ul>
      <section className="card stack">
        <h2>Nuevo armario</h2>
        <div className="inline-form">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Maleta, trastero…" aria-label="Nombre del armario" />
          <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="País" aria-label="País (2 letras)" style={{ width: 80 }} />
          <button type="button" className="btn primary" disabled={!name.trim()} onClick={() => void run(async () => { await rpc('save_closet', { p_name: name, p_country: country || null }); setName(''); setCountry(''); }, 'Armario creado.')}>Crear</button>
        </div>
      </section>
    </main>
  );
}

function ClosetRow({ id, name, country, archived, count, onSave, onStatus }: {
  id: string; name: string; country: string; archived: boolean; count: number;
  onSave: (name: string, country: string) => void; onStatus: (s: 'active' | 'archived') => void;
}) {
  const [n, setN] = useState(name);
  const [c, setC] = useState(country);
  return (
    <div className="stack" data-closet={id}>
      <div className="inline-form">
        <input value={n} onChange={(e) => setN(e.target.value)} maxLength={40} aria-label="Nombre" />
        <input value={c} onChange={(e) => setC(e.target.value.toUpperCase())} maxLength={2} aria-label="País" style={{ width: 80 }} />
        <button type="button" className="btn small" disabled={!n.trim() || (n === name && c === country)} onClick={() => onSave(n, c)}>Guardar</button>
      </div>
      <div className="row gap">
        <span className="muted small">{count} {count === 1 ? 'prenda' : 'prendas'}</span>
        {archived
          ? <button type="button" className="link" onClick={() => onStatus('active')}>Recuperar</button>
          : <button type="button" className="link danger" disabled={count > 0} title={count ? 'Mueve antes sus prendas' : undefined} onClick={() => onStatus('archived')}>Archivar</button>}
      </div>
    </div>
  );
}
