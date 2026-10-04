import { FormEvent, useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import type { PublicInfo } from './Site';
import { accountPath } from './paths';

interface Props {
  info: PublicInfo;
  // Ramo escolhido na página (a área do cliente já abre com ele)
  initialSegment: string;
  onClose(): void;
}

// Primeiro passo do teste grátis: a conta (nome, e-mail, WhatsApp e senha).
// Depois a pessoa entra na área dela e preenche os dados do negócio
export default function SignupModal({ info, initialSegment, onClose }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  // Campo escondido contra robôs
  const [website, setWebsite] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !saving) onClose();
    }

    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, saving]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');

    if (!name.trim()) return setError('Informe o seu nome.');
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim())) return setError('Informe um e-mail válido.');
    if (phone.replace(/\D/g, '').length < 10) return setError('Informe o WhatsApp com DDD.');
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
    if (!accepted) return setError('Aceite os termos de uso para continuar.');

    setSaving(true);

    try {
      await api('/account/signup', {
        method: 'POST',
        body: { name, email, phone, password, accepted_terms: accepted, website },
      });

      try {
        sessionStorage.setItem('pontual:segment', initialSegment);
      } catch {
        // Sem storage: a área abre no primeiro ramo
      }

      window.location.assign(accountPath());
    } catch (err) {
      setSaving(false);
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir. Tente de novo.');
    }

    return undefined;
  };

  return (
    <div
      className="mk-overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="mk-modal mk-modal-small" role="dialog" aria-modal="true" aria-labelledby="signup-title">
        <div className="mk-modal-head">
          <div>
            <h2 id="signup-title">Crie sua conta</h2>
            <p>{`Passo 1 de 2 · Depois você preenche os dados do negócio. ${info.trial_days} dias grátis, sem cartão.`}</p>
          </div>
          <button type="button" className="mk-close" aria-label="Fechar" onClick={onClose}>
            ×
          </button>
        </div>

        <form className="mk-form" onSubmit={submit} noValidate>
          <div className="mk-form-body">
            {!info.signup_enabled && (
              <p className="mk-alert">Os cadastros estão fechados no momento. Volte em breve.</p>
            )}

            <div className="mk-row">
              <label className="mk-field">
                <span>Seu nome</span>
                <input
                  value={name}
                  maxLength={80}
                  autoFocus
                  autoComplete="name"
                  onChange={event => setName(event.target.value)}
                />
              </label>
              <label className="mk-field">
                <span>WhatsApp</span>
                <input
                  value={phone}
                  maxLength={20}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(11) 99999-0000"
                  onChange={event => setPhone(event.target.value)}
                />
              </label>
            </div>

            <label className="mk-field">
              <span>E-mail</span>
              <input
                type="email"
                value={email}
                maxLength={100}
                autoComplete="email"
                onChange={event => setEmail(event.target.value)}
              />
            </label>

            <label className="mk-field">
              <span>Senha (mínimo 8 caracteres)</span>
              <input
                type="password"
                value={password}
                maxLength={72}
                autoComplete="new-password"
                onChange={event => setPassword(event.target.value)}
              />
              <small>Você usa este e-mail e esta senha para entrar na sua conta e no seu sistema.</small>
            </label>

            <label className="mk-hidden" aria-hidden="true">
              Site
              <input tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} />
            </label>

            <label className="mk-check">
              <input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />
              Li e aceito os termos de uso e a política de privacidade.
            </label>

            <p className="mk-error" role="alert">
              {error}
            </p>
          </div>

          <div className="mk-modal-foot">
            <a className="mk-foot-link" href={accountPath()}>
              Já tenho conta
            </a>
            <button type="button" className="mk-btn mk-btn-ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="mk-btn mk-btn-primary" disabled={saving || !info.signup_enabled}>
              {saving ? 'Criando...' : 'Criar conta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
