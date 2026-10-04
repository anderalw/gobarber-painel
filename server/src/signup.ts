import { config } from './config';
import { db, Tenant } from './db';
import { pontual } from './pontual';
import { slugify } from './text';
import { PanelError, createTenant, listTenants, paymentsOf, suspend, toDay } from './tenants';

// Página de divulgação: informações públicas, cadastro com dias de teste
// (o negócio nasce no ar, sem passar por ninguém) e o fim dos testes

// Os mesmos identificadores reservados da API (subdomínios do sistema)
const RESERVED = [
  'www', 'api', 'app', 'painel', 'admin', 'mail', 'smtp', 'static',
  'cdn', 'files', 'status', 'docs', 'blog', 'suporte', 'ajuda', 'site',
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

// Limites por IP e no total, por hora (contra robôs e abuso)
const PER_IP_PER_HOUR = 3;
const TOTAL_PER_HOUR = 30;
const attempts = new Map<string, number[]>();

function allow(key: string, limit: number): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter(at => now - at < 60 * 60 * 1000);

  if (recent.length >= limit) {
    attempts.set(key, recent);
    return false;
  }

  attempts.set(key, [...recent, now]);
  return true;
}

export async function publicInfo() {
  const segments = await pontual.segments().catch(() => []);

  return {
    signup_enabled: config.signup.enabled,
    trial_days: config.signup.trialDays,
    price_cents: config.signup.priceCents,
    base_domain: config.baseDomain,
    segments,
  };
}

function taken(slug: string): boolean {
  return !!db.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(slug);
}

// Identificador livre (ou o próximo com número no fim)
export function checkSlug(value: string): {
  slug: string;
  available: boolean;
  suggestion: string;
} {
  const slug = slugify(value);
  const invalid = slug.length < 3 || RESERVED.includes(slug);
  const available = !invalid && !taken(slug);
  let suggestion = slug;

  if (!available && slug.length >= 3) {
    for (let n = 2; n < 100; n += 1) {
      const candidate = `${slug.slice(0, 27)}-${n}`;

      if (!taken(candidate)) {
        suggestion = candidate;
        break;
      }
    }
  }

  return { slug, available, suggestion };
}

export interface SignupData {
  business_name: string;
  segment: string;
  slug: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  accepted_terms: boolean;
  // Campo escondido: só robôs preenchem
  website?: string;
}

export async function signup(
  data: SignupData,
  ip: string,
): Promise<{ url: string; login_url: string; email: string; trial_until: string }> {
  if (!config.signup.enabled) {
    throw new PanelError('Os cadastros estão fechados no momento.', 403);
  }

  // Robô (preencheu o campo escondido): não cria nada
  if (data.website) throw new PanelError('Não foi possível concluir o cadastro.');

  const businessName = data.business_name.trim();
  const slug = slugify(data.slug || businessName);
  const phone = data.phone.replace(/\D/g, '');

  if (businessName.length < 2) throw new PanelError('Informe o nome do seu negócio.');
  if (!data.name.trim()) throw new PanelError('Informe o seu nome.');
  if (!EMAIL.test(data.email.trim())) throw new PanelError('Informe um e-mail válido.');
  if (phone.length < 10 || phone.length > 13) {
    throw new PanelError('Informe o WhatsApp com DDD.');
  }
  if (data.password.length < 8) {
    throw new PanelError('A senha precisa ter pelo menos 8 caracteres.');
  }
  if (!data.accepted_terms) throw new PanelError('Aceite os termos de uso para continuar.');

  const check = checkSlug(slug);

  if (!check.available) {
    throw new PanelError(
      `O endereço "${slug}" não está disponível. Que tal "${check.suggestion}"?`,
      409,
    );
  }

  if (!allow(`ip:${ip}`, PER_IP_PER_HOUR) || !allow('all', TOTAL_PER_HOUR)) {
    throw new PanelError('Muitos cadastros em pouco tempo. Tente de novo mais tarde.', 429);
  }

  const { tenant } = await createTenant({
    name: businessName,
    slug,
    admin_name: data.name,
    admin_email: data.email,
    admin_password: data.password,
    admin_phone: phone,
    segment: data.segment,
    monthly_price_cents: config.signup.priceCents,
    trial_days: config.signup.trialDays,
    origin: 'signup',
    notes: `Cadastro pelo site em ${new Date().toLocaleDateString('pt-BR')} (teste de ${config.signup.trialDays} dias).`,
  });

  return {
    url: tenant.url,
    login_url: `${tenant.url}/equipe`,
    email: tenant.admin_email,
    trial_until: tenant.paid_until,
  };
}

// Testes que acabaram sem pagamento: o negócio é suspenso (reativa ao
// registrar o pagamento no painel)
export async function expireTrials(today = new Date()): Promise<string[]> {
  if (!config.signup.autoSuspend) return [];

  const expired = listTenants().filter(
    (tenant: Tenant) =>
      tenant.origin === 'signup' &&
      tenant.status === 'active' &&
      tenant.paid_until <= toDay(today) &&
      paymentsOf(tenant.id).length === 0,
  );

  const suspended: string[] = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const tenant of expired) {
    // eslint-disable-next-line no-await-in-loop
    await suspend(tenant.id)
      .then(() => suspended.push(tenant.slug))
      .catch(() => undefined);
  }

  return suspended;
}

