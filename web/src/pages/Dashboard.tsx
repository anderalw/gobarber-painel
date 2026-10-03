import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, Me, Overview } from '../api';
import { billingLabel, lastPaidDay, money, situation } from '../format';
import NewTenantModal from '../components/NewTenantModal';

export default function Dashboard({ me }: { me: Me }) {
  const navigate = useNavigate();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api<Overview>('/overview')
      .then(result => {
        setData(result);
        setError('');
      })
      .catch(err => setError(err.message));
  }, []);

  useEffect(() => {
    load();

    const timer = window.setInterval(load, 30000);

    return () => window.clearInterval(timer);
  }, [load]);

  const summary = data?.summary;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Barbearias</h1>
          <p>Todas na mesma instalação, cada uma com os próprios dados e endereço.</p>
        </div>
        <div>
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            + Nova barbearia
          </button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span>Barbearias</span>
          <strong>{summary ? summary.total : '–'}</strong>
        </div>
        <div className="kpi">
          <span>No ar</span>
          <strong>{summary ? summary.active : '–'}</strong>
        </div>
        <div className="kpi">
          <span>Receita mensal</span>
          <strong>{summary ? money(summary.monthly_cents) : '–'}</strong>
        </div>
        <div className={`kpi ${summary && summary.late > 0 ? 'warning' : ''}`}>
          <span>Mensalidade atrasada</span>
          <strong>{summary ? summary.late : '–'}</strong>
        </div>
        <div className="kpi">
          <span>Suspensas</span>
          <strong>{summary ? summary.suspended : '–'}</strong>
        </div>
      </div>

      {error && (
        <p className="notice" style={{ marginBottom: 16, color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <div className="card">
        {data && data.tenants.length === 0 ? (
          <div className="empty">
            Nenhuma barbearia ainda. Crie a primeira em &quot;Nova barbearia&quot;.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Barbearia</th>
                <th>Sistema</th>
                <th>Mensalidade</th>
                <th className="num">Agendamentos (30 dias)</th>
                <th className="num">Clientes</th>
              </tr>
            </thead>
            <tbody>
              {(data?.tenants || []).map(tenant => {
                const state = situation(tenant);
                const bill = billingLabel(tenant);

                return (
                  <tr
                    key={tenant.id}
                    className="clickable"
                    onClick={() => navigate(`/barbearias/${tenant.id}`)}
                  >
                    <td>
                      <strong>{tenant.name}</strong>
                      <small>{tenant.domain}</small>
                    </td>
                    <td>
                      <span className={`badge ${state.tone}`}>
                        {state.label}
                      </span>
                    </td>
                    <td>
                      {money(tenant.monthly_price_cents)}
                      <small>
                        <span style={{ color: `var(--${bill.tone === 'neutral' ? 'muted' : bill.tone})` }}>
                          {bill.label}
                        </span>
                        {` · pago até ${lastPaidDay(tenant.paid_until)}`}
                      </small>
                    </td>
                    <td className="num">
                      {tenant.metrics ? tenant.metrics.last_30_days.appointments : '–'}
                    </td>
                    <td className="num">{tenant.metrics ? tenant.metrics.clients : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <NewTenantModal
          me={me}
          onClose={() => setCreating(false)}
          onCreated={() => load()}
          onOpen={id => navigate(`/barbearias/${id}`)}
        />
      )}
    </div>
  );
}
