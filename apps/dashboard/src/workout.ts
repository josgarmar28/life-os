// Utilidades del modo entreno en el iPhone: pantalla encendida, aviso sonoro y modo foco.
// Safari no deja vibrar a una web (navigator.vibrate no existe en iOS) y la pantalla se bloquea a los
// 30 s: sin esto, el descanso termina en silencio con el móvil en el bolsillo o en el banco.
import { useEffect, useState } from 'react';

let ctx: AudioContext | null = null;

/** Prepara el audio dentro de un toque (iOS solo deja sonar si el audio se activó con un gesto). */
export function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* sin audio */ }
}

/** Pitidos cortos (no corta la música: se mezcla con ella). Con el iPhone en silencio no suena; queda el aviso en pantalla. */
export function beep(times = 1, freq = 880) {
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < times; i++) {
      const t = t0 + i * 0.28;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch { /* sin audio */ }
  try { navigator.vibrate?.([300, 150, 300]); } catch { /* sin vibración (iOS) */ }
}

/** Mantiene la pantalla encendida mientras `on` (Safari 16.4+); se vuelve a pedir al volver a la app. */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!on || !wl) return;
    let lock: { release: () => Promise<void> } | null = null;
    let alive = true;
    const get = () => wl.request('screen').then((l) => { if (alive) lock = l; else void l.release(); }).catch(() => { /* batería baja o sin permiso */ });
    void get();
    const onVisible = () => { if (document.visibilityState === 'visible') void get(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [on]);
}

/** Modo foco: durante la sesión se ocultan las pestañas (clase en <body>). */
export function useFocusMode(on: boolean) {
  useEffect(() => {
    if (!on) return;
    document.body.classList.add('focus');
    return () => document.body.classList.remove('focus');
  }, [on]);
}

/** Hora actual que se refresca cada segundo mientras `on` (para el tiempo de sesión). */
export function useTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}
