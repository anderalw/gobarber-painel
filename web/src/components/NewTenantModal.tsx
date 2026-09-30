import { FormEvent, useEffect, useState } from 'react';

import { api, Me, TenantView } from '../api';
import { parseMoney, TIMEZONES } from '../format';

// Mesma regra do servidor: "Barbearia do Zé" -> "barbearia-do-ze"
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

interface Props {
  me: Me;
  onClose(): void;
  onCreated(): void;
  onOpen(id: string): void;
}

interface Created {
  tenant: TenantView;
  admin_password: string;
}

// Nova barbearia: cadastro e, ao salvar, o acesso inicial para entregar ao
// cliente (o ambiente sobe em segundo plano)
export default function NewTenantModal({ me, onClose, onCreated, onOpen }: Props) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [domain, setDomain] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [price, setPrice] = useState('99,90');
  const [trial, setTrial] = useState('7');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const finalSlug = slugTouched ? slug : slugify(name);
  const suggestedDomain = finalSlug ? `${finalSlug}.${me.base_domain}` : '';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    const cents = parseMoney(price);

    if (cents === null) {
      setError('Mensalidade inválida. Ex.: 99,90');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const result = await api<Created>('/tenants', {
        method: 'POST',
        body: {
          name,
          slug: finalSlug,
          domain: domain.trim() || undefined,
          admin_name: adminName,
          admin_email: adminEmail,
          timezone,
          monthly_price_cents: cents,
          trial_days: Number(trial || 0),
        },
      });

      setCreated(result);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" style={{ height: 'min(640px, 100%)' }}>
        <header>
          <h2>{created ? 'Barbearia criada' : 'Nova barbearia'}</h2>
          <p>
            {created
              ? 'O ambiente está sendo preparado. Entregue o acesso abaixo ao cliente.'
              : 'Ao salvar, o painel cria o sistema dela com banco e endereço próprios.'}
          </p>
        </header>

        {created ? (
          <>
            <div className="modal-body stack">
              <dl className="lines">
                <dt>Endereço</dt>
                <dd>
                  <a href={created.tenant.url} target="_blank" rel="noreferrer">
                    {created.tenant.url}
                  </a>
                </dd>
                <dt>Entrar em</dt>
                <dd>{`${created.tenant.url}/barbeiro`}</dd>
                <dt>E-mail</dt>
                <dd>{created.tenant.admin_email}</dd>
              </dl>
              <div className="field">
                <span>Senha inicial do administrador</span>
                <div className="secret">
                  <code>{created.admin_password}</code>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => navigator.clipboard?.writeText(created.admin_password)}
                  >
                    Copiar
                  </button>
                </div>
                <small>
                  Peça para o cliente trocar no primeiro acesso (Meu perfil). Ela também fica
                  na página da barbearia.
                </small>
              </div>
              <p className="notice">
                A primeira subida baixa as imagens e prepara o banco: pode levar alguns
                minutos. Acompanhe na página da barbearia.
              </p>
            </div>
            <footer>
              <button type="button" className="btn secondary" onClick={onClose}>
                Fechar
              </button>
              <button type="button" className="btn" onClick={() => onOpen(created.tenant.id)}>
                Acompanhar
              </button>
            </footer>
          </>
        ) : (
          <form onSubmit={submit} style={{ display: 'contents' }}>
            <div className="modal-body stack">
              <label className="field">
                <span>Nome da barbearia</span>
                <input
                  className="input"
                  autoFocus
                  value={name}
                  maxLength={80}
                  placeholder="Ex.: Barbearia do Zé"
                  onChange={event => setName(event.target.value)}
                />
              </label>

              <div className="row">
                <label className="field">
                  <span>Identificador</span>
                  <input
                    className="input"
                    value={finalSlug}
                    maxLength={30}
                    onChange={event => {
                      setSlugTouched(true);
                      setSlug(slugify(event.target.value) || event.target.value.toLowerCase());
                    }}
                  />
                </label>
                <label className="field">
                  <span>Endereço</span>
                  <input
                    className="input"
                    value={domain}
                    placeholder={suggestedDomain || 'barbearia.seudominio.com.br'}
                    onChange={event => setDomain(event.target.value)}
                  />
                </label>
              </div>

              <div className="row">
                <label className="field">
                  <span>Administrador (nome)</span>
                  <input
                    className="input"
                    value={adminName}
                    maxLength={80}
                    onChange={event => setAdminName(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>E-mail do administrador</span>
                  <input
                    className="input"
                    type="email"
                    value={adminEmail}
                    onChange={event => setAdminEmail(event.target.value)}
                  />
                </label>
              </div>

              <label className="field">
                <span>Fuso horário</span>
                <select
                  className="input"
                  value={timezone}
                  onChange={event => setTimezone(event.target.value)}
                >
                  {TIMEZONES.map(zone => (
                    <option key={zone.value} value={zone.value}>
                      {zone.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="row">
                <label className="field">
                  <span>Mensalidade (R$)</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={price}
                    onChange={event => setPrice(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Dias grátis</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={90}
                    value={trial}
                    onChange={event => setTrial(event.target.value)}
                  />
                </label>
              </div>

              <span className="error-text" role="alert">
                {error}
              </span>
            </div>
            <footer>
              <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? 'Criando...' : 'Criar barbearia'}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
