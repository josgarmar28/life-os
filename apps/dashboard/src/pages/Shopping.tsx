// Compra: lo que falta para el próximo pedido, la despensa estimada (con recuento) y los pedidos.
// La despensa se calcula con el menú: último recuento + compras − lo que el menú gasta cada día.
import { useMemo, useState } from 'react';
import { addDays, localDate } from '@shared/stats.ts';
import { awayDates, isoWeekday, STORAGE_LABEL, weekSettings, type MealsPlan, type Product, type Storage } from '@shared/plans.ts';
import { estimateStock, formatQty, shoppingList, type NeedLine, type StockLine, type StockMove } from '@shared/shopping.ts';
import { weekStart } from '@shared/stats.ts';
import { useStructure } from '../data';
import { Link } from '../router';
import { explainError, rpc } from '../supabase';
import { fmtChf, fmtNum, shortDate, usePlans, usePlansFor, type OrderRow } from '../plans';

type Tab = 'lista' | 'despensa' | 'pedidos';
const STORAGES: Storage[] = ['nevera', 'congelador', 'despensa'];

export function Shopping({ tab }: { tab: Tab }) {
  const s = useStructure();
  const p = usePlans();
  const today = localDate(new Date(), s.timezone);
  const plans = usePlansFor(today);
  const meals = plans.meals?.content ?? null;
  const pending = p.orders.filter((o) => o.status === 'ordered');

  const nav = (
    <nav className="subtabs" aria-label="Compra">
      <Link to="/compra" className={tab === 'lista' ? 'on' : ''}>Lista</Link>
      <Link to="/compra/despensa" className={tab === 'despensa' ? 'on' : ''}>Despensa</Link>
      <Link to="/compra/pedidos" className={tab === 'pedidos' ? 'on' : ''}>Pedidos{pending.length ? <span className="badge">{pending.length}</span> : null}</Link>
    </nav>
  );

  if (!meals && !p.loading) {
    return <main><header className="page-head"><h1>Compra</h1></header><p>Aún no hay menú. Impórtalo en <Link to="/ajustes">Ajustes → Planes</Link> o pídeselo a Claude.</p></main>;
  }
  return (
    <main>
      <header className="page-head">
        <h1>Compra</h1>
        {plans.meals?.preview ? <p className="banner">Vista previa: este menú empieza el {shortDate(plans.meals.row.valid_from, { day: 'numeric', month: 'long' })}. Hasta entonces la despensa no descuenta nada.</p> : null}
        {p.offline ? <p className="muted small">Sin conexión: datos guardados en el teléfono.</p> : null}
        {nav}
      </header>
      {meals ? (
        tab === 'lista' ? <ListTab meals={meals} today={today} preview={Boolean(plans.meals?.preview)} />
          : tab === 'despensa' ? <PantryTab meals={meals} today={today} preview={Boolean(plans.meals?.preview)} />
            : <OrdersTab meals={meals} />
      ) : null}
    </main>
  );
}

/** Stock estimado hoy (sin consumo si el menú aún no ha empezado). */
function useStock(meals: MealsPlan, today: string, preview: boolean, extra: StockMove[] = []): StockLine[] {
  const p = usePlans();
  return useMemo(() => {
    const away = awayDates(p.weeks, addDays(today, -400), addDays(today, 60));
    const start = previewStart(p.plans, preview);
    const moves = [...p.moves, ...extra];
    if (!start) return estimateStock(meals, moves, today, away);
    // Antes de que empiece el menú no se gasta nada: se calcula "como si hoy fuera" el día anterior al inicio.
    const virtualToday = addDays(start, -1);
    return estimateStock(meals, moves.map((m) => (m.local_date > virtualToday ? { ...m, local_date: virtualToday } : m)), virtualToday, away);
  }, [meals, today, preview, p.moves, p.weeks, p.plans, extra]);
}

function previewStart(plans: { kind: string; valid_from: string; status: string }[], preview: boolean): string | null {
  if (!preview) return null;
  const f = plans.filter((x) => x.kind === 'meals' && x.status === 'active').map((x) => x.valid_from).sort();
  return f[0] ?? null;
}

/** Próximo día de entrega por defecto: el primer jueves o viernes de teletrabajo a partir de pasado mañana. */
function defaultDelivery(today: string, weeks: ReturnType<typeof usePlans>['weeks'], schedule: Parameters<typeof weekSettings>[1]): string {
  for (let i = 2; i < 16; i++) {
    const d = addDays(today, i);
    const wd = isoWeekday(d);
    if (wd !== 4 && wd !== 5) continue;
    if (weekSettings(weeks, schedule, weekStart(d)).telework.includes(wd)) return d;
  }
  return addDays(today, 3);
}

function ListTab({ meals, today, preview }: { meals: MealsPlan; today: string; preview: boolean }) {
  const p = usePlans();
  const plans = usePlansFor(today);
  const startOfMenu = previewStart(p.plans, preview);
  const [delivery, setDelivery] = useState(() => {
    const d = defaultDelivery(today, p.weeks, plans.schedule?.content ?? null);
    return startOfMenu && d < startOfMenu ? startOfMenu : d;
  });
  // Lo ya pedido y no recibido cuenta como si llegara el día de su entrega.
  const incoming = useMemo<StockMove[]>(() => p.orders.filter((o) => o.status === 'ordered' && o.delivery_date <= delivery)
    .flatMap((o) => o.items.map((i) => ({ product: i.product, kind: 'purchase' as const, qty: i.amount, occurred_at: `${o.delivery_date}T09:00:00Z`, local_date: o.delivery_date }))), [p.orders, delivery]);
  const stock = useStock(meals, today, preview, incoming);
  const away = useMemo(() => awayDates(p.weeks, today, addDays(delivery, 40)), [p.weeks, today, delivery]);
  const from = startOfMenu && startOfMenu > today ? addDays(startOfMenu, -1) : today;
  const list = useMemo(() => shoppingList(meals, stock, from, delivery < from ? addDays(from, 1) : delivery, { away }), [meals, stock, from, delivery, away]);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [reqId] = useState(() => crypto.randomUUID());

  const packs = (l: NeedLine) => edits[l.product.key] ?? l.packages;
  const chosen = list.lines.filter((l) => packs(l) > 0);
  const total = Math.round(chosen.reduce((a, l) => a + packs(l) * (l.product.price ?? 0), 0) * 100) / 100;
  const unknown = list.lines.filter((l) => l.unknown).length;
  const shown = [...list.lines].sort((a, b) => Number(packs(b) > 0) - Number(packs(a) > 0) || a.product.name.localeCompare(b.product.name, 'es'));
  const pendingOrders = p.orders.filter((o) => o.status === 'ordered' && o.delivery_date <= delivery);

  async function order() {
    setBusy(true);
    setMsg(null);
    try {
      const items = chosen.map((l) => ({ product: l.product.key, packages: packs(l), amount: packs(l) * l.product.package, ...(l.product.price !== undefined ? { price: l.product.price } : {}) }));
      await rpc('save_order', { p_delivery_date: delivery, p_items: items, p_request_id: reqId, p_total: total, p_note: '' });
      await p.reload();
      setEdits({});
      setMsg({ ok: true, text: `Pedido guardado para el ${shortDate(delivery, { weekday: 'long', day: 'numeric' })}. Al recibirlo, márcalo en Pedidos y la despensa se actualiza.` });
    } catch (e) {
      setMsg({ ok: false, text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    const text = [...chosen, ...list.other.filter((l) => l.packages > 0)]
      .map((l) => `${packs(l)} × ${l.product.store_name ?? l.product.name}${l.product.shop && l.product.shop !== meals.shop ? ` (${l.product.shop})` : ''}`).join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* sin portapapeles */ }
  }

  return (
    <>
      <section className="card">
        <label>Entrega del pedido<input type="date" value={delivery} min={addDays(today, 1)} onChange={(e) => { if (e.target.value) setDelivery(e.target.value); }} /></label>
        <p className="muted small">Cubre del {shortDate(list.delivery, { day: 'numeric', month: 'short' })} al {shortDate(list.until, { day: 'numeric', month: 'short' })} ({meals.cover_days ?? 14} días + {meals.buffer_days ?? 2} de margen){away.size ? ', sin contar los días fuera de casa' : ''}.</p>
        {pendingOrders.length ? <p className="muted small">Ya cuenta con {pendingOrders.length === 1 ? 'el pedido pendiente' : `${pendingOrders.length} pedidos pendientes`} del {pendingOrders.map((o) => shortDate(o.delivery_date, { day: 'numeric', month: 'short' })).join(', ')}.</p> : null}
        {unknown ? <p className="banner">{unknown} {unknown === 1 ? 'producto no se ha contado nunca' : 'productos no se han contado nunca'}: se supone que no hay nada. <Link to="/compra/despensa">Contar la despensa</Link></p> : null}
      </section>

      <section className="card">
        <div className="card-head"><h2>Falta</h2><span className="muted small">{chosen.length} de {list.lines.length}</span></div>
        <ul className="list shop-list">
          {shown.map((l) => (
            <li key={l.product.key} className={packs(l) > 0 ? '' : 'dim'}>
              <span className="grow">
                {l.product.name}
                <span className="muted small block">
                  {l.unknown ? 'sin contar' : `quedarán ${formatQty(l.product, l.atDelivery)}`} · hacen falta {formatQty(l.product, l.need)}
                </span>
              </span>
              <span className="stepper" role="group" aria-label={l.product.name}>
                <button className="btn small ghost" aria-label={`Menos ${l.product.name}`} disabled={packs(l) <= 0} onClick={() => setEdits({ ...edits, [l.product.key]: Math.max(0, packs(l) - 1) })}>−</button>
                <span className="qty">{packs(l)}</span>
                <button className="btn small ghost" aria-label={`Más ${l.product.name}`} onClick={() => setEdits({ ...edits, [l.product.key]: packs(l) + 1 })}>+</button>
              </span>
              <span className="price small">{l.product.price !== undefined ? fmtChf(packs(l) * l.product.price) : ''}</span>
            </li>
          ))}
        </ul>
        <p className="total"><span className="grow">Total estimado</span><strong>{fmtChf(total)}</strong></p>
        {meals.min_order && total < meals.min_order ? <p className="banner">Por debajo del mínimo de {fmtChf(meals.min_order)} de la tienda: faltan {fmtChf(meals.min_order - total)}. Puedes adelantar básicos de despensa.</p> : null}
        <div className="row gap">
          <button className="btn primary grow" disabled={busy || !chosen.length} onClick={() => void order()}>He hecho el pedido</button>
          <button className="btn ghost" onClick={() => void copy()}>{copied ? 'Copiada' : 'Copiar lista'}</button>
        </div>
        {msg ? <p className={msg.ok ? 'ok-line small' : 'error'}>{msg.text}</p> : null}
      </section>

      {list.other.length ? (
        <section className="card">
          <h2>Otras tiendas (pedido aparte)</h2>
          <ul className="list">
            {list.other.map((l) => (
              <li key={l.product.key}>
                <span className="grow">{l.product.name}<span className="muted small block">{l.product.shop} · {l.unknown ? 'sin contar' : `quedarán ${formatQty(l.product, l.atDelivery)}`}</span></span>
                <strong>{l.packages}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function PantryTab({ meals, today, preview }: { meals: MealsPlan; today: string; preview: boolean }) {
  const p = usePlans();
  const stock = useStock(meals, today, preview);
  const [counting, setCounting] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reqId, setReqId] = useState(() => crypto.randomUUID());

  const inPacks = (pr: Product) => !(pr.unit === 'ud' && pr.package === 1);
  async function save() {
    const moves: { product: string; kind: 'count'; qty: number }[] = [];
    for (const [k, v] of Object.entries(vals)) {
      const t = v.trim().replace(',', '.');
      if (!t) continue;
      const n = Number(t);
      const pr = meals.products.find((x) => x.key === k)!;
      if (!Number.isFinite(n) || n < 0) return setMsg({ ok: false, text: `${pr.name}: número no válido` });
      moves.push({ product: k, kind: 'count', qty: Math.round(n * pr.package * 1000) / 1000 });
    }
    if (!moves.length) return setMsg({ ok: false, text: 'No has contado nada.' });
    setBusy(true);
    setMsg(null);
    try {
      await rpc('record_stock', { p_moves: moves, p_request_id: reqId });
      await p.reload();
      setVals({});
      setCounting(false);
      setReqId(crypto.randomUUID());
      setMsg({ ok: true, text: `Recuento guardado (${moves.length} ${moves.length === 1 ? 'producto' : 'productos'}).` });
    } catch (e) {
      setMsg({ ok: false, text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted small">Estimación con el menú: lo que contaste, más lo que llegó, menos lo que el menú gasta cada día. Cuenta de vez en cuando (por ejemplo, antes de cada pedido) para corregirla.</p>
      {msg ? <p className={msg.ok ? 'ok-line small' : 'error'}>{msg.text}</p> : null}
      {STORAGES.map((st) => {
        const rows = stock.filter((l) => l.product.storage === st);
        if (!rows.length) return null;
        return (
          <section key={st} className="card">
            <h2>{STORAGE_LABEL[st]}</h2>
            <ul className="list pantry">
              {rows.map((l) => (
                <li key={l.product.key}>
                  <span className="grow">{l.product.name}
                    <span className="muted small block">
                      {l.counted ? `contado el ${shortDate(l.counted, { day: 'numeric', month: 'short' })}` : 'sin contar'}
                      {l.daysLeft !== null && l.qty !== null ? ` · da para ${fmtNum(l.daysLeft, 0)} ${Math.round(l.daysLeft) === 1 ? 'día' : 'días'}` : ''}
                    </span>
                  </span>
                  {counting ? (
                    <label className="count-input">
                      <input inputMode="decimal" aria-label={`${l.product.name} (${inPacks(l.product) ? l.product.package_label ?? 'envases' : 'ud'})`}
                        placeholder={l.qty !== null ? fmtNum(Math.max(0, l.qty) / l.product.package) : '—'} value={vals[l.product.key] ?? ''}
                        onChange={(e) => setVals({ ...vals, [l.product.key]: e.target.value })} />
                      <span className="muted small">{inPacks(l.product) ? `${l.product.package_label ?? 'env.'} de ${l.product.package} ${l.product.unit}` : 'ud'}</span>
                    </label>
                  ) : (
                    <span className={l.qty !== null && l.daysLeft !== null && l.daysLeft < 3 ? 'stock low' : 'stock'}>
                      {l.qty === null ? '—' : formatQty(l.product, Math.max(0, l.qty))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <div className="sticky-actions row gap">
        {counting ? (
          <>
            <button className="btn primary grow" disabled={busy} onClick={() => void save()}>Guardar recuento</button>
            <button className="btn ghost" onClick={() => { setCounting(false); setVals({}); }}>Cancelar</button>
          </>
        ) : <button className="btn primary grow" onClick={() => setCounting(true)}>Contar la despensa</button>}
      </div>
      {counting ? <p className="muted small">Solo cuenta lo que quieras: lo que dejes vacío sigue con la estimación.</p> : null}
    </>
  );
}

function OrdersTab({ meals }: { meals: MealsPlan }) {
  const p = usePlans();
  const open = p.orders.filter((o) => o.status === 'ordered');
  const done = p.orders.filter((o) => o.status !== 'ordered').slice(0, 10);
  return (
    <>
      {!open.length ? <p className="muted">No hay pedidos en camino. Cuando hagas uno, márcalo en la Lista con «He hecho el pedido».</p> : null}
      {open.map((o) => <OpenOrder key={o.id} o={o} meals={meals} />)}
      {done.length ? (
        <section className="card">
          <h2>Anteriores</h2>
          <ul className="list">
            {done.map((o) => (
              <li key={o.id}>
                <span className="grow">{shortDate(o.delivery_date)} · {o.items.length} productos</span>
                <span className="muted small">{o.status === 'received' ? 'Recibido' : 'Cancelado'}{o.total !== null ? ` · ${fmtChf(Number(o.total))}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function OpenOrder({ o, meals }: { o: OrderRow; meals: MealsPlan }) {
  const p = usePlans();
  const [got, setGot] = useState<Record<string, boolean>>(() => Object.fromEntries(o.items.map((i) => [i.product, true])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reqId] = useState(() => crypto.randomUUID());
  const name = (k: string) => meals.products.find((x) => x.key === k)?.name ?? k;

  async function act(kind: 'receive' | 'cancel') {
    if (kind === 'cancel' && !confirm('¿Cancelar este pedido? No se sumará a la despensa.')) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'receive') await rpc('receive_order', { p_id: o.id, p_items: o.items.filter((i) => got[i.product]), p_request_id: reqId });
      else await rpc('cancel_order', { p_id: o.id });
      await p.reload();
    } catch (e) {
      setError(explainError(e));
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head"><h2>Entrega del {shortDate(o.delivery_date, { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
        {o.total !== null ? <span className="muted small">{fmtChf(Number(o.total))}</span> : null}</div>
      <p className="muted small">Desmarca lo que no haya llegado; lo marcado se suma a la despensa.</p>
      <ul className="list">
        {o.items.map((i) => (
          <li key={i.product}>
            <label className="check grow"><input type="checkbox" checked={got[i.product] ?? false} onChange={(e) => setGot({ ...got, [i.product]: e.target.checked })} /> {name(i.product)}</label>
            <span className="muted">{i.packages}</span>
          </li>
        ))}
      </ul>
      {error ? <p className="error">{error}</p> : null}
      <div className="row gap">
        <button className="btn primary grow" disabled={busy} onClick={() => void act('receive')}>Recibido</button>
        <button className="btn ghost" disabled={busy} onClick={() => void act('cancel')}>Cancelar pedido</button>
      </div>
    </section>
  );
}
