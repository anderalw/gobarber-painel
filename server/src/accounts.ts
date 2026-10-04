import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';

import { config } from './config';
import { db, Tenant } from './db';
import { billingState } from './billing';
import { slugify } from './text';
import { checkSlug } from './signup';
import { PanelError, createTenant, findTenant, publicUrl } from './tenants';

// Conta de quem se cadastra na página de divulgação: primeiro a pessoa cria
// a conta (nome, e-mail, WhatsApp e senha) e entra na área dela; lá preenche
// os dados do negócio e o sistema nasce no ar, com a mesma senha

export interface Account {
  id: string;
  name: string;
  email: string;
  phone: string;
  password_hash: string;
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const COOKIE = 'conta_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

// --- Limites (contra robôs e tentativas de senha) --------------------------

const hits = new Map<string, number[]>();

export function allow(key: string, limit: number, windowMs = 60 * 60 * 1000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(at => now - at < windowMs);

  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }

  hits.set(key, [...recent, now]);
  return true;
}

// --- Sessão (cookie assinado, separado do login do dono) -------------------

const sign = (payload: string): string =>
  createHmac('sha256', `${config.sessionSecret}:conta`).update(payload).digest('base64url');

function readCookie(request: Request): string | null {
  const found = (request.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE}=`));

  return found ? decodeURIComponent(found.slice(COOKIE.length + 1)) : null;
}

function setCookie(request: Request, response: Response, accountId: string): void {
  const payload = Buffer.from(JSON.stringify({ aid: accountId, exp: Date.now() + TTL_MS })).toString(
    'base64url',
  );

  response.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.secure || request.headers['x-forwarded-proto'] === 'https',
    maxAge: TTL_MS,
    path: '/',
  });
}

export function logout(response: Response): void {
  response.clearCookie(COOKIE, { path: '/' });
}

function findAccount(id: string): Account | undefined {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined;
}

// Conta da sessão (ou erro 401)
export function currentAccount(request: Request): Account {
  const value = readCookie(request);
  const [payload, signature] = (value || '').split('.');
  const expected = payload ? sign(payload) : '';

  if (
    payload &&
    signature &&
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const account = data.exp > Date.now() ? findAccount(data.aid) : undefined;

      if (account) return account;
    } catch {
      // Cookie inválido: pede para entrar
    }
  }

  throw new PanelError('Entre na sua conta.', 401);
}

// --- O que a área do cliente mostra ----------------------------------------

export function accountView(account: Account) {
  let tenant: Tenant | null = null;

  if (account.tenant_id) {
    try {
      tenant = findTenant(account.tenant_id);
    } catch {
      tenant = null;
    }
  }

  const url = tenant ? publicUrl(tenant.domain) : null;

  return {
    account: { name: account.name, email: account.email, phone: account.phone },
    business: tenant
      ? {
          name: tenant.name,
          slug: tenant.slug,
          segment: tenant.segment,
          url,
          login_url: `${url}/equipe`,
          status: tenant.status,
          // Em teste: ainda sem nenhum pagamento registrado
          trial: tenant.origin === 'signup' && !hasPayments(tenant.id),
          paid_until: tenant.paid_until,
          billing: billingState(tenant.paid_until, new Date()),
          monthly_price_cents: tenant.monthly_price_cents,
        }
      : null,
  };
}

function hasPayments(tenantId: string): boolean {
  return !!db.prepare('SELECT 1 FROM payments WHERE tenant_id = ?').get(tenantId);
}

// --- Operações --------------------------------------------------------------

export async function signupAccount(
  request: Request,
  response: Response,
  data: {
    name: string;
    email: string;
    phone: string;
    password: string;
    accepted_terms: boolean;
    website?: string;
  },
) {
  if (!config.signup.enabled) {
    throw new PanelError('Os cadastros estão fechados no momento.', 403);
  }

  // Robô (preencheu o campo escondido): não cria nada
  if (data.website) throw new PanelError('Não foi possível concluir o cadastro.');

  const name = data.name.trim();
  const email = data.email.trim().toLowerCase();
  const phone = data.phone.replace(/\D/g, '');

  if (!name) throw new PanelError('Informe o seu nome.');
  if (!EMAIL.test(email)) throw new PanelError('Informe um e-mail válido.');
  if (phone.length < 10 || phone.length > 13) throw new PanelError('Informe o WhatsApp com DDD.');
  if (data.password.length < 8) throw new PanelError('A senha precisa ter pelo menos 8 caracteres.');
  if (data.password.length > 72) throw new PanelError('A senha pode ter até 72 caracteres.');
  if (!data.accepted_terms) throw new PanelError('Aceite os termos de uso para continuar.');

  if (db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(email)) {
    throw new PanelError('Já existe uma conta com este e-mail. Entre com a sua senha.', 409);
  }

  if (!allow(`signup:${request.ip}`, 5) || !allow('signup:all', 60)) {
    throw new PanelError('Muitos cadastros em pouco tempo. Tente de novo mais tarde.', 429);
  }

  const now = new Date().toISOString();
  const account: Account = {
    id: randomUUID(),
    name,
    email,
    phone,
    // Mesmo formato da API (bcrypt): vira a senha do administrador
    password_hash: await bcrypt.hash(data.password, 8),
    tenant_id: null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO accounts (id, name, email, phone, password_hash, tenant_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    account.id,
    account.name,
    account.email,
    account.phone,
    account.password_hash,
    null,
    now,
    now,
  );

  setCookie(request, response, account.id);

  return accountView(account);
}

export async function loginAccount(
  request: Request,
  response: Response,
  data: { email: string; password: string },
) {
  const email = data.email.trim().toLowerCase();

  if (!allow(`login:${request.ip}:${email}`, 8, 15 * 60 * 1000)) {
    throw new PanelError('Muitas tentativas. Espere alguns minutos e tente de novo.', 429);
  }

  const account = db.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as
    | Account
    | undefined;

  if (!account || !(await bcrypt.compare(data.password, account.password_hash))) {
    throw new PanelError('E-mail ou senha incorretos.', 401);
  }

  setCookie(request, response, account.id);

  return accountView(account);
}

// Segundo passo: os dados do negócio. Ele nasce no ar com o ramo, o nome e
// o endereço escolhidos; a pessoa entra como administradora com a mesma
// senha da conta
export async function createBusiness(
  account: Account,
  data: { business_name: string; segment: string; slug: string },
) {
  if (account.tenant_id) {
    throw new PanelError('Sua conta já tem um negócio criado.');
  }

  const businessName = data.business_name.trim();
  const slug = slugify(data.slug || businessName);

  if (businessName.length < 2) throw new PanelError('Informe o nome do seu negócio.');

  const check = checkSlug(slug);

  if (!check.available) {
    throw new PanelError(
      `O endereço "${slug}" não está disponível. Que tal "${check.suggestion}"?`,
      409,
    );
  }

  if (!allow(`business:all`, 30)) {
    throw new PanelError('Muitos cadastros em pouco tempo. Tente de novo mais tarde.', 429);
  }

  const { tenant } = await createTenant({
    name: businessName,
    slug,
    admin_name: account.name,
    admin_email: account.email,
    admin_password_hash: account.password_hash,
    admin_phone: account.phone,
    segment: data.segment,
    monthly_price_cents: config.signup.priceCents,
    trial_days: config.signup.trialDays,
    origin: 'signup',
    notes: `Cadastro pela página em ${new Date().toLocaleDateString('pt-BR')} (teste de ${config.signup.trialDays} dias).`,
  });

  db.prepare('UPDATE accounts SET tenant_id = ?, updated_at = ? WHERE id = ?').run(
    tenant.id,
    new Date().toISOString(),
    account.id,
  );

  return accountView({ ...account, tenant_id: tenant.id });
}

// Para o dono: contas que ainda não criaram o negócio (contatos)
export function pendingAccounts() {
  return (
    db
      .prepare(
        'SELECT id, name, email, phone, created_at FROM accounts WHERE tenant_id IS NULL ORDER BY created_at DESC LIMIT 50',
      )
      .all() as Array<Pick<Account, 'id' | 'name' | 'email' | 'phone' | 'created_at'>>
  );
}
