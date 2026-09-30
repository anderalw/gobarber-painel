import fs from 'fs';
import path from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

import { config } from './config';
import { db, Payment, Tenant, TenantStatus } from './db';
import { compose, containersByProject, ContainerState } from './docker';
import { buildCaddyfile, loadCaddyfile } from './caddyfile';
import { billingState, nextPeriod, toDay, trialUntil } from './billing';
import { envFile, slugify } from './text';
import { BackupSummary, extract, inspect, pack } from './backup';

export { slugify };

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(here, '..', '..', 'templates', 'tenant-compose.yml');

// Quanto esperar a API de uma barbearia ficar de pé (1ª vez roda migrations)
const READY_TIMEOUT_MS = 4 * 60 * 1000;

// Barbearias com uma operação em andamento (uma de cada vez)
const running = new Set<string>();

export class PanelError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const projectOf = (tenant: Pick<Tenant, 'slug'>): string =>
  `gb-${tenant.slug}`;

const folderOf = (tenant: Pick<Tenant, 'slug'>): string =>
  path.join(config.dataDir, 'tenants', tenant.slug);

// Senhas e segredos: legíveis (sem caracteres confusos) e fortes
function secret(bytes = 24): string {
  return randomBytes(bytes).toString('hex');
}

function readablePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);

  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

// Endereço público do site da barbearia
export function publicUrl(domain: string): string {
  if (config.tls === 'auto') return `https://${domain}`;

  return config.publicHttpPort === 80
    ? `http://${domain}`
    : `http://${domain}:${config.publicHttpPort}`;
}

function readEnv(tenant: Tenant): Record<string, string> {
  const file = path.join(folderOf(tenant), '.env');

  if (!fs.existsSync(file)) return {};

  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(line => line.includes('='))
      .map(line => {
        const index = line.indexOf('=');
        const raw = line.slice(index + 1);
        const value = raw.startsWith('"')
          ? raw
              .slice(1, -1)
              .replace(/\$\$/g, '$')
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, '\\')
          : raw;

        return [line.slice(0, index), value];
      }),
  );
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

// --- Como a tela vê cada barbearia -----------------------------------------

export type Runtime = 'online' | 'starting' | 'stopped' | 'partial' | 'absent';

function runtimeOf(containers: ContainerState[] | undefined): Runtime {
  if (!containers || containers.length === 0) return 'absent';

  const running = containers.filter(item => item.state === 'running');

  if (running.length === 0) return 'stopped';
  if (running.length < containers.length) return 'partial';
  if (containers.some(item => item.health && item.health !== 'healthy')) {
    return 'starting';
  }

  return 'online';
}

export function view(tenant: Tenant, containers?: ContainerState[]) {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    domain: tenant.domain,
    url: publicUrl(tenant.domain),
    admin_name: tenant.admin_name,
    admin_email: tenant.admin_email,
    timezone: tenant.timezone,
    monthly_price_cents: tenant.monthly_price_cents,
    paid_until: tenant.paid_until,
    billing: billingState(tenant.paid_until, new Date()),
    status: tenant.status,
    origin: tenant.origin,
    // Uma operação (criar, suspender, atualizar...) em andamento
    busy: running.has(tenant.id),
    runtime: runtimeOf(containers),
    notes: tenant.notes,
    metrics: tenant.metrics_json ? JSON.parse(tenant.metrics_json) : null,
    metrics_at: tenant.metrics_at,
    last_operation: tenant.last_operation,
    created_at: tenant.created_at,
  };
}

export async function overview() {
  const tenants = listTenants();
  const containers = await containersByProject();
  const views = tenants.map(tenant =>
    view(tenant, containers.get(projectOf(tenant))),
  );
  const billable = views.filter(item => item.status !== 'suspended');

  return {
    summary: {
      total: views.length,
      online: views.filter(item => item.runtime === 'online').length,
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

export async function details(id: string) {
  const tenant = findTenant(id);
  const containers = await containersByProject();

  return {
    ...view(tenant, containers.get(projectOf(tenant))),
    containers: containers.get(projectOf(tenant)) || [],
    payments: paymentsOf(id),
    last_log: tenant.last_log,
  };
}

// --- Operações (uma de cada vez por barbearia) -----------------------------

// Roda em segundo plano: a tela acompanha pelo status e pelo log
function operate(
  tenant: Tenant,
  label: string,
  work: (log: (text: string) => void) => Promise<TenantStatus>,
): void {
  if (running.has(tenant.id)) {
    throw new PanelError('Já há uma operação em andamento nesta barbearia.');
  }

  running.add(tenant.id);

  const lines: string[] = [];
  const log = (text: string): void => {
    lines.push(text);
    // Guarda só o fim (o log do docker pode ser grande)
    update(tenant.id, { last_log: lines.join('\n').slice(-20000) });
  };
  const previous = tenant.status;

  // O status público continua o de antes até a operação terminar
  update(tenant.id, { last_operation: label, last_log: '' });

  work(log)
    .then(status => {
      update(tenant.id, { status });
      log(`✔ ${label}: concluído.`);
    })
    .catch(err => {
      log(`✖ ${label}: ${err instanceof Error ? err.message : String(err)}`);
      update(tenant.id, {
        status: previous === 'provisioning' ? 'error' : previous,
      });
    })
    .finally(async () => {
      running.delete(tenant.id);
      await syncCaddy().catch(err => log(`Aviso: ${err.message}`));
    });
}

async function run(
  tenant: Tenant,
  log: (text: string) => void,
  args: string[],
): Promise<void> {
  log(`$ docker compose ${args.join(' ')}`);

  const result = await compose(projectOf(tenant), folderOf(tenant), args);

  if (result.output) log(result.output);
  if (!result.ok) throw new Error(`falhou: docker compose ${args[0]}`);
}

// Espera a API responder (a 1ª subida roda as migrations e cria o admin)
async function waitReady(
  tenant: Tenant,
  log: (text: string) => void,
): Promise<void> {
  log('Aguardando o sistema responder...');

  const until = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < until) {
    // eslint-disable-next-line no-await-in-loop
    const probe = await compose(
      projectOf(tenant),
      folderOf(tenant),
      ['exec', '-T', 'api', 'wget', '-q', '-O', '-', 'http://localhost:3333/site'],
      20000,
    );

    if (probe.ok) {
      log('Sistema no ar.');
      return;
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  throw new Error('o sistema não respondeu a tempo (veja o log da API).');
}

// appSecret: o do sistema importado (mantém maquininha e WhatsApp); sem
// ele, um novo. adminPassword vazio: não cria admin (o backup já tem)
function writeFiles(
  tenant: Tenant,
  adminPassword: string,
  appSecret: string = secret(32),
): void {
  const folder = folderOf(tenant);

  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(TEMPLATE, path.join(folder, 'docker-compose.yml'));
  fs.writeFileSync(
    path.join(folder, '.env'),
    envFile({
      API_IMAGE: config.apiImage,
      WEB_IMAGE: config.webImage,
      EDGE_NETWORK: config.edgeNetwork,
      APP_URL: publicUrl(tenant.domain),
      TZ: tenant.timezone,
      APP_SECRET: appSecret,
      DB_PASS: secret(16),
      METRICS_TOKEN: secret(24),
      MAIL_DRIVER: 'ethereal',
      GOOGLE_CLIENT_ID: '',
      ADMIN_NAME: adminPassword ? tenant.admin_name : '',
      ADMIN_EMAIL: adminPassword ? tenant.admin_email : '',
      ADMIN_PASSWORD: adminPassword,
    }),
    { mode: 0o600 },
  );
}

// Caminho do backup extraído, visto da pasta da barbearia (o compose roda lá)
const importDirOf = (importId: string): string =>
  path.join(config.dataDir, 'imports', importId);

const fromTenant = (tenant: Tenant, file: string): string =>
  path.relative(folderOf(tenant), file).split(path.sep).join('/');

// Restaura o backup num ambiente novo: bancos primeiro (sem a API, para as
// migrations rodarem só depois, em cima dos dados), depois o resto e as fotos
async function restore(
  tenant: Tenant,
  log: (text: string) => void,
  directory: string,
): Promise<void> {
  const file = (name: string) => fromTenant(tenant, path.join(directory, name));

  await run(tenant, log, ['up', '-d', '--wait', 'postgres', 'mongo', 'redis']);

  log('Restaurando o banco principal...');
  await run(tenant, log, ['cp', file('postgres.sql'), 'postgres:/tmp/restore.sql']);
  await run(tenant, log, [
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'gostack_gobarber',
    '-q',
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    '/tmp/restore.sql',
  ]);

  if (fs.existsSync(path.join(directory, 'mongo.archive'))) {
    log('Restaurando as notificações...');
    await run(tenant, log, ['cp', file('mongo.archive'), 'mongo:/tmp/restore.archive']);
    await run(tenant, log, [
      'exec',
      '-T',
      'mongo',
      'mongorestore',
      '--archive=/tmp/restore.archive',
      '--drop',
      '--quiet',
    ]);
  }

  await run(tenant, log, ['up', '-d']);

  const files = path.join(directory, 'files');

  if (fs.existsSync(files) && fs.readdirSync(files).length > 0) {
    log('Copiando as fotos...');
    await run(tenant, log, ['cp', `${file('files')}/.`, 'api:/app/tmp/uploads/']);
  }
}

// Administrador principal do sistema importado (para mostrar no painel)
async function importedAdmin(tenant: Tenant): Promise<{ name: string; email: string } | null> {
  const result = await compose(projectOf(tenant), folderOf(tenant), [
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'gostack_gobarber',
    '-tA',
    '-F',
    '|',
    '-c',
    'SELECT name, email FROM users WHERE is_admin ORDER BY created_at LIMIT 1',
  ]);
  const [name, email] = result.output.trim().split('|');

  return result.ok && email ? { name, email } : null;
}

function provision(tenant: Tenant): void {
  const importDir = tenant.import_id ? importDirOf(tenant.import_id) : null;

  operate(tenant, importDir ? 'Importar barbearia' : 'Criar ambiente', async log => {
    if (config.pullImages) await run(tenant, log, ['pull', '--quiet']);

    if (importDir) {
      // Tentativa anterior pela metade: recomeça com os bancos vazios
      await run(tenant, log, ['down', '-v']);
      await restore(tenant, log, importDir);
    } else {
      await run(tenant, log, ['up', '-d', '--quiet-pull']);
    }

    await waitReady(tenant, log);

    if (importDir) {
      const admin = await importedAdmin(tenant);

      if (admin) {
        update(tenant.id, { admin_name: admin.name, admin_email: admin.email });
        log(`Administrador do sistema importado: ${admin.email}`);
      }

      update(tenant.id, { import_id: null });
      fs.rmSync(importDir, { recursive: true, force: true });
      fs.rmSync(`${importDir}.tar.gz`, { force: true });
    }

    await refreshMetrics(tenant).catch(() => undefined);

    return 'active';
  });
}

// --- Importação e backups ----------------------------------------------------

// Backup enviado pela tela: extrai e confere antes de criar a barbearia
export async function receiveImport(
  body: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<{ import_id: string } & BackupSummary> {
  const importId = randomUUID();
  const directory = importDirOf(importId);
  const archive = `${directory}.tar.gz`;

  fs.mkdirSync(path.dirname(archive), { recursive: true });

  let size = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(archive);

      body.on('data', (chunk: Buffer) => {
        size += chunk.length;

        if (size > maxBytes) {
          body.unpipe(out);
          out.destroy();
          reject(new PanelError('Backup grande demais.', 413));
        }
      });
      body.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      body.pipe(out);
    });

    await extract(archive, directory).catch(() => {
      throw new PanelError('Não foi possível abrir o arquivo (use o .tar.gz do backup).');
    });

    const { summary } = inspect(directory, size);

    return { import_id: importId, ...summary };
  } catch (err) {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });

    if (err instanceof PanelError) throw err;
    throw new PanelError(err instanceof Error ? err.message : 'Backup inválido.');
  }
}

// Envios de importação que não viraram barbearia (mais de um dia)
export function cleanOldImports(): void {
  const root = path.join(config.dataDir, 'imports');

  if (!fs.existsSync(root)) return;

  const used = new Set(
    (db.prepare('SELECT import_id FROM tenants WHERE import_id IS NOT NULL').all() as Array<{
      import_id: string;
    }>).map(row => row.import_id),
  );

  fs.readdirSync(root).forEach(name => {
    const id = name.replace(/\.tar\.gz$/, '');
    const full = path.join(root, name);

    if (!used.has(id) && Date.now() - fs.statSync(full).mtimeMs > 24 * 60 * 60 * 1000) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  });
}

const backupsDirOf = (tenant: Pick<Tenant, 'slug'>): string =>
  path.join(config.dataDir, 'backups', tenant.slug);

// Backup completo de uma barbearia do painel (mesmo formato da importação)
export function backupTenant(id: string): void {
  const tenant = findTenant(id);

  if (tenant.status !== 'active') {
    throw new PanelError('O backup é feito com a barbearia no ar.');
  }

  operate(tenant, 'Gerar backup', async log => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const directory = path.join(backupsDirOf(tenant), `work-${stamp}`);
    const file = (name: string) => fromTenant(tenant, path.join(directory, name));

    fs.mkdirSync(path.join(directory, 'files'), { recursive: true });

    try {
      log('Copiando o banco principal...');
      await run(tenant, log, [
        'exec',
        '-T',
        'postgres',
        'sh',
        '-c',
        'pg_dump -U postgres -d gostack_gobarber --no-owner --no-acl > /tmp/backup.sql',
      ]);
      await run(tenant, log, ['cp', 'postgres:/tmp/backup.sql', file('postgres.sql')]);

      log('Copiando as notificações...');
      await run(tenant, log, [
        'exec',
        '-T',
        'mongo',
        'sh',
        '-c',
        'mongodump --archive=/tmp/backup.archive --db gostack_gobarber --quiet',
      ]);
      await run(tenant, log, ['cp', 'mongo:/tmp/backup.archive', file('mongo.archive')]);

      log('Copiando as fotos...');
      await run(tenant, log, ['cp', 'api:/app/tmp/uploads/.', `${file('files')}/`]);

      fs.writeFileSync(
        path.join(directory, 'manifest.json'),
        JSON.stringify(
          {
            format: 'gobarber-backup',
            version: 1,
            created_at: new Date().toISOString(),
            source: `painel:${tenant.slug}`,
            app_secret: readEnv(tenant).APP_SECRET,
          },
          null,
          2,
        ),
      );

      const archive = path.join(backupsDirOf(tenant), `${tenant.slug}-${stamp}.tar.gz`);

      await pack(directory, archive);
      log(`Backup pronto: ${path.basename(archive)}`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }

    return 'active';
  });
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

export interface CreateTenant {
  name: string;
  slug?: string;
  domain?: string;
  admin_name: string;
  admin_email: string;
  timezone: string;
  monthly_price_cents: number;
  trial_days: number;
  notes?: string | null;
  // Backup enviado antes (receiveImport): a barbearia nasce com esses dados
  import_id?: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const DOMAIN = /^(?=.{1,200}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/;

export function createTenant(data: CreateTenant): {
  tenant: ReturnType<typeof view>;
  admin_password: string;
} {
  const name = data.name.trim();
  const slug = slugify(data.slug || name);
  const domain = (data.domain || `${slug}.${config.baseDomain}`)
    .trim()
    .toLowerCase();

  if (!name) throw new PanelError('Informe o nome da barbearia.');
  if (!slug) throw new PanelError('Informe um identificador (ex.: barbearia-do-ze).');
  if (!DOMAIN.test(domain)) throw new PanelError('Endereço (domínio) inválido.');
  const importDir = data.import_id ? importDirOf(data.import_id) : null;
  let importedSecret: string | undefined;

  if (importDir) {
    if (!/^[0-9a-f-]{36}$/.test(data.import_id as string) || !fs.existsSync(importDir)) {
      throw new PanelError('Backup não encontrado. Envie o arquivo de novo.');
    }

    importedSecret = inspect(importDir, 0).manifest.app_secret;
  } else {
    // Importada, o admin vem do backup
    if (!data.admin_name.trim()) throw new PanelError('Informe o nome do administrador.');
    if (!EMAIL.test(data.admin_email.trim())) {
      throw new PanelError('E-mail do administrador inválido.');
    }
  }

  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: data.timezone });
  } catch {
    throw new PanelError('Fuso horário inválido.');
  }

  if (
    !Number.isInteger(data.monthly_price_cents) ||
    data.monthly_price_cents < 0 ||
    !Number.isInteger(data.trial_days) ||
    data.trial_days < 0 ||
    data.trial_days > 90
  ) {
    throw new PanelError('Informe a mensalidade e os dias grátis (0 a 90).');
  }

  const taken = db
    .prepare('SELECT slug, domain FROM tenants WHERE slug = ? OR domain = ?')
    .get(slug, domain) as { slug: string; domain: string } | undefined;

  if (taken) {
    throw new PanelError(
      taken.slug === slug
        ? `Já existe uma barbearia com o identificador "${slug}".`
        : `O endereço ${domain} já está em uso.`,
    );
  }

  const now = new Date();
  const tenant: Tenant = {
    id: randomUUID(),
    slug,
    name,
    domain,
    admin_name: importDir ? '' : data.admin_name.trim(),
    admin_email: importDir ? '' : data.admin_email.trim().toLowerCase(),
    timezone: data.timezone,
    monthly_price_cents: data.monthly_price_cents,
    paid_until: trialUntil(now, data.trial_days),
    status: 'provisioning',
    notes: data.notes?.trim() || null,
    metrics_json: null,
    metrics_at: null,
    last_operation: null,
    last_log: null,
    origin: importDir ? 'import' : 'new',
    import_id: importDir ? (data.import_id as string) : null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  db.prepare(
    `INSERT INTO tenants (id, slug, name, domain, admin_name, admin_email, timezone,
      monthly_price_cents, paid_until, status, notes, origin, import_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    tenant.id,
    tenant.slug,
    tenant.name,
    tenant.domain,
    tenant.admin_name,
    tenant.admin_email,
    tenant.timezone,
    tenant.monthly_price_cents,
    tenant.paid_until,
    tenant.status,
    tenant.notes,
    tenant.origin,
    tenant.import_id,
    tenant.created_at,
    tenant.updated_at,
  );

  // Importada: sem admin novo (os logins são os do backup) e com o segredo
  // antigo, se veio no backup
  const adminPassword = importDir ? '' : readablePassword();

  writeFiles(tenant, adminPassword, importedSecret);
  provision(findTenant(tenant.id));

  return { tenant: view(tenant), admin_password: adminPassword };
}

export function reprovision(id: string): void {
  const tenant = findTenant(id);

  if (tenant.status !== 'error') {
    throw new PanelError('Só dá para tentar de novo quando a criação falhou.');
  }

  update(id, { status: 'provisioning' });
  provision(findTenant(id));
}

export function suspend(id: string): void {
  const tenant = findTenant(id);

  if (tenant.status !== 'active') {
    throw new PanelError('Só barbearias no ar podem ser suspensas.');
  }

  operate(tenant, 'Suspender', async log => {
    // Os dados ficam guardados; só os contêineres param
    await run(tenant, log, ['stop']);

    return 'suspended';
  });
}

export function resume(id: string): void {
  const tenant = findTenant(id);

  if (tenant.status !== 'suspended') {
    throw new PanelError('Esta barbearia não está suspensa.');
  }

  operate(tenant, 'Reativar', async log => {
    await run(tenant, log, ['up', '-d']);
    await waitReady(tenant, log);

    return 'active';
  });
}

// Nova versão do Pontual: baixa as imagens e recria os contêineres (as
// migrations novas rodam ao subir)
export function upgrade(id: string): void {
  const tenant = findTenant(id);

  if (tenant.status !== 'active') {
    throw new PanelError('Só barbearias no ar podem ser atualizadas.');
  }

  operate(tenant, 'Atualizar versão', async log => {
    if (config.pullImages) await run(tenant, log, ['pull', '--quiet']);
    await run(tenant, log, ['up', '-d']);
    await waitReady(tenant, log);

    return 'active';
  });
}

// purge: apaga também os dados (bancos e fotos)
export async function removeTenant(id: string, purge: boolean): Promise<string> {
  const tenant = findTenant(id);

  if (running.has(id)) {
    throw new PanelError('Espere a operação em andamento terminar.');
  }

  running.add(id);

  try {
    const result = await compose(projectOf(tenant), folderOf(tenant), [
      'down',
      ...(purge ? ['-v'] : []),
    ]);

    if (!result.ok && fs.existsSync(folderOf(tenant))) {
      throw new PanelError(`Não foi possível parar o ambiente: ${result.output}`);
    }

    if (purge) fs.rmSync(folderOf(tenant), { recursive: true, force: true });

    db.prepare('DELETE FROM tenants WHERE id = ?').run(id);

    return result.output;
  } finally {
    running.delete(id);
    await syncCaddy().catch(() => undefined);
  }
}

// --- Dados cadastrais e cobrança -------------------------------------------

export function editTenant(
  id: string,
  data: { name: string; monthly_price_cents: number; notes: string | null },
): void {
  findTenant(id);

  if (!data.name.trim()) throw new PanelError('Informe o nome da barbearia.');
  if (!Number.isInteger(data.monthly_price_cents) || data.monthly_price_cents < 0) {
    throw new PanelError('Mensalidade inválida.');
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
  return readEnv(findTenant(id)).ADMIN_PASSWORD || '';
}

// --- Uso (lido do próprio Pontual, pela rota interna com token) -----------

export async function refreshMetrics(tenant: Tenant): Promise<void> {
  const token = readEnv(tenant).METRICS_TOKEN;

  if (!token) return;

  const result = await compose(
    projectOf(tenant),
    folderOf(tenant),
    [
      'exec',
      '-T',
      'api',
      'wget',
      '-q',
      '-O',
      '-',
      '--header',
      `Authorization: Bearer ${token}`,
      'http://localhost:3333/internal/metrics',
    ],
    30000,
  );

  if (!result.ok) throw new PanelError('Não foi possível ler o uso agora.');

  const json = result.output.slice(result.output.indexOf('{'));

  update(tenant.id, {
    metrics_json: JSON.stringify(JSON.parse(json)),
    metrics_at: new Date().toISOString(),
  });
}

export async function refreshAllMetrics(): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax
  for (const tenant of listTenants()) {
    if (tenant.status === 'active' && !running.has(tenant.id)) {
      // eslint-disable-next-line no-await-in-loop
      await refreshMetrics(tenant).catch(() => undefined);
    }
  }
}

// O painel reiniciou no meio de uma criação: a operação se perdeu. Marca
// como falha para aparecer o "Tentar de novo" (subir de novo é seguro)
export function recoverInterrupted(): void {
  db.prepare(
    `UPDATE tenants SET status = 'error',
       last_log = COALESCE(last_log, '') || char(10) || '✖ O painel reiniciou durante a criação. Use "Tentar de novo".',
       updated_at = ?
     WHERE status = 'provisioning'`,
  ).run(new Date().toISOString());
}

// --- Caddy ------------------------------------------------------------------

export async function syncCaddy(): Promise<void> {
  const sites = listTenants().map(tenant => ({
    project: projectOf(tenant),
    domain: tenant.domain,
    status: tenant.status,
  }));

  await loadCaddyfile(buildCaddyfile(sites, config), config);
}

export { toDay };
