import { FormEvent, useEffect, useState } from 'react';

import { api, TenantDetails } from '../api';

interface Props {
  tenant: TenantDetails;
  onClose(): void;
  onDeleted(): void;
}

// Excluir exige digitar o identificador; apagar os dados é uma escolha à parte
export default function DeleteModal({ tenant, onClose, onDeleted }: Props) {
  const [typed, setTyped] = useState('');
  const [purge, setPurge] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) onClose();
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, deleting]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setDeleting(true);
    setError('');

    try {
      await api(`/tenants/${tenant.id}${purge ? '?purge=1' : ''}`, { method: 'DELETE' });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir.');
      setDeleting(false);
    }
  };

  return (
    <div
      className="overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !deleting) onClose();
      }}
    >
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        onSubmit={submit}
        style={{ height: 'min(460px, 100%)', maxWidth: 500 }}
      >
        <header>
          <h2>Excluir barbearia</h2>
          <p>{`${tenant.name} (${tenant.domain})`}</p>
        </header>
        <div className="modal-body stack">
          <p>
            O sistema sai do ar e some do painel. Sem marcar a opção abaixo, os dados
            (banco e fotos) ficam guardados no servidor.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={purge} onChange={event => setPurge(event.target.checked)} />
            Apagar também todos os dados (não tem volta)
          </label>
          <label className="field">
            <span>{`Para confirmar, digite ${tenant.slug}`}</span>
            <input className="input" value={typed} onChange={event => setTyped(event.target.value)} />
          </label>
          <span className="error-text" role="alert">
            {error}
          </span>
        </div>
        <footer>
          <button type="button" className="btn secondary" onClick={onClose} disabled={deleting}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn danger"
            disabled={deleting || typed !== tenant.slug}
          >
            {deleting ? 'Excluindo...' : 'Excluir'}
          </button>
        </footer>
      </form>
    </div>
  );
}
