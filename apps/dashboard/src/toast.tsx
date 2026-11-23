// Aviso breve abajo ("Guardado ✓", con Deshacer unos segundos). Uno a la vez; sobrevive al cambio de pantalla.
import { useEffect, useState } from 'react';

export interface Toast {
  text: string;
  action?: { label: string; run: () => void | Promise<void> };
  /** Milisegundos a la vista (por defecto 6 s). */
  ms?: number;
}

let current: (Toast & { id: number }) | null = null;
let seq = 0;
const EVENT = 'lifeos-toast';

export function showToast(t: Toast) {
  current = { ...t, id: ++seq };
  window.dispatchEvent(new Event(EVENT));
}

export function hideToast() {
  current = null;
  window.dispatchEvent(new Event(EVENT));
}

export function Toaster() {
  const [t, setT] = useState(current);
  useEffect(() => {
    const on = () => setT(current);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (!t) return;
    const id = t.id;
    const timer = setTimeout(() => { if (current?.id === id) hideToast(); }, t.ms ?? 6000);
    return () => clearTimeout(timer);
  }, [t]);
  if (!t) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="grow">{t.text.replace(/ ✓/g, '\u00a0✓')}</span>
      {t.action ? (
        <button type="button" className="btn small ghost" onClick={() => { const a = t.action!; hideToast(); void a.run(); }}>{t.action.label}</button>
      ) : null}
    </div>
  );
}
