import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '../api';
import SignupModal from './SignupModal';
import type { PublicInfo } from './Site';
import { homePath } from './paths';

// Área do cliente da página de divulgação: entrar, preencher os dados do
// negócio (o sistema nasce no ar na hora) e acompanhar o teste

interface Business {
  name: string;
  slug: string;
  segment: string;
  url: string;
  login_url: string;
  status: 'active' | 'suspended' | 'legacy';
  trial: boolean;
  paid_until: string;
  billing: { state: 'ok' | 'due' | 'late'; days: number };
  monthly_price_cents: number;
}

interface AccountData {
  account: { name: string; email: string; phone: string };
  business: Business | null;
}

interface SlugCheck {
  slug: string;
  available: boolean;
  suggestion: string;
}

const STEPS = ['Criando o seu negócio', 'Preparando os serviços do ramo', 'Publicando o seu site'];

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

// 'yyyy-MM-dd' exclusivo -> último dia, 'dd/MM/yyyy'
function lastDay(day: string): string {
  const date = new Date(`${day}T12:00:00`);

  date.setDate(date.getDate() - 1);

  return date.toLocaleDateString('pt-BR');
}

// '21977771234' -> '(21) 97777-1234'
function formatPhone(digits: string): string {
  const match = digits.match(/^(\d{2})(\d{4,5})(\d{4})$/);

  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : digits;
}

function price(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function Login({ info }: { info: PublicInfo; }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [signup, setSignup] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      await api('/account/login', { method: 'POST', body: { email, password } });
      window.location.reload();
    } catch (err) {
      setSaving(false);
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
    }
  };

  return (
    <div className="mk-account-narrow">
      <form className="mk-card mk-account-card" onSubmit={submit} noValidate>
        <h1>Entrar na sua conta</h1>
        <p className="mk-sub">Acompanhe o seu teste e os dados do seu negócio.</p>
        <label className="mk-field">
          <span>E-mail</span>
          <input type="email" value={email} autoFocus autoComplete="email" onChange={e => setEmail(e.target.value)} />
        </label>
        <label className="mk-field">
          <span>Senha</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={e => setPassword(e.target.value)}
          />
        </label>
        <p className="mk-error" role="alert">
          {error}
        </p>
        <button type="submit" className="mk-btn mk-btn-primary" disabled={saving}>
          {saving ? 'Entrando...' : 'Entrar'}
        </button>
        <p className="mk-account-alt">
          Ainda não tem conta?{' '}
          <button type="button" className="mk-link" onClick={() => setSignup(true)}>
            {`Criar conta e testar ${info.trial_days} dias grátis`}
          </button>
        </p>
      </form>

      {signup && (
        <SignupModal
          info={info}
          initialSegment={info.segments[0]?.key || 'barbershop'}
          onClose={() => setSignup(false)}
        />
      )}
    </div>
  );
}

function Onboarding({
  info,
  data,
  onCreated,
}: {
  info: PublicInfo;
  data: AccountData;
  onCreated(data: AccountData): void;
}) {
  const [segment, setSegment] = useState(() => {
    try {
      return sessionStorage.getItem('pontual:segment') || info.segments[0]?.key || 'barbershop';
    } catch {
      return info.segments[0]?.key || 'barbershop';
    }
  });
  const [businessName, setBusinessName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [check, setCheck] = useState<SlugCheck | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(0);
  const timer = useRef<number>();

  useEffect(() => {
    if (!slugEdited) setSlug(slugify(businessName));
  }, [businessName, slugEdited]);

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

  useEffect(() => {
    if (!creating) return undefined;

    setStep(0);
    const id = window.setInterval(() => setStep(value => Math.min(value + 1, STEPS.length - 1)), 900);

    return () => window.clearInterval(id);
  }, [creating]);

  const selected = info.segments.find(item => item.key === segment);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');

    if (businessName.trim().length < 2) return setError('Informe o nome do seu negócio.');
    if (slug.length < 3) return setError('Escolha um endereço com pelo menos 3 letras.');
    if (check && check.slug === slug && !check.available) return setError('Esse endereço já está em uso. Escolha outro.');

    setCreating(true);

    try {
      const created = await api<AccountData>('/account/business', {
        method: 'POST',
        body: { business_name: businessName, segment, slug },
      });

      onCreated(created);
    } catch (err) {
      setCreating(false);
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar. Tente de novo.');
    }

    return undefined;
  };

  let slugHint = 'Letras minúsculas, números e hífen.';
  let slugTone = '';

  if (check && check.slug === slug) {
    slugTone = check.available ? 'ok' : 'bad';
    slugHint = check.available
      ? 'Endereço disponível.'
      : check.suggestion !== check.slug
        ? `Em uso. Que tal "${check.suggestion}"?`
        : 'Endereço indisponível.';
  }

  if (creating) {
    return (
      <div className="mk-account-narrow">
        <div className="mk-card mk-account-card mk-progress">
          <span className="mk-spinner" aria-hidden="true" />
          <ul aria-live="polite">
            {STEPS.map((label, index) => (
              <li key={label} className={index < step ? 'done' : index === step ? 'current' : ''}>
                {label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="mk-account-narrow">
      <form className="mk-card mk-account-card" onSubmit={submit} noValidate>
        <span className="mk-pill">Passo 2 de 2</span>
        <h1>{`Olá, ${data.account.name.split(' ')[0]}! Agora, o seu negócio`}</h1>
        <p className="mk-sub">Com isso o seu sistema entra no ar na hora. Dá para mudar o nome e os serviços depois.</p>

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
        <p className="mk-samples-line">
          {selected?.samples?.length ? `Começa com: ${selected.samples.join(', ')}.` : ''}
        </p>

        <label className="mk-field">
          <span>Nome do negócio</span>
          <input
            value={businessName}
            maxLength={60}
            autoFocus
            placeholder="Ex.: Studio do Zé"
            onChange={e => setBusinessName(e.target.value)}
          />
        </label>

        <label className="mk-field">
          <span>Endereço do seu site</span>
          <div className={`mk-slug ${slugTone}`}>
            <input
              value={slug}
              maxLength={30}
              placeholder="studio-do-ze"
              onChange={e => {
                setSlugEdited(true);
                setSlug(slugify(e.target.value));
              }}
            />
            <em>{`.${info.base_domain}`}</em>
          </div>
          <small className={slugTone}>{slugHint}</small>
        </label>

        <p className="mk-error" role="alert">
          {error}
        </p>
        <button type="submit" className="mk-btn mk-btn-primary">
          Criar meu sistema
        </button>
      </form>
    </div>
  );
}

function Dashboard({ info, data }: { info: PublicInfo; data: AccountData }) {
  const business = data.business as Business;
  let badge = { tone: 'ok', text: 'Ativo' };
  let notice = '';

  if (business.status === 'suspended') {
    badge = { tone: 'bad', text: business.trial ? 'Teste encerrado' : 'Suspenso' };
    notice = business.trial
      ? 'O período de teste acabou e o sistema está pausado. Seus dados continuam guardados: fale com a gente para continuar.'
      : 'O sistema está pausado. Fale com a gente para reativar.';
  } else if (business.trial) {
    const days = business.billing.days;

    badge = { tone: days <= 2 ? 'warn' : 'ok', text: days > 0 ? `Em teste · ${days} ${days === 1 ? 'dia' : 'dias'}` : 'Teste acabando' };
    notice = `Seu teste vai até ${lastDay(business.paid_until)}. Para continuar depois disso, fale com a gente.`;
  }

  const contact = info.support_whatsapp
    ? `https://wa.me/${info.support_whatsapp}?text=${encodeURIComponent(`Olá! Quero continuar com o Pontual (${business.name}).`)}`
    : null;

  return (
    <div className="mk-account-grid">
      <section className="mk-card mk-account-main">
        <div className="mk-account-title">
          <div>
            <span className="mk-label">Seu negócio</span>
            <h1>{business.name}</h1>
            <a href={business.url} target="_blank" rel="noreferrer" className="mk-url">
              {business.url.replace(/^https?:\/\//, '')}
            </a>
          </div>
          <span className={`mk-status ${badge.tone}`}>{badge.text}</span>
        </div>

        {notice && (
          <p className={`mk-notice ${business.status === 'suspended' ? 'bad' : ''}`}>
            {notice}
            {contact && (
              <>
                {' '}
                <a href={contact} target="_blank" rel="noreferrer">
                  Falar no WhatsApp
                </a>
              </>
            )}
          </p>
        )}

        <div className="mk-actions">
          <a className="mk-btn mk-btn-primary" href={business.login_url}>
            Entrar no meu sistema
          </a>
          <a className="mk-btn mk-btn-ghost" href={business.url} target="_blank" rel="noreferrer">
            Ver o site dos clientes
          </a>
        </div>
        <p className="mk-note">{`Entre com ${data.account.email} e a mesma senha desta conta.`}</p>

        <h2 className="mk-account-h2">Primeiros passos</h2>
        <ol className="mk-next">
          <li>Confira os serviços e os preços (vieram exemplos do seu ramo).</li>
          <li>Cadastre a equipe e os horários de trabalho em Equipe.</li>
          <li>Coloque sua logo, sua cor e a foto de capa em Configurações.</li>
          <li>Mande o link do seu site para os clientes e coloque na bio do Instagram.</li>
        </ol>
      </section>

      <aside className="mk-account-side">
        <section className="mk-card">
          <span className="mk-label">Plano</span>
          <p className="mk-side-price">
            {price(business.monthly_price_cents)}
            <small>/mês</small>
          </p>
          <p>{business.trial ? `Grátis durante o teste de ${info.trial_days} dias.` : `Pago até ${lastDay(business.paid_until)}.`}</p>
        </section>
        <section className="mk-card">
          <span className="mk-label">Sua conta</span>
          <p className="mk-strong">{data.account.name}</p>
          <p>{data.account.email}</p>
          <p>{formatPhone(data.account.phone)}</p>
        </section>
      </aside>
    </div>
  );
}

export default function Account({ info }: { info: PublicInfo }) {
  // undefined: carregando; null: sem sessão
  const [data, setData] = useState<AccountData | null | undefined>(undefined);

  const load = useCallback(() => {
    api<AccountData>('/account')
      .then(setData)
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const logout = async (): Promise<void> => {
    await api('/account/logout', { method: 'POST' }).catch(() => undefined);
    setData(null);
  };

  return (
    <div className="mk mk-account">
      <header className="mk-header">
        <div className="mk-wrap mk-header-row">
          <a href={homePath()} className="mk-brand">
            <span className="mk-mark">P</span>
            Pontual
          </a>
          <span className="mk-header-spacer" />
          {data && (
            <>
              <span className="mk-header-user">{data.account.email}</span>
              <button type="button" className="mk-btn mk-btn-ghost mk-btn-small" onClick={logout}>
                Sair
              </button>
            </>
          )}
        </div>
      </header>

      <main className="mk-wrap mk-account-body">
        {data === null && <Login info={info} />}
        {data && !data.business && <Onboarding info={info} data={data} onCreated={setData} />}
        {data && data.business && <Dashboard info={info} data={data} />}
      </main>
    </div>
  );
}
