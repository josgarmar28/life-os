// Avisos en el iPhone: activar en este dispositivo, probar y elegir horas.
import { useEffect, useState } from 'react';
import { fromB64url } from '@shared/webpush.ts';
import { explainError, rpc, supabase } from '../supabase';
import { useAsync } from '../data';

interface Reminder { key: 'dia' | 'semana'; enabled: boolean; at: string; days: number[] }
interface Settings {
  public_key: string | null;
  subscriptions: { id: string; endpoint: string; label: string; created_at: string; last_ok_at: string | null }[];
  reminders: Reminder[];
}

const REMINDER_TEXT: Record<Reminder['key'], [string, string]> = {
  dia: ['Empezar el día', 'Si a esa hora falta el peso o el registro de mañana.'],
  semana: ['Revisión semanal', 'Para revisar la semana y preparar la siguiente.'],
};
const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'ordenador';
}

async function callPush<T>(action: 'key' | 'test'): Promise<T> {
  const { data, error } = await supabase.functions.invoke('push', { body: { action } });
  if (error) throw new Error('No se pudo contactar con el servicio de avisos.');
  return data as T;
}

export function PushCard() {
  const settings = useAsync(() => rpc<Settings>('push_settings', {}), []);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const can = supported();

  // La clave se pide antes de tocar el botón: en el iPhone, suscribirse tiene que ir directo del toque.
  useEffect(() => {
    if (!can) return;
    void navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setEndpoint(s?.endpoint ?? null)).catch(() => {});
    void callPush<{ public_key: string }>('key').then((r) => setPublicKey(r.public_key)).catch(() => {});
  }, [can]);

  const s = settings.data;
  const here = Boolean(endpoint && s?.subscriptions.some((x) => x.endpoint === endpoint));
  const others = (s?.subscriptions ?? []).filter((x) => x.endpoint !== endpoint);

  async function enable() {
    setMsg(null);
    if (!publicKey) { setMsg('El servicio de avisos no responde; prueba de nuevo en un momento.'); return; }
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(publicKey) as BufferSource });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_label: deviceLabel() });
      setEndpoint(j.endpoint);
      await settings.reload();
      await callPush('test');
      setMsg('Activados. Te ha llegado un aviso de prueba.');
    } catch (e) {
      setMsg(Notification.permission === 'denied'
        ? 'Los avisos están bloqueados para esta app. Actívalos en Ajustes del iPhone › Notificaciones › LIFE OS.'
        : explainError(e));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEndpoint(null);
      await settings.reload();
      setMsg('Desactivados en este dispositivo.');
    } catch (e) {
      setMsg(explainError(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try { await callPush('test'); setMsg('Aviso de prueba enviado.'); } catch (e) { setMsg(explainError(e)); } finally { setBusy(false); }
  }

  // Se ve el cambio al momento; si la base de datos lo rechaza, vuelve a lo guardado.
  const [pending, setPending] = useState<Reminder[] | null>(null);
  const reminders = pending ?? s?.reminders ?? [];
  async function save(r: Reminder, patch: Partial<Reminder>) {
    const next = { ...r, ...patch };
    if (!next.days.length) return;
    setPending(reminders.map((x) => (x.key === r.key ? next : x)));
    try {
      await rpc('save_push_reminder', { p_key: next.key, p_enabled: next.enabled, p_at: next.at, p_days: next.days });
      await settings.reload();
    } catch (e) {
      setMsg(explainError(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="card push-card" aria-labelledby="push-h">
      <h2 id="push-h">Avisos</h2>
      {!can ? (
        <p className="small">{isIos() && !standalone()
          ? 'En el iPhone, los avisos funcionan con la app en la pantalla de inicio (Safari › Compartir › «Añadir a pantalla de inicio»). Ábrela desde allí y vuelve aquí.'
          : 'Este navegador no admite avisos.'}</p>
      ) : here ? (
        <div className="row gap wrap">
          <p className="ok-line grow">Activados en este {deviceLabel()}.</p>
          <button type="button" className="btn small" disabled={busy} onClick={() => void test()}>Probar</button>
          <button type="button" className="btn small ghost" disabled={busy} onClick={() => void disable()}>Desactivar</button>
        </div>
      ) : (
        <>
          <p className="small">Un aviso a la hora que elijas, solo si hace falta. Sin coste: lo envía tu propio Supabase.</p>
          <button type="button" className="btn primary wide" disabled={busy} onClick={() => void enable()}>Activar avisos en este {deviceLabel()}</button>
        </>
      )}
      {others.length ? <p className="muted small">También activados en: {others.map((x) => x.label || 'otro dispositivo').join(', ')}.</p> : null}
      {msg ? <p className="small" role="status">{msg}</p> : null}

      {s ? (
        <ul className="reminders">
          {reminders.map((r) => {
            const [title, help] = REMINDER_TEXT[r.key];
            return (
              <li key={r.key}>
                <label className="row gap reminder-head">
                  <input type="checkbox" checked={r.enabled} onChange={(e) => void save(r, { enabled: e.target.checked })} />
                  <span className="grow"><strong>{title}</strong><span className="block muted small">{help}</span></span>
                  <input type="time" aria-label={`Hora de ${title}`} value={r.at} disabled={!r.enabled}
                    onChange={(e) => { if (e.target.value) void save(r, { at: e.target.value }); }} />
                </label>
                <div className="day-chips" role="group" aria-label={`Días de ${title}`}>
                  {DAYS.map((d, i) => {
                    const on = r.days.includes(i + 1);
                    return (
                      <button key={d} type="button" className={on ? 'chip on' : 'chip'} aria-pressed={on} disabled={!r.enabled}
                        onClick={() => void save(r, { days: on ? r.days.filter((x) => x !== i + 1) : [...r.days, i + 1] })}>{d}</button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      ) : settings.error ? <p className="error small">{settings.error}</p> : null}
    </section>
  );
}
