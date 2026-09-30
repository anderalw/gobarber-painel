import { FormEvent, useState } from 'react';

import { api } from '../api';

export default function Login({ onLogged }: { onLogged(): void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError('');

    try {
      await api('/login', { method: 'POST', body: { email, password } });
      onLogged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      setSending(false);
    }
  };

  return (
    <div className="login">
      <form onSubmit={submit} className="stack">
        <div>
          <span className="brand">
            <span className="mark">✂</span>
            Pontual <small>· Painel</small>
          </span>
          <h1>Entrar no painel</h1>
          <p className="muted">Controle das barbearias do SaaS.</p>
        </div>

        <label className="field">
          <span>E-mail</span>
          <input
            className="input"
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Senha</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
        </label>

        <span className="error-text" role="alert">
          {error}
        </span>

        <button type="submit" className="btn" disabled={sending}>
          {sending ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
