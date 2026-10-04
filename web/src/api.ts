// Chamadas ao servidor do painel (mesma origem, cookie de sessão)

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });

  if (response.status === 204) return undefined as T;

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(data.message || 'Algo deu errado. Tente de novo.', response.status);
  }

  return data as T;
}

export type Status = 'active' | 'suspended' | 'legacy';

export interface Metrics {
  generated_at: string;
  providers: number;
  clients: number;
  last_30_days: {
    appointments: number;
    completed: number;
    no_show: number;
    revenue_cents: number;
  };
  upcoming_appointments: number;
  active_members: number;
  last_activity: string | null;
}

export interface TenantView {
  id: string;
  slug: string;
  name: string;
  // Ramo de negócio (barbershop, tattoo...)
  segment: string;
  // Endereço principal (o domínio próprio ou o subdomínio)
  domain: string;
  custom_domain: string | null;
  subdomain: string;
  url: string;
  admin_name: string;
  admin_email: string;
  monthly_price_cents: number;
  paid_until: string;
  billing: { state: 'ok' | 'due' | 'late'; days: number };
  status: Status;
  // 'import': de um backup (logins de antes); 'found': já estava na API;
  // 'signup': cadastro pela página de divulgação (teste grátis)
  origin: 'new' | 'import' | 'found' | 'signup';
  admin_phone: string | null;
  has_initial_password: boolean;
  notes: string | null;
  metrics: Metrics | null;
  metrics_at: string | null;
  created_at: string;
}

export interface TenantDetails extends TenantView {
  payments: Array<{
    id: string;
    amount_cents: number;
    method: string;
    period_start: string;
    period_end: string;
    paid_at: string;
    note: string | null;
  }>;
}

export interface Overview {
  summary: {
    total: number;
    active: number;
    suspended: number;
    late: number;
    monthly_cents: number;
  };
  tenants: TenantView[];
}

export interface Me {
  email: string;
  base_domain: string;
}
