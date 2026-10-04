import { config } from './config';
import { db, Tenant } from './db';
import { pontual } from './pontual';
import { slugify } from './text';
import { listTenants, paymentsOf, suspend, toDay } from './tenants';

// Página de divulgação: informações públicas, endereço livre e o fim dos
// testes (a conta e o negócio ficam em accounts.ts)

// Os mesmos identificadores reservados da API (subdomínios do sistema)
const RESERVED = [
  'www', 'api', 'app', 'painel', 'admin', 'mail', 'smtp', 'static',
  'cdn', 'files', 'status', 'docs', 'blog', 'suporte', 'ajuda', 'site',
];

export async function publicInfo() {
  const segments = await pontual.segments().catch(() => []);

  return {
    signup_enabled: config.signup.enabled,
    trial_days: config.signup.trialDays,
    price_cents: config.signup.priceCents,
    base_domain: config.baseDomain,
    support_whatsapp: config.supportWhatsapp || null,
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

