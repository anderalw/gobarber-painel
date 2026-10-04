import { FormEvent, useEffect, useState } from 'react';

import { api, Me, TenantView } from '../api';
import { parseMoney } from '../format';

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
  // Vazio na importação (os logins são os do backup)
  admin_password: string;
}

// Envia o backup cru; o painel repassa para a API, que cria a barbearia
async function upload(file: File, query: Record<string, string>): Promise<TenantView> {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, value]) => value !== ''),
  );
  const response = await fetch(`/api/tenants/import?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(data.message || 'Não foi possível importar o backup.');

  return data as TenantView;
}

// Nova barbearia: cadastro e, ao salvar, o acesso inicial para entregar ao
// cliente (ela já nasce no ar)
export default function NewTenantModal({ me, onClose, onCreated, onOpen }: Props) {
  // Começar vazia ou a partir de um backup (uma barbearia que já existe)
  const [mode, setMode] = useState<'new' | 'import'>('new');
  // Ramo do negócio (define os termos e os padrões); não muda depois
  const [segments, setSegments] = useState<
    Array<{ key: string; name: string; samples?: string[] }>
  >([]);
  const [segment, setSegment] = useState('barbershop');
  // Serviços de exemplo do ramo escolhido
  const samples = segments.find(item => item.key === segment)?.samples || [];
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [domain, setDomain] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [price, setPrice] = useState('99,90');
  const [trial, setTrial] = useState('7');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const finalSlug = slugTouched ? slug : slugify(name);

  // No backup, o ramo vem dele (a não ser que escolha outro)
  useEffect(() => {
    setSegment(mode === 'import' ? 'backup' : 'barbershop');
  }, [mode]);

  useEffect(() => {
    api<Array<{ key: string; name: string; samples?: string[] }>>('/segments')
      .then(setSegments)
      .catch(() => setSegments([{ key: 'barbershop', name: 'Barbearia' }]));
  }, []);

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

    if (mode === 'import' && !file) {
      setError('Escolha o arquivo do backup (.tar.gz).');
      return;
    }

    setSaving(true);
    setError('');

    try {
      if (mode === 'import' && file) {
        const tenant = await upload(file, {
          name: name.trim(),
          slug: finalSlug,
          segment: segment === 'backup' ? '' : segment,
          monthly_price_cents: String(cents),
          trial_days: String(Number(trial || 0)),
        });

        setCreated({ tenant, admin_password: '' });
      } else {
        setCreated(
          await api<Created>('/tenants', {
            method: 'POST',
            body: {
              name,
              slug: finalSlug,
              custom_domain: domain.trim() || null,
              segment,
              admin_name: adminName,
              admin_email: adminEmail,
              monthly_price_cents: cents,
              trial_days: Number(trial || 0),
            },
          }),
        );
      }

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
      <div className="modal" role="dialog" aria-modal="true" style={{ height: 'min(740px, 100%)' }}>
        <header>
          <h2>{created ? 'Negócio criado' : 'Novo negócio'}</h2>
          <p>
            {created
              ? 'Já está no ar. Entregue o acesso abaixo ao cliente.'
              : 'Ele entra na instalação do Pontual com os próprios dados e endereço.'}
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
                <dd>{`${created.tenant.url}/equipe`}</dd>
                <dt>Administrador</dt>
                <dd>{created.tenant.admin_email || '–'}</dd>
              </dl>
              {created.admin_password ? (
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
                    na página do negócio.
                  </small>
                </div>
              ) : (
                <p className="notice">
                  Importado de um backup: agenda, clientes, assinaturas e configurações vêm junto, e
                  todos entram com os mesmos logins e senhas de antes.
                </p>
              )}
            </div>
            <footer>
              <button type="button" className="btn secondary" onClick={onClose}>
                Fechar
              </button>
              <button type="button" className="btn" onClick={() => onOpen(created.tenant.id)}>
                Abrir negócio
              </button>
            </footer>
          </>
        ) : (
          <form onSubmit={submit} style={{ display: 'contents' }}>
            <div className="modal-body stack">
              <div className="segmented" role="radiogroup" aria-label="Como começar">
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === 'new'}
                  className={mode === 'new' ? 'selected' : undefined}
                  onClick={() => setMode('new')}
                >
                  Começar do zero
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === 'import'}
                  className={mode === 'import' ? 'selected' : undefined}
                  onClick={() => setMode('import')}
                >
                  Importar de um backup
                </button>
              </div>

              <div className="row">
                <label className="field">
                  <span>Ramo do negócio</span>
                  <select
                    className="input"
                    value={segment}
                    onChange={event => setSegment(event.target.value)}
                  >
                    {mode === 'import' && <option value="backup">O do backup</option>}
                    {segments.map(item => (
                      <option key={item.key} value={item.key}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <small>
                    Define os termos e os padrões. Não muda depois.
                    {mode === 'new' &&
                      samples.length > 0 &&
                      ` Começa com: ${samples.join(', ')} (dá para mudar).`}
                  </small>
                </label>
                <label className="field">
                  <span>{mode === 'import' ? 'Nome (vazio = o do backup)' : 'Nome do negócio'}</span>
                  <input
                    className="input"
                    autoFocus
                    value={name}
                    maxLength={80}
                    placeholder="Ex.: Studio do Zé"
                    onChange={event => setName(event.target.value)}
                  />
                </label>
              </div>

              <div className="row">
                <label className="field">
                  <span>Identificador</span>
                  <input
                    className="input"
                    value={finalSlug}
                    maxLength={30}
                    placeholder={mode === 'import' ? 'o do backup' : undefined}
                    onChange={event => {
                      setSlugTouched(true);
                      setSlug(slugify(event.target.value) || event.target.value.toLowerCase());
                    }}
                  />
                  <small>{`${finalSlug || '...'}.${me.base_domain}`}</small>
                </label>
                {mode === 'new' ? (
                  <label className="field">
                    <span>Domínio próprio (opcional)</span>
                    <input
                      className="input"
                      value={domain}
                      placeholder="studiodoze.com.br"
                      onChange={event => setDomain(event.target.value)}
                    />
                    <small>Dá para configurar depois.</small>
                  </label>
                ) : (
                  <span />
                )}
              </div>

              {mode === 'import' ? (
                <label className="field">
                  <span>Backup (.tar.gz)</span>
                  <input
                    className="input file"
                    type="file"
                    accept=".tar.gz,.tgz,application/gzip"
                    onChange={event => setFile(event.target.files?.[0] || null)}
                  />
                  <small>
                    O botão Gerar backup deste painel, ou o scripts/exportar-backup.mjs de uma
                    instalação antiga. Os logins continuam os do backup.
                  </small>
                </label>
              ) : (
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
              )}

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
                {saving
                  ? mode === 'import'
                    ? 'Importando...'
                    : 'Criando...'
                  : mode === 'import'
                    ? 'Importar negócio'
                    : 'Criar negócio'}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
