// Lavado: lo marcado como usado, agrupado por programa y tono (de la etiqueta de cada prenda).
// En el armario de España sirve para dejar la ropa lavada antes de volver a Suiza.
import { useMemo, useState } from 'react';
import { categoryLabel, dryLabel, ironLabel, laundryGroups } from '@shared/wardrobe.ts';
import { Link } from '../router';
import { explainError, rpc } from '../supabase';
import { showToast } from '../toast';
import { reloadWardrobe, useWardrobe } from './store';
import { ColorDots, WardrobeHead } from './ui';

export function LaundryPage() {
  const w = useWardrobe();
  const [closet, setCloset] = useState('');
  const [busy, setBusy] = useState(false);
  const scoped = useMemo(() => w.garments.filter((g) => !closet || g.closet_id === closet), [w.garments, closet]);
  const groups = useMemo(() => laundryGroups(scoped), [scoped]);
  const active = w.closets.filter((c) => c.status === 'active');
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  async function washed(ids: string[], what: string) {
    setBusy(true);
    try {
      const n = await rpc<number>('mark_worn', { p_ids: ids, p_worn: false });
      await reloadWardrobe();
      showToast({
        text: `${n} ${n === 1 ? 'prenda lavada' : 'prendas lavadas'} (${what}).`,
        action: { label: 'Deshacer', run: async () => { await rpc('mark_worn', { p_ids: ids, p_worn: true }); await reloadWardrobe(); } },
      });
    } catch (e) {
      showToast({ text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <WardrobeHead title="Lavado" back={{ to: '/armario', label: 'Armario' }}
        sub={total ? `${total} ${total === 1 ? 'prenda usada' : 'prendas usadas'}, agrupadas por programa y color según su etiqueta.` : undefined} />
      <nav className="subtabs scroll" aria-label="Armario">
        <button type="button" className={closet === '' ? 'on' : ''} onClick={() => setCloset('')}>Todos</button>
        {active.map((c) => <button key={c.id} type="button" className={closet === c.id ? 'on' : ''} onClick={() => setCloset(c.id)}>{c.name}</button>)}
      </nav>
      {w.error ? <p className="error pad">{w.error}</p> : null}
      {!groups.length && w.loaded ? (
        <p className="muted pad">Nada marcado como usado. En <Link to="/armario">Armario</Link> pulsa «Seleccionar», elige lo que te has puesto y «Marcar usada»; así, antes de volver de España, sabes exactamente qué lavar y cómo.</p>
      ) : null}
      {groups.map((g) => (
        <section key={g.key} className="card stack" aria-label={g.title}>
          <div className="card-head">
            <h2 className="area-h">{g.title} <span className="muted small">({g.items.length})</span></h2>
            <button type="button" className="btn small" disabled={busy} onClick={() => void washed(g.items.map((x) => x.id), g.title)}>Ya está lavada</button>
          </div>
          <p className="muted small">{g.hint}</p>
          {g.noDryer.length ? <p className="banner">Sin secadora: {g.noDryer.map((x) => x.name).join(', ')}.</p> : null}
          <ul className="list compact">
            {g.items.map((x) => (
              <li key={x.id}>
                <Link to={`/armario/p/${x.id}`} className="grow">{x.name} <ColorDots colors={x.colors} /></Link>
                <span className="muted small">{[categoryLabel(x.category), x.care_dry ? dryLabel(x.care_dry) : '', x.care_iron ? ironLabel(x.care_iron) : ''].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
          {g.items.some((x) => x.care_note) ? <p className="muted small">{g.items.filter((x) => x.care_note).map((x) => `${x.name}: ${x.care_note}`).join(' · ')}</p> : null}
        </section>
      ))}
      {groups.length > 1 ? (
        <button type="button" className="btn wide" disabled={busy} onClick={() => void washed(groups.flatMap((g) => g.items.map((x) => x.id)), 'todas')}>Todas lavadas</button>
      ) : null}
    </main>
  );
}
