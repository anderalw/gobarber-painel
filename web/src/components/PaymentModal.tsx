import { FormEvent, useEffect, useState } from 'react';

import { api, TenantDetails } from '../api';
import { METHODS, lastPaidDay, money, parseMoney } from '../format';

interface Props {
  tenant: TenantDetails;
  onClose(): void;
  onSaved(details: TenantDetails): void;
}

// Registrar a mensalidade que a barbearia pagou
export default function PaymentModal({ tenant, onClose, onSaved }: Props) {
  const [method, setMethod] = useState('pix');
  const [amount, setAmount] = useState(
    (tenant.monthly_price_cents / 100).toFixed(2).replace('.', ','),
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    const cents = parseMoney(amount);

    if (cents === null) {
      setError('Valor inválido. Ex.: 99,90');
      return;
    }

    setSaving(true);

    try {
      onSaved(
        await api<TenantDetails>(`/tenants/${tenant.id}/payments`, {
          method: 'POST',
          body: { method, amount_cents: cents, note },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
      setSaving(false);
    }
  };

  const late = tenant.billing.state === 'late';

  return (
    <div
      className="overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        onSubmit={submit}
        style={{ height: 'min(470px, 100%)', maxWidth: 480 }}
      >
        <header>
          <h2>Registrar mensalidade</h2>
          <p>{`${tenant.name} · ${money(tenant.monthly_price_cents)}/mês`}</p>
        </header>
        <div className="modal-body stack">
          <div className="row">
            <label className="field">
              <span>Forma</span>
              <select
                className="input"
                value={method}
                onChange={event => setMethod(event.target.value)}
              >
                {Object.entries(METHODS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Valor (R$)</span>
              <input
                className="input"
                inputMode="decimal"
                value={amount}
                onChange={event => setAmount(event.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>Observação (opcional)</span>
            <input
              className="input"
              value={note}
              maxLength={200}
              placeholder="Ex.: comprovante enviado no WhatsApp"
              onChange={event => setNote(event.target.value)}
            />
          </label>
          <p className="notice">
            {late
              ? 'Estava atrasada: o novo mês conta a partir de hoje.'
              : `Emenda no mês pago até ${lastPaidDay(tenant.paid_until)}.`}
          </p>
          <span className="error-text" role="alert">
            {error}
          </span>
        </div>
        <footer>
          <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Salvando...' : 'Registrar'}
          </button>
        </footer>
      </form>
    </div>
  );
}
