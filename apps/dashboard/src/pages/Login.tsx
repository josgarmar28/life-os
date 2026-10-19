import { useState } from 'react';
import { supabase } from '../supabase';

// Dos formas de entrar, sin coste:
//  · Contraseña (la habitual): funciona igual en Safari y en la app instalada del iPhone.
//  · Enlace por correo (primera vez o si olvidas la contraseña): ábrelo en Safari y crea la
//    contraseña en Ajustes. Si el correo trae además un código (SMTP propio), se puede escribir aquí.
//    En el plan gratuito los proyectos nuevos no pueden cambiar la plantilla del correo, por eso
//    el enlace es la vía garantizada y el código es opcional.
type Mode = 'password' | 'link' | 'sent';

export function Login() {
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState(() => localStorage.getItem('lifeos.email') ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const remember = () => localStorage.setItem('lifeos.email', email.trim());

  async function withPassword() {
    setBusy(true);
    setMsg(null);
    remember();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setMsg(/invalid login/i.test(error.message)
      ? 'Correo o contraseña incorrectos. Si aún no tienes contraseña, entra con un enlace por correo.'
      : error.message);
  }

  async function sendLink() {
    setBusy(true);
    setMsg(null);
    remember();
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (!error) return setMode('sent');
    const wait = error.message.match(/after (\d+) seconds/);
    if (wait) setMsg(`Por seguridad, espera ${Math.max(1, Number(wait[1]))} s antes de pedir otro correo.`);
    else if (/rate limit/i.test(error.message)) setMsg('Demasiados correos seguidos (el plan gratuito permite pocos por hora); espera un rato.');
    else if (/signups not allowed|not found|not authorized/i.test(error.message)) setMsg('Ese correo no tiene acceso a este LIFE OS.');
    else setMsg(error.message);
  }

  async function verify() {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setMsg('Código incorrecto o caducado.');
  }

  const switchTo = (m: Mode) => { setMsg(null); setMode(m); };

  return (
    <main className="login">
      <h1>LIFE OS</h1>
      {mode === 'password' ? (
        <form onSubmit={(e) => { e.preventDefault(); void withPassword(); }}>
          <label>Correo<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="btn primary" disabled={busy || !email || !password}>Entrar</button>
          <button type="button" className="link" onClick={() => switchTo('link')}>Primera vez u olvidé la contraseña</button>
        </form>
      ) : mode === 'link' ? (
        <form onSubmit={(e) => { e.preventDefault(); void sendLink(); }}>
          <p className="muted">Te envío un enlace de acceso. Ábrelo en Safari y, ya dentro, crea tu contraseña en Ajustes para entrar desde la app.</p>
          <label>Correo<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button className="btn primary" disabled={busy || !email}>Enviarme un enlace</button>
          <button type="button" className="link" onClick={() => switchTo('password')}>Entrar con contraseña</button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <p className="muted">Correo enviado a {email}. Abre el enlace en Safari. Si el correo trae un código de 6 dígitos, también puedes escribirlo aquí.</p>
          <label>Código<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <button className="btn primary" disabled={busy || code.trim().length < 6}>Entrar con el código</button>
          <button type="button" className="link" onClick={() => switchTo('password')}>Entrar con contraseña</button>
        </form>
      )}
      {msg ? <p className="error">{msg}</p> : null}
    </main>
  );
}
