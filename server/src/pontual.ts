import { Readable } from 'stream';

import { config } from './config';

// Cliente das rotas da plataforma na API do Pontual (/internal). É lá que
// as barbearias existem; o painel guarda a cobrança e as anotações

export class PontualError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface ApiTenant {
  id: string;
  slug: string;
  name: string;
  custom_domain: string | null;
  status: 'active' | 'suspended';
  host: string;
  created_at: string;
  admin?: { name: string; email: string } | null;
}

export interface Metrics {
  generated_at: string;
  providers: number;
  providers_total: number;
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

async function call(
  path: string,
  options: { method?: string; body?: unknown; raw?: Readable | Buffer; query?: Record<string, string> } = {},
): Promise<Response> {
  const query = options.query ? `?${new URLSearchParams(options.query)}` : '';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.platformToken}`,
  };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.raw) headers['Content-Type'] = 'application/gzip';

  let response: Response;

  try {
    response = await fetch(`${config.pontualApi}/internal${path}${query}`, {
      method: options.method || 'GET',
      headers,
      body:
        options.raw ??
        (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      // Corpo em stream (o backup) precisa disso no fetch do Node
      ...(options.raw ? { duplex: 'half' } : {}),
    } as RequestInit);
  } catch {
    throw new PontualError('A API do Pontual não respondeu. Ela está no ar?', 502);
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string };

    throw new PontualError(
      data.message || `A API do Pontual recusou (${response.status}).`,
      response.status === 401 ? 502 : response.status,
    );
  }

  return response;
}

async function json<T>(
  path: string,
  options?: Parameters<typeof call>[1],
): Promise<T> {
  const response = await call(path, options);

  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const pontual = {
  list: () => json<ApiTenant[]>('/tenants'),

  show: (id: string) => json<ApiTenant>(`/tenants/${id}`),

  create: (data: {
    slug: string;
    name: string;
    custom_domain?: string | null;
    admin: { name: string; email: string; password: string };
  }) => json<ApiTenant>('/tenants', { method: 'POST', body: data }),

  update: (
    id: string,
    data: { name?: string; custom_domain?: string | null; status?: 'active' | 'suspended' },
  ) => json<ApiTenant>(`/tenants/${id}`, { method: 'PATCH', body: data }),

  remove: (id: string) => json<void>(`/tenants/${id}`, { method: 'DELETE' }),

  metrics: (id: string) => json<Metrics>(`/tenants/${id}/metrics`),

  // Backup da barbearia (.tar.gz) como stream
  async export(id: string): Promise<ReadableStream<Uint8Array>> {
    const response = await call(`/tenants/${id}/export`);

    if (!response.body) throw new PontualError('Backup vazio.', 502);

    return response.body;
  },

  import: (archive: Readable | Buffer, options: { slug?: string; name?: string }) =>
    json<ApiTenant>('/tenants/import', {
      method: 'POST',
      raw: archive,
      query: Object.fromEntries(
        Object.entries(options).filter(([, value]) => !!value),
      ) as Record<string, string>,
    }),
};
