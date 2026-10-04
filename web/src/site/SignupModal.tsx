import { FormEvent, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '../api';
import type { PublicInfo } from './Site';

interface Props {
  info: PublicInfo;
  initialSegment: string;
  onClose(): void;
}

interface SlugCheck {
  slug: string;
  available: boolean;
  suggestion: string;
}

interface Created {
  url: string;
  login_url: string;
  email: string;
  trial_until: string;
}

// Mesma regra do servidor (slugify): "Studio do Zé" -> "studio-do-ze"
function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
}

function formatDay(day: string): string {
  const [year, month, date] = day.split('-');

  return `${date}/${month}/${year}`;
}

const STEPS = ['Criando o seu negócio', 'Preparando os serviços do ramo', 'Publicando o seu site'];

// Cadastro com dias de teste: o negócio nasce no ar com o que a pessoa
// escolheu (nome, ramo, endereço) e ela entra com o e-mail e a senha dela
export default function SignupModal({ info, initialSegment, onClose }: Props) {
  const [segment, setSegment] = useState(initialSegment);
  const [businessName, setBusinessName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [check, setCheck] = useState<SlugCheck | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  // Campo escondido contra robôs
  const [website, setWebsite] = useState('');
  const [error, setError] = useState('');
  const [state, setState] = useState<'form' | 'creating' | 'done'>('form');
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState<Created | null>(null);
  const timer = useRef<number>();

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && state !== 'creating') onClose();
    }

    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, state]);

  // O endereço segue o nome até a pessoa mexer nele
  useEffect(() => {
    if (!slugEdited) setSlug(slugify(businessName));
  }, [businessName, slugEdited]);

  // Confere se o endereço está livre (espera a pessoa parar de digitar)
  useEffect(() => {
    setCheck(null);
    window.clearTimeout(timer.current);

    if (slug.length < 3) return undefined;

    timer.current = window.setTimeout(() => {
      api<SlugCheck>(`/public/slug?value=${encodeURIComponent(slug)}`)
        .then(setCheck)
        .catch(() => undefined);
    }, 350);

    return () => window.clearTimeout(timer.current);
  }, [slug]);

  // Etapas enquanto o servidor cria o negócio
  useEffect(() => {
    if (state !== 'creating') return undefined;

    setStep(0);
    const id = window.setInterval(() => setStep(value => Math.min(value + 1, STEPS.length - 1)), 900);

    return () => window.clearInterval(id);
  }, [state]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');

    if (businessName.trim().length < 2) return setError('Informe o nome do seu negócio.');
    if (slug.length < 3) return setError('Escolha um endereço com pelo menos 3 letras.');
    if (check && !check.available) return setError('Esse endereço já está em uso. Escolha outro.');
    if (!name.trim()) return setError('Informe o seu nome.');
    if (phone.replace(/\D/g, '').length < 10) return setError('Informe o WhatsApp com DDD.');
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
    if (!accepted) return setError('Aceite os termos de uso para continuar.');

    setState('creating');

    try {
      const result = await api<Created>('/public/signup', {
        method: 'POST',
        body: {
          business_name: businessName,
          segment,
          slug,
          name,
          email,
          phone,
          password,
          accepted_terms: accepted,
          website,
        },
      });

      setCreated(result);
      setState('done');
    } catch (err) {
      setState('form');
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir. Tente de novo.');
    }

    return undefined;
  };

  let slugHint = 'Letras minúsculas, números e hífen.';
  let slugTone = '';

  if (check && check.slug === slug) {
    if (check.available) {
      slugHint = 'Endereço disponível.';
      slugTone = 'ok';
    } else {
      slugHint = check.suggestion !== check.slug ? `Em uso. Que tal "${check.suggestion}"?` : 'Endereço indisponível.';
      slugTone = 'bad';
    }
  }

  return (
    <div
      className="mk-overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget && state !== 'creating') onClose();
      }}
    >
      <div className="mk-modal" role="dialog" aria-modal="true" aria-labelledby="signup-title">
        <div className="mk-modal-head">
          <div>
            <h2 id="signup-title">
              {state === 'done' ? 'Seu sistema está no ar!' : `Teste grátis por ${info.trial_days} dias`}
            </h2>
            <p>{state === 'done' ? 'Tudo pronto para começar.' : 'Sem cartão de crédito. Pronto em menos de um minuto.'}</p>
          </div>
          {state !== 'creating' && (
            <button type="button" className="mk-close" aria-label="Fechar" onClick={onClose}>
              ×
            </button>
          )}
        </div>

        {state === 'form' && (
          <form className="mk-form" onSubmit={submit} noValidate>
            <div className="mk-form-body">
              {!info.signup_enabled && (
                <p className="mk-alert">Os cadastros estão fechados no momento. Volte em breve.</p>
              )}

              <span className="mk-label">Seu ramo</span>
              <div className="mk-chips" role="radiogroup" aria-label="Ramo do negócio">
                {info.segments.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    role="radio"
                    aria-checked={segment === item.key}
                    className={segment === item.key ? 'active' : ''}
                    onClick={() => setSegment(item.key)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>

              <div className="mk-row">
                <label className="mk-field">
                  <span>Nome do negócio</span>
                  <input
                    value={businessName}
                    maxLength={60}
                    autoFocus
                    placeholder="Ex.: Studio do Zé"
                    onChange={event => setBusinessName(event.target.value)}
                  />
                </label>
                <label className="mk-field">
                  <span>Endereço do seu site</span>
                  <div className={`mk-slug ${slugTone}`}>
                    <input
                      value={slug}
                      maxLength={30}
                      placeholder="studio-do-ze"
                      onChange={event => {
                        setSlugEdited(true);
                        setSlug(slugify(event.target.value));
                      }}
                    />
                    <em>{`.${info.base_domain}`}</em>
                  </div>
                  <small className={slugTone}>{slugHint}</small>
                </label>
              </div>

              <div className="mk-row">
                <label className="mk-field">
                  <span>Seu nome</span>
                  <input value={name} maxLength={80} autoComplete="name" onChange={event => setName(event.target.value)} />
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

              <div className="mk-row">
                <label className="mk-field">
                  <span>E-mail (para entrar)</span>
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
                    maxLength={100}
                    autoComplete="new-password"
                    onChange={event => setPassword(event.target.value)}
                  />
                </label>
              </div>

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
              <button type="button" className="mk-btn mk-btn-ghost" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="mk-btn mk-btn-primary" disabled={!info.signup_enabled}>
                Criar meu sistema
              </button>
            </div>
          </form>
        )}

        {state === 'creating' && (
          <div className="mk-progress" aria-live="polite">
            <span className="mk-spinner" aria-hidden="true" />
            <ul>
              {STEPS.map((label, index) => (
                <li key={label} className={index < step ? 'done' : index === step ? 'current' : ''}>
                  {label}
                </li>
              ))}
            </ul>
          </div>
        )}

        {state === 'done' && created && (
          <div className="mk-done">
            <p>
              Entre com <strong>{created.email}</strong> e a senha que você escolheu. O teste vai até{' '}
              <strong>{formatDay(created.trial_until)}</strong>.
            </p>
            <div className="mk-done-links">
              <a className="mk-btn mk-btn-primary" href={created.login_url}>
                Entrar no meu sistema
              </a>
              <a className="mk-btn mk-btn-ghost" href={created.url} target="_blank" rel="noreferrer">
                Ver o site dos clientes
              </a>
            </div>
            <ol className="mk-next">
              <li>Confira os serviços e os preços (vieram exemplos do seu ramo).</li>
              <li>Cadastre a equipe e os horários de trabalho.</li>
              <li>Coloque sua logo, sua cor e a foto de capa do site.</li>
              <li>{`Mande o link ${created.url.replace(/^https?:\/\//, '')} para os clientes.`}</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
