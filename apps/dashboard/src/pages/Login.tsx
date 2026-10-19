import { useState } from 'react';
import { supabase } from '../supabase';

// Inicio de sesión con código de un solo uso por correo. El código (y no el enlace) funciona
// también dentro de la app instalada en el iPhone, que no comparte sesión con Safari.
export function Login() {
  const [email, setEmail] = useState(() => localStorage.getItem('lifeos.email') ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setMsg(null);
    localStorage.setItem('lifeos.email', email.trim());
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) setMsg(/rate limit/i.test(error.message) ? 'Demasiados correos seguidos; espera unos minutos.' : error.message);
    else setSent(true);
  }

  async function verify() {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setMsg('Código incorrecto o caducado.');
  }

  return (
    <main className="login">
      <h1>LIFE OS</h1>
      {!sent ? (
        <form onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
          <label>Correo<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button className="btn primary" disabled={busy || !email}>Enviarme un código</button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <p className="muted">Te he enviado un código a {email}. Escríbelo aquí.</p>
          <label>Código<input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <button className="btn primary" disabled={busy || code.length < 6}>Entrar</button>
          <button type="button" className="link" onClick={() => setSent(false)}>Cambiar de correo</button>
        </form>
      )}
      {msg ? <p className="error">{msg}</p> : null}
    </main>
  );
}
