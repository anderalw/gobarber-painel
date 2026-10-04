import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api, TenantDetails } from '../api';
import {
  METHODS,
  ago,
  billingLabel,
  day,
  lastPaidDay,
  money,
  parseMoney,
  segmentName,
  situation,
} from '../format';
import PaymentModal from '../components/PaymentModal';
import DeleteModal from '../components/DeleteModal';

type Action = 'suspend' | 'resume';

interface Backup {
  name: string;
  size_bytes: number;
  created_at: string;
}

const size = (bytes: number): string =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const CONFIRM: Partial<Record<Action, string>> = {
  suspend: 'Suspender? O sistema do negócio sai do ar (os dados ficam guardados).',
};

export default function TenantPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<TenantDetails | null>(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'payment' | 'delete' | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [backups, setBackups] = useState<Backup[]>([]);
  // Edição dos dados
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  // Domínio próprio
  const [domain, setDomain] = useState('');
  const [savingDomain, setSavingDomain] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const receive = useCallback((data: TenantDetails) => {
    setTenant(current => {
      // Só preenche o formulário na primeira carga (não apaga o que digitou)
      if (!current || current.id !== data.id) {
        setName(data.name);
        setPrice((data.monthly_price_cents / 100).toFixed(2).replace('.', ','));
        setNotes(data.notes || '');
        setDomain(data.custom_domain || '');
      }

      return data;
    });
  }, []);

  const load = useCallback(() => {
    api<TenantDetails>(`/tenants/${id}`)
      .then(receive)
      .catch(err => setError(err.message));
    api<Backup[]>(`/tenants/${id}/backups`)
      .then(setBackups)
      .catch(() => undefined);
  }, [id, receive]);

  useEffect(() => {
    load();

    const timer = window.setInterval(load, 20000);

    return () => window.clearInterval(timer);
  }, [load]);

  const legacy = tenant?.status === 'legacy';

  const act = async (action: Action) => {
    // eslint-disable-next-line no-alert
    if (CONFIRM[action] && !window.confirm(CONFIRM[action])) return;

    try {
      receive(await api<TenantDetails>(`/tenants/${id}/${action}`, { method: 'POST' }));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível.');
    }
  };

  const saveDomain = async (value: string) => {
    setSavingDomain(true);

    try {
      const data = await api<TenantDetails>(`/tenants/${id}/domain`, {
        method: 'PUT',
        body: { custom_domain: value.trim() || null },
      });

      setTenant(data);
      setDomain(data.custom_domain || '');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o domínio.');
    } finally {
      setSavingDomain(false);
    }
  };

  const backup = async () => {
    setBackingUp(true);

    try {
      await api(`/tenants/${id}/backup`, { method: 'POST' });
      setBackups(await api<Backup[]>(`/tenants/${id}/backups`));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gerar o backup.');
    } finally {
      setBackingUp(false);
    }
  };

  const refreshMetrics = async () => {
    setRefreshing(true);

    try {
      receive(await api<TenantDetails>(`/tenants/${id}/metrics`, { method: 'POST' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível.');
    } finally {
      setRefreshing(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();

    const cents = parseMoney(price);

    if (cents === null) {
      setError('Mensalidade inválida. Ex.: 99,90');
      return;
    }

    setSaving(true);

    try {
      const data = await api<TenantDetails>(`/tenants/${id}`, {
        method: 'PUT',
        body: { name, monthly_price_cents: cents, notes },
      });

      setTenant(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  if (!tenant) {
    return (
      <div className="page">
        <Link to="/" className="back">
          ← Negócios
        </Link>
        <p className="muted">{error || 'Carregando...'}</p>
      </div>
    );
  }

  const state = situation(tenant);
  const bill = billingLabel(tenant);
  const metrics = tenant.metrics;

  return (
    <div className="page">
      <Link to="/" className="back">
        ← Negócios
      </Link>

      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {tenant.name}
            <span className={`badge ${state.tone}`}>
              {state.label}
            </span>
          </h1>
          <p>
            <a href={tenant.url} target="_blank" rel="noreferrer">
              {tenant.url}
            </a>
            {` · ${segmentName(tenant.segment)} · desde ${day(tenant.created_at)}`}
          </p>
        </div>
        <div>
          {tenant.status === 'active' && (
            <button type="button" className="btn secondary" onClick={() => act('suspend')}>
              Suspender
            </button>
          )}
          {tenant.status === 'suspended' && (
            <button type="button" className="btn" onClick={() => act('resume')}>
              Reativar
            </button>
          )}
          <button type="button" className="btn danger" onClick={() => setModal('delete')}>
            Excluir
          </button>
        </div>
      </div>

      {legacy && (
        <p className="notice" style={{ marginBottom: 12 }}>
          Este negócio é do modelo antigo, com contêineres próprios, e ainda não está na
          instalação compartilhada. Gere o backup dela (scripts/exportar-backup.mjs) e use
          Novo negócio → Importar de um backup com o mesmo identificador.
        </p>
      )}

      {/* Espaço reservado para mensagens de erro */}
      <span className="error-text" role="alert" style={{ marginBottom: 12 }}>
        {error}
      </span>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <section className="card">
          <header>
            <div>
              <h2>Uso nos últimos 30 dias</h2>
              <p>
                {tenant.metrics_at ? `Atualizado ${ago(tenant.metrics_at)}` : 'Ainda sem leitura'}
              </p>
            </div>
            <button
              type="button"
              className="btn ghost small"
              disabled={refreshing || legacy}
              onClick={refreshMetrics}
            >
              {refreshing ? 'Lendo...' : 'Atualizar'}
            </button>
          </header>
          <div className="card-body">
            <dl className="facts">
              <div>
                <dt>Agendamentos</dt>
                <dd>{metrics ? metrics.last_30_days.appointments : '–'}</dd>
              </div>
              <div>
                <dt>Atendidos</dt>
                <dd>{metrics ? metrics.last_30_days.completed : '–'}</dd>
              </div>
              <div>
                <dt>Faturamento</dt>
                <dd>{metrics ? money(metrics.last_30_days.revenue_cents) : '–'}</dd>
              </div>
              <div>
                <dt>Profissionais</dt>
                <dd>{metrics ? metrics.providers : '–'}</dd>
              </div>
              <div>
                <dt>Clientes</dt>
                <dd>{metrics ? metrics.clients : '–'}</dd>
              </div>
              <div>
                <dt>Assinantes</dt>
                <dd>{metrics ? metrics.active_members : '–'}</dd>
              </div>
            </dl>
            <p className="muted" style={{ marginTop: 14 }}>
              {metrics?.last_activity
                ? `Último agendamento criado ${ago(metrics.last_activity)} · ${metrics.upcoming_appointments} marcados daqui para frente`
                : 'Nenhum agendamento ainda.'}
            </p>
          </div>
        </section>

        <section className="card">
          <header>
            <div>
              <h2>Mensalidade</h2>
              <p>{`${money(tenant.monthly_price_cents)}/mês`}</p>
            </div>
            <span className={`badge ${bill.tone}`}>{bill.label}</span>
          </header>
          <div className="card-body stack">
            <dl className="lines">
              <dt>Pago até</dt>
              <dd>{lastPaidDay(tenant.paid_until)}</dd>
              <dt>Último pagamento</dt>
              <dd>
                {tenant.payments[0]
                  ? `${money(tenant.payments[0].amount_cents)} · ${
                      METHODS[tenant.payments[0].method] || tenant.payments[0].method
                    } · ${day(tenant.payments[0].paid_at)}`
                  : 'Nenhum (período grátis)'}
              </dd>
            </dl>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setModal('payment')}>
                Registrar pagamento
              </button>
              {tenant.billing.state === 'late' && tenant.status === 'active' && (
                <button type="button" className="btn secondary" onClick={() => act('suspend')}>
                  Suspender por atraso
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <section className="card">
          <header>
            <h2>Acesso do cliente</h2>
          </header>
          <div className="card-body stack">
            <dl className="lines">
              <dt>Entrar em</dt>
              <dd>{`${tenant.url}/equipe`}</dd>
              <dt>Administrador</dt>
              <dd>
                {tenant.admin_email ? `${tenant.admin_name} · ${tenant.admin_email}` : '–'}
              </dd>
              {tenant.admin_phone && (
                <>
                  <dt>WhatsApp</dt>
                  <dd>
                    <a href={`https://wa.me/55${tenant.admin_phone.replace(/^55/, '')}`} target="_blank" rel="noreferrer">
                      {tenant.admin_phone}
                    </a>
                  </dd>
                </>
              )}
            </dl>
            {!tenant.has_initial_password ? (
              <p className="notice">
                {tenant.origin === 'import' &&
                  'Importado de um backup: todos entram com os mesmos logins e senhas de antes.'}
                {tenant.origin === 'signup' &&
                  'Cadastrado pela página de divulgação (teste grátis): entra com a senha que escolheu no cadastro.'}
                {tenant.origin !== 'import' &&
                  tenant.origin !== 'signup' &&
                  'Já existia na instalação: os logins são os que o negócio já usava.'}
              </p>
            ) : (
            <>
            <div className="secret">
              <code>{password ?? '••••••••••••'}</code>
              <button
                type="button"
                className="btn ghost small"
                onClick={async () => {
                  if (password) {
                    setPassword(null);
                    return;
                  }

                  const result = await api<{ password: string }>(
                    `/tenants/${id}/initial-password`,
                  );

                  setPassword(result.password || '(não encontrada)');
                }}
              >
                {password ? 'Esconder' : 'Ver senha inicial'}
              </button>
            </div>
            <small className="muted">
              Senha criada com o negócio. Se o cliente já trocou, ela não vale mais.
            </small>
            </>
            )}
          </div>
        </section>

        <section className="card">
          <header>
            <h2>Dados</h2>
          </header>
          <form className="card-body stack" onSubmit={save}>
            <div className="row">
              <label className="field">
                <span>Nome</span>
                <input className="input" value={name} onChange={event => setName(event.target.value)} />
              </label>
              <label className="field">
                <span>Mensalidade (R$)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={price}
                  onChange={event => setPrice(event.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span>Anotações</span>
              <textarea
                className="input"
                value={notes}
                maxLength={1000}
                placeholder="Contato, combinados, forma de cobrança..."
                onChange={event => setNotes(event.target.value)}
              />
            </label>
            <div>
              <button type="submit" className="btn secondary" disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar dados'}
              </button>
            </div>
          </form>
        </section>
      </div>

      <section className="card">
        <header>
          <div>
            <h2>Endereço</h2>
            <p>{`Sempre disponível em ${tenant.subdomain}`}</p>
          </div>
        </header>
        <div className="card-body stack">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field">
              <span>Domínio próprio</span>
              <input
                className="input"
                value={domain}
                placeholder="studiodoze.com.br"
                disabled={legacy}
                onChange={event => setDomain(event.target.value)}
              />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn secondary"
                disabled={legacy || savingDomain || domain.trim() === (tenant.custom_domain || '')}
                onClick={() => saveDomain(domain)}
              >
                {savingDomain ? 'Salvando...' : 'Salvar domínio'}
              </button>
              {tenant.custom_domain && (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={savingDomain}
                  onClick={() => saveDomain('')}
                >
                  Remover
                </button>
              )}
            </div>
          </div>
          <small className="muted">
            No DNS do domínio, crie um CNAME (ou um registro A) apontando para o servidor do
            Pontual. O certificado HTTPS sai sozinho no primeiro acesso.
          </small>
        </div>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <header>
          <div>
            <h2>Backups</h2>
            <p>Os dados do negócio, as fotos e o segredo das integrações. Guarde com cuidado.</p>
          </div>
          <button
            type="button"
            className="btn secondary small"
            disabled={legacy || backingUp}
            onClick={backup}
          >
            {backingUp ? 'Gerando...' : 'Gerar backup'}
          </button>
        </header>
        {backups.length === 0 ? (
          <p className="empty" style={{ padding: 24 }}>
            Nenhum backup ainda. Serve para restaurar o negócio ou mudar de servidor
            (Novo negócio → Importar de um backup).
          </p>
        ) : (
          <table>
            <tbody>
              {backups.map(backup => (
                <tr key={backup.name}>
                  <td>
                    {backup.name}
                    <small>{ago(backup.created_at)}</small>
                  </td>
                  <td className="num">{size(backup.size_bytes)}</td>
                  <td className="num">
                    <a href={`/api/tenants/${id}/backups/${backup.name}`} download>
                      Baixar
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {tenant.payments.length > 0 && (
        <section className="card" style={{ marginTop: 20 }}>
          <header>
            <h2>Pagamentos</h2>
          </header>
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Forma</th>
                <th>Período</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {tenant.payments.map(payment => (
                <tr key={payment.id}>
                  <td>
                    {day(payment.paid_at)}
                    {payment.note && <small>{payment.note}</small>}
                  </td>
                  <td>{METHODS[payment.method] || payment.method}</td>
                  <td>{`${day(payment.period_start)} a ${lastPaidDay(payment.period_end)}`}</td>
                  <td className="num">{money(payment.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {modal === 'payment' && (
        <PaymentModal
          tenant={tenant}
          onClose={() => setModal(null)}
          onSaved={data => {
            setModal(null);
            setTenant(data);
          }}
        />
      )}
      {modal === 'delete' && (
        <DeleteModal
          tenant={tenant}
          onClose={() => setModal(null)}
          onDeleted={() => navigate('/')}
        />
      )}
    </div>
  );
}
