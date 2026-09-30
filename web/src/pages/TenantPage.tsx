import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
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
  situation,
} from '../format';
import PaymentModal from '../components/PaymentModal';
import DeleteModal from '../components/DeleteModal';

type Action = 'suspend' | 'resume' | 'upgrade' | 'retry';

const CONFIRM: Partial<Record<Action, string>> = {
  suspend: 'Suspender? O sistema da barbearia sai do ar (os dados ficam guardados).',
  upgrade: 'Atualizar para a versão mais nova do GoBarber? Leva cerca de um minuto.',
};

export default function TenantPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<TenantDetails | null>(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'payment' | 'delete' | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Edição dos dados
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const receive = useCallback((data: TenantDetails) => {
    setTenant(current => {
      // Só preenche o formulário na primeira carga (não apaga o que digitou)
      if (!current || current.id !== data.id) {
        setName(data.name);
        setPrice((data.monthly_price_cents / 100).toFixed(2).replace('.', ','));
        setNotes(data.notes || '');
      }

      return data;
    });
  }, []);

  const load = useCallback(() => {
    api<TenantDetails>(`/tenants/${id}`)
      .then(receive)
      .catch(err => setError(err.message));
  }, [id, receive]);

  const busy = !!tenant && (tenant.busy || tenant.status === 'provisioning');

  useEffect(() => {
    load();

    const timer = window.setInterval(load, busy ? 2500 : 20000);

    return () => window.clearInterval(timer);
  }, [load, busy]);

  // O log acompanha o fim
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [tenant?.last_log]);

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
          ← Barbearias
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
        ← Barbearias
      </Link>

      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {tenant.name}
            <span className={`badge ${state.tone} ${tenant.busy ? 'busy' : ''}`}>
              {state.label}
            </span>
          </h1>
          <p>
            <a href={tenant.url} target="_blank" rel="noreferrer">
              {tenant.url}
            </a>
            {` · desde ${day(tenant.created_at)}`}
          </p>
        </div>
        <div>
          {tenant.status === 'error' && (
            <button type="button" className="btn" disabled={busy} onClick={() => act('retry')}>
              Tentar de novo
            </button>
          )}
          {tenant.status === 'active' && (
            <>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => act('upgrade')}
              >
                Atualizar versão
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => act('suspend')}
              >
                Suspender
              </button>
            </>
          )}
          {tenant.status === 'suspended' && (
            <button type="button" className="btn" disabled={busy} onClick={() => act('resume')}>
              Reativar
            </button>
          )}
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={() => setModal('delete')}
          >
            Excluir
          </button>
        </div>
      </div>

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
              disabled={refreshing || tenant.status !== 'active'}
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
                <dt>Barbeiros</dt>
                <dd>{metrics ? metrics.providers : '–'}</dd>
              </div>
              <div>
                <dt>Clientes</dt>
                <dd>{metrics ? metrics.clients : '–'}</dd>
              </div>
              <div>
                <dt>Assinantes do clube</dt>
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
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => act('suspend')}
                >
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
              <dd>{`${tenant.url}/barbeiro`}</dd>
              <dt>Administrador</dt>
              <dd>{`${tenant.admin_name} · ${tenant.admin_email}`}</dd>
              <dt>Fuso</dt>
              <dd>{tenant.timezone}</dd>
            </dl>
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
              Senha criada com a barbearia. Se o cliente já trocou, ela não vale mais.
            </small>
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

      <div className="grid-2">
        <section className="card">
          <header>
            <div>
              <h2>Ambiente</h2>
              <p>{`Projeto gb-${tenant.slug} no Docker`}</p>
            </div>
          </header>
          <table>
            <tbody>
              {tenant.containers.length === 0 && (
                <tr>
                  <td className="muted">Nenhum contêiner (ainda não criado ou excluído).</td>
                </tr>
              )}
              {tenant.containers.map(container => (
                <tr key={container.service}>
                  <td>{container.service}</td>
                  <td className="num">
                    <span
                      className={`badge ${container.state === 'running' ? 'success' : 'danger'}`}
                    >
                      {container.state === 'running' ? 'rodando' : container.state}
                      {container.health === 'healthy' && ' · saudável'}
                      {container.health === 'unhealthy' && ' · com problema'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <header>
            <div>
              <h2>Última operação</h2>
              <p>{tenant.last_operation || 'Nenhuma'}</p>
            </div>
          </header>
          <div className="card-body">
            <pre className="log" ref={logRef}>
              {tenant.last_log || 'Sem registro.'}
            </pre>
          </div>
        </section>
      </div>

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
