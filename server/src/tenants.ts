import fs from 'fs';
import path from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { config } from './config';
import { db, Payment, Tenant } from './db';
import { billingState, nextPeriod, toDay, trialUntil } from './billing';
import { slugify } from './text';
import { ApiTenant, pontual, PontualError } from './pontual';

export { slugify };

// As barbearias vivem na API do Pontual (uma instalação para todas). O
// painel cuida da cobrança, das anotações, do uso e dos backups

export class PanelError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// Erro da API vira mensagem da tela, com o mesmo código
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof PontualError) throw new PanelError(err.message, err.status);
    throw err;
  }
}

// Senha inicial: legível (sem caracteres confusos) e forte
function readablePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);

  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

// Endereço público do site da barbearia
export function publicUrl(host: string): string {
  return config.siteUrl.replace('{host}', host).replace(/\/+$/, '');
}

// --- Consultas -------------------------------------------------------------

export function findTenant(id: string): Tenant {
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as
    | Tenant
    | undefined;

  if (!tenant) throw new PanelError('Barbearia não encontrada.', 404);

  return tenant;
}

export function listTenants(): Tenant[] {
  return db
    .prepare('SELECT * FROM tenants ORDER BY name COLLATE NOCASE')
    .all() as unknown as Tenant[];
}

export function paymentsOf(tenantId: string): Payment[] {
  return db
    .prepare('SELECT * FROM payments WHERE tenant_id = ? ORDER BY paid_at DESC')
    .all(tenantId) as unknown as Payment[];
}

function update(id: string, values: Partial<Tenant>): void {
  const keys = Object.keys(values);

  db.prepare(
    `UPDATE tenants SET ${keys.map(key => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
  ).run(
    ...keys.map(key => values[key as keyof Tenant] as string | number | null),
    new Date().toISOString(),
    id,
  );
}

function linked(tenant: Tenant): string {
  if (!tenant.api_id) {
    throw new PanelError(
      'Barbearia do modelo antigo (contêineres separados): importe o backup dela para usar.',
    );
  }

  return tenant.api_id;
}

// --- Como a tela vê cada barbearia -----------------------------------------

export function view(tenant: Tenant) {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    domain: tenant.domain,
    custom_domain: tenant.custom_domain,
    subdomain: `${tenant.slug}.${config.baseDomain}`,
    url: publicUrl(tenant.domain),
    admin_name: tenant.admin_name,
    admin_email: tenant.admin_email,
    monthly_price_cents: tenant.monthly_price_cents,
    paid_until: tenant.paid_until,
    billing: billingState(tenant.paid_until, new Date()),
    status: tenant.status,
    origin: tenant.origin,
    has_initial_password: !!tenant.initial_password,
    notes: tenant.notes,
    metrics: tenant.metrics_json ? JSON.parse(tenant.metrics_json) : null,
    metrics_at: tenant.metrics_at,
    created_at: tenant.created_at,
  };
}

export function overview() {
  const views = listTenants().map(view);
  const billable = views.filter(item => item.status === 'active');

  return {
    summary: {
      total: views.length,
      active: billable.length,
      suspended: views.filter(item => item.status === 'suspended').length,
      late: billable.filter(item => item.billing.state === 'late').length,
      // Receita mensal das que estão no ar
      monthly_cents: billable.reduce(
        (sum, item) => sum + item.monthly_price_cents,
        0,
      ),
    },
    tenants: views,
  };
}

export function details(id: string) {
  const tenant = findTenant(id);

  return { ...view(tenant), payments: paymentsOf(id) };
}

// --- Sincronia com a API ----------------------------------------------------

function insert(tenant: Tenant): void {
  db.prepare(
    `INSERT INTO tenants (id, api_id, slug, name, domain, custom_domain, admin_name,
      admin_email, initial_password, timezone, monthly_price_cents, paid_until, status,
      notes, origin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    tenant.id,
    tenant.api_id,
    tenant.slug,
    tenant.name,
    tenant.domain,
    tenant.custom_domain,
    tenant.admin_name,
    tenant.admin_email,
    tenant.initial_password,
    tenant.timezone,
    tenant.monthly_price_cents,
    tenant.paid_until,
    tenant.status,
    tenant.notes,
    tenant.origin,
    tenant.created_at,
    tenant.updated_at,
  );
}

// O que vem da API (endereço, situação) por cima do que o painel guarda
function fromApi(api: ApiTenant): Partial<Tenant> {
  return {
    api_id: api.id,
    slug: api.slug,
    domain: api.host,
    custom_domain: api.custom_domain,
    status: api.status,
  };
}

// Cobrança nova: mensalidade e dias grátis
interface Billing {
  monthly_price_cents: number;
  trial_days: number;
  notes?: string | null;
}

function validBilling(data: Billing): void {
  if (
    !Number.isInteger(data.monthly_price_cents) ||
    data.monthly_price_cents < 0 ||
    !Number.isInteger(data.trial_days) ||
    data.trial_days < 0 ||
    data.trial_days > 90
  ) {
    throw new PanelError('Informe a mensalidade e os dias grátis (0 a 90).');
  }
}

// Grava (ou atualiza) a barbearia que a API acabou de criar
function remember(
  api: ApiTenant,
  values: Partial<Tenant> & Billing & { name: string; origin: Tenant['origin'] },
): Tenant {
  // Uma antiga com o mesmo identificador (importada agora): vira esta
  const previous = db
    .prepare('SELECT * FROM tenants WHERE slug = ? OR api_id = ?')
    .get(api.slug, api.id) as Tenant | undefined;

  if (previous) {
    update(previous.id, {
      ...fromApi(api),
      name: values.name,
      origin: values.origin,
      admin_name: values.admin_name ?? previous.admin_name,
      admin_email: values.admin_email ?? previous.admin_email,
    });

    return findTenant(previous.id);
  }

  const now = new Date();
  const tenant: Tenant = {
    id: randomUUID(),
    api_id: api.id,
    slug: api.slug,
    name: values.name,
    domain: api.host,
    custom_domain: api.custom_domain,
    admin_name: values.admin_name || '',
    admin_email: values.admin_email || '',
    initial_password: values.initial_password || null,
    timezone: 'America/Sao_Paulo',
    monthly_price_cents: values.monthly_price_cents,
    paid_until: trialUntil(now, values.trial_days),
    status: api.status,
    notes: values.notes?.trim() || null,
    metrics_json: null,
    metrics_at: null,
    origin: values.origin,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  insert(tenant);

  return tenant;
}

// Confere com a API: liga as barbearias pelo identificador, traz as que só
// existem lá (ex.: a da instalação de antes) e marca as que sumiram
export async function syncWithApi(): Promise<void> {
  const apiTenants = await guard(() => pontual.list());
  const known = listTenants();

  apiTenants.forEach(api => {
    const match = known.find(
      tenant => tenant.api_id === api.id || tenant.slug === api.slug,
    );

    if (match) {
      update(match.id, fromApi(api));
      return;
    }

    remember(api, {
      name: api.name,
      origin: 'found',
      monthly_price_cents: 0,
      trial_days: 30,
    });
  });

  // Lido de novo: as ligadas agora pelo identificador já têm o id novo
  listTenants()
    .filter(tenant => tenant.api_id && !apiTenants.some(api => api.id === tenant.api_id))
    .forEach(tenant => update(tenant.id, { api_id: null, status: 'legacy' }));
}

// --- Operações --------------------------------------------------------------

export interface CreateTenant extends Billing {
  name: string;
  slug?: string;
  custom_domain?: string | null;
  admin_name: string;
  admin_email: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export async function createTenant(data: CreateTenant): Promise<{
  tenant: ReturnType<typeof view>;
  admin_password: string;
}> {
  const name = data.name.trim();
  const slug = slugify(data.slug || name);

  if (!name) throw new PanelError('Informe o nome da barbearia.');
  if (!slug) throw new PanelError('Informe um identificador (ex.: barbearia-do-ze).');
  if (!data.admin_name.trim()) throw new PanelError('Informe o nome do administrador.');
  if (!EMAIL.test(data.admin_email.trim())) {
    throw new PanelError('E-mail do administrador inválido.');
  }

  validBilling(data);

  const legacy = db.prepare("SELECT 1 FROM tenants WHERE slug = ? AND status != 'legacy'").get(slug);

  if (legacy) throw new PanelError(`Já existe uma barbearia com o identificador "${slug}".`);

  const password = readablePassword();
  const admin = {
    name: data.admin_name.trim(),
    email: data.admin_email.trim().toLowerCase(),
    password,
  };

  const api = await guard(() =>
    pontual.create({
      slug,
      name,
      custom_domain: data.custom_domain?.trim() || null,
      admin,
    }),
  );

  const tenant = remember(api, {
    ...data,
    name,
    origin: 'new',
    admin_name: admin.name,
    admin_email: admin.email,
    initial_password: password,
  });

  return { tenant: view(tenant), admin_password: password };
}

// Backup enviado pela tela (o corpo cru), direto para a API
export async function importTenant(
  body: Readable,
  data: Billing & { name?: string; slug?: string },
): Promise<ReturnType<typeof view>> {
  validBilling(data);

  const slug = data.slug ? slugify(data.slug) : undefined;
  const created = await guard(() => pontual.import(body, { slug, name: data.name?.trim() }));
  const api = await guard(() => pontual.show(created.id));

  const tenant = remember(api, {
    ...data,
    name: api.name,
    origin: 'import',
    admin_name: api.admin?.name || '',
    admin_email: api.admin?.email || '',
  });

  return view(tenant);
}

export async function suspend(id: string): Promise<void> {
  const tenant = findTenant(id);

  if (tenant.status !== 'active') {
    throw new PanelError('Só barbearias no ar podem ser suspensas.');
  }

  const api = await guard(() => pontual.update(linked(tenant), { status: 'suspended' }));

  update(id, fromApi(api));
}

export async function resume(id: string): Promise<void> {
  const tenant = findTenant(id);

  if (tenant.status !== 'suspended') {
    throw new PanelError('Esta barbearia não está suspensa.');
  }

  const api = await guard(() => pontual.update(linked(tenant), { status: 'active' }));

  update(id, fromApi(api));
}

// Domínio próprio (vazio: volta para o subdomínio)
export async function setDomain(id: string, domain: string | null): Promise<void> {
  const tenant = findTenant(id);
  const api = await guard(() =>
    pontual.update(linked(tenant), { custom_domain: domain?.trim() || null }),
  );

  update(id, fromApi(api));
}

// Apaga a barbearia e todos os dados dela na API
export async function removeTenant(id: string): Promise<void> {
  const tenant = findTenant(id);

  if (tenant.api_id) {
    await guard(() => pontual.remove(tenant.api_id as string)).catch(err => {
      // Já não existia na API: segue e tira do painel
      if (!(err instanceof PanelError && err.status === 404)) throw err;
    });
  }

  db.prepare('DELETE FROM tenants WHERE id = ?').run(id);
}

// --- Dados cadastrais e cobrança -------------------------------------------

export async function editTenant(
  id: string,
  data: { name: string; monthly_price_cents: number; notes: string | null },
): Promise<void> {
  const tenant = findTenant(id);

  if (!data.name.trim()) throw new PanelError('Informe o nome da barbearia.');
  if (!Number.isInteger(data.monthly_price_cents) || data.monthly_price_cents < 0) {
    throw new PanelError('Mensalidade inválida.');
  }

  if (tenant.api_id && data.name.trim() !== tenant.name) {
    await guard(() => pontual.update(tenant.api_id as string, { name: data.name.trim() }));
  }

  update(id, {
    name: data.name.trim(),
    monthly_price_cents: data.monthly_price_cents,
    notes: data.notes?.trim() || null,
  });
}

export function registerPayment(
  id: string,
  data: { amount_cents?: number | null; method: string; note?: string | null },
): Payment {
  const tenant = findTenant(id);
  const methods = ['pix', 'boleto', 'cartao', 'transferencia', 'dinheiro'];

  if (!methods.includes(data.method)) {
    throw new PanelError('Forma de pagamento inválida.');
  }

  const amount = data.amount_cents ?? tenant.monthly_price_cents;

  if (!Number.isInteger(amount) || amount < 0) {
    throw new PanelError('Valor inválido.');
  }

  const period = nextPeriod(tenant.paid_until, new Date());
  const payment: Payment = {
    id: randomUUID(),
    tenant_id: id,
    amount_cents: amount,
    method: data.method,
    period_start: period.start,
    period_end: period.end,
    paid_at: new Date().toISOString(),
    note: data.note?.trim() || null,
  };

  db.prepare(
    `INSERT INTO payments (id, tenant_id, amount_cents, method, period_start, period_end, paid_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    payment.id,
    payment.tenant_id,
    payment.amount_cents,
    payment.method,
    payment.period_start,
    payment.period_end,
    payment.paid_at,
    payment.note,
  );
  update(id, { paid_until: period.end });

  return payment;
}

// Senha inicial do admin (a barbearia pode ter trocado depois)
export function initialPassword(id: string): string {
  return findTenant(id).initial_password || '';
}

// --- Uso (lido da API) -----------------------------------------------------

export async function refreshMetrics(tenant: Tenant): Promise<void> {
  const metrics = await guard(() => pontual.metrics(linked(tenant)));

  update(tenant.id, {
    metrics_json: JSON.stringify(metrics),
    metrics_at: new Date().toISOString(),
  });
}

export async function refreshAllMetrics(): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax
  for (const tenant of listTenants()) {
    if (tenant.status === 'active' && tenant.api_id) {
      // eslint-disable-next-line no-await-in-loop
      await refreshMetrics(tenant).catch(() => undefined);
    }
  }
}

// --- Backups ----------------------------------------------------------------

const backupsDirOf = (tenant: Pick<Tenant, 'slug'>): string =>
  path.join(config.dataDir, 'backups', tenant.slug);

// Backup só desta barbearia, gerado pela API e guardado aqui
export async function backupTenant(id: string): Promise<string> {
  const tenant = findTenant(id);
  const stream = await guard(() => pontual.export(linked(tenant)));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(backupsDirOf(tenant), `${tenant.slug}-${stamp}.tar.gz`);

  fs.mkdirSync(path.dirname(file), { recursive: true });

  try {
    await pipeline(Readable.fromWeb(stream as never), fs.createWriteStream(file));
  } catch (err) {
    fs.rmSync(file, { force: true });
    throw err;
  }

  return path.basename(file);
}

export function listBackups(id: string): Array<{ name: string; size_bytes: number; created_at: string }> {
  const directory = backupsDirOf(findTenant(id));

  if (!fs.existsSync(directory)) return [];

  return fs
    .readdirSync(directory)
    .filter(name => name.endsWith('.tar.gz'))
    .map(name => {
      const stat = fs.statSync(path.join(directory, name));

      return { name, size_bytes: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Caminho de um backup para baixar (só nomes da própria pasta)
export function backupFile(id: string, name: string): string {
  const tenant = findTenant(id);

  if (!/^[A-Za-z0-9-]+\.tar\.gz$/.test(name)) throw new PanelError('Backup não encontrado.', 404);

  const file = path.join(backupsDirOf(tenant), name);

  if (!fs.existsSync(file)) throw new PanelError('Backup não encontrado.', 404);

  return file;
}

export { toDay };
