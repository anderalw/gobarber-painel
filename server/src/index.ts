/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { NextFunction, Request, Response } from 'express';

import { config } from './config';
import {
  checkLogin,
  clearSessionCookie,
  isAuthenticated,
  requireAuth,
  setSessionCookie,
} from './auth';
import {
  PanelError,
  backupFile,
  backupTenant,
  listBackups,
  createTenant,
  details,
  editTenant,
  findTenant,
  importTenant,
  initialPassword,
  overview,
  refreshAllMetrics,
  refreshMetrics,
  registerPayment,
  removeTenant,
  resume,
  setDomain,
  suspend,
  syncWithApi,
} from './tenants';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '..', '..', 'web', 'dist');

// Uso de cada barbearia e a lista da API: atualiza de tempos em tempos
const METRICS_INTERVAL_MS = 15 * 60 * 1000;

const app = express();

// Atrás do Caddy: o IP do cliente vem no X-Forwarded-For
app.set('trust proxy', 1);
app.use(express.json());

type Handler = (request: Request, response: Response) => Promise<unknown> | unknown;

// Erros viram JSON com a mensagem (PanelError) ou 500
const handle =
  (fn: Handler) =>
  (request: Request, response: Response, next: NextFunction): void => {
    Promise.resolve(fn(request, response)).catch(next);
  };

const api = express.Router();

api.post(
  '/login',
  handle((request, response) => {
    const { email = '', password = '' } = request.body || {};
    const result = checkLogin(request.ip || '', String(email), String(password));

    if (result === 'locked') {
      throw new PanelError(
        'Muitas tentativas. Espere alguns minutos e tente de novo.',
        429,
      );
    }

    if (result === 'invalid') throw new PanelError('E-mail ou senha incorretos.', 401);

    setSessionCookie(request, response);

    return response.json({ email: config.panelEmail });
  }),
);

api.post('/logout', (request, response) => {
  clearSessionCookie(response);
  response.status(204).send();
});

api.get('/me', (request, response) => {
  if (!isAuthenticated(request)) {
    response.status(401).json({ message: 'Entre no painel.' });
    return;
  }

  response.json({
    email: config.panelEmail,
    base_domain: config.baseDomain,
  });
});

api.use(requireAuth);

api.get(
  '/overview',
  handle(async (request, response) => {
    // Pega o que mudou na API (sem ela, mostra o que o painel já sabe)
    await syncWithApi().catch(() => undefined);

    return response.json(overview());
  }),
);

// Nova barbearia a partir de um backup: o arquivo vem cru no corpo e vai
// direto para a API; a cobrança vem na query
api.post(
  '/tenants/import',
  handle(async (request, response) => {
    const query = request.query as Record<string, string | undefined>;

    return response.status(201).json(
      await importTenant(request, {
        name: query.name,
        slug: query.slug,
        monthly_price_cents: Number(query.monthly_price_cents),
        trial_days: Number(query.trial_days ?? 7),
        notes: query.notes || null,
      }),
    );
  }),
);

api.post(
  '/tenants',
  handle(async (request, response) => {
    const body = request.body || {};

    return response.status(201).json(
      await createTenant({
        name: String(body.name || ''),
        slug: body.slug ? String(body.slug) : undefined,
        custom_domain: body.custom_domain ? String(body.custom_domain) : null,
        admin_name: String(body.admin_name || ''),
        admin_email: String(body.admin_email || ''),
        monthly_price_cents: Number(body.monthly_price_cents),
        trial_days: Number(body.trial_days ?? 7),
        notes: body.notes ? String(body.notes) : null,
      }),
    );
  }),
);

api.get(
  '/tenants/:id',
  handle((request, response) => response.json(details(request.params.id))),
);

api.put(
  '/tenants/:id',
  handle(async (request, response) => {
    const body = request.body || {};

    await editTenant(request.params.id, {
      name: String(body.name || ''),
      monthly_price_cents: Number(body.monthly_price_cents),
      notes: body.notes ? String(body.notes) : null,
    });

    return response.json(details(request.params.id));
  }),
);

const actions: Record<string, (id: string) => Promise<void>> = {
  suspend,
  resume,
};

api.post(
  '/tenants/:id/:action(suspend|resume)',
  handle(async (request, response) => {
    await actions[request.params.action](request.params.id);

    return response.json(details(request.params.id));
  }),
);

// Domínio próprio da barbearia (vazio: só o subdomínio)
api.put(
  '/tenants/:id/domain',
  handle(async (request, response) => {
    const domain = request.body?.custom_domain;

    await setDomain(request.params.id, domain ? String(domain) : null);

    return response.json(details(request.params.id));
  }),
);

api.post(
  '/tenants/:id/metrics',
  handle(async (request, response) => {
    await refreshMetrics(findTenant(request.params.id));

    return response.json(details(request.params.id));
  }),
);

api.post(
  '/tenants/:id/payments',
  handle(async (request, response) => {
    const body = request.body || {};

    registerPayment(request.params.id, {
      amount_cents:
        body.amount_cents === null || body.amount_cents === undefined
          ? null
          : Number(body.amount_cents),
      method: String(body.method || ''),
      note: body.note ? String(body.note) : null,
    });

    return response.status(201).json(details(request.params.id));
  }),
);

api.post(
  '/tenants/:id/backup',
  handle(async (request, response) => {
    const name = await backupTenant(request.params.id);

    return response.status(201).json({ name });
  }),
);

api.get(
  '/tenants/:id/backups',
  handle((request, response) => response.json(listBackups(request.params.id))),
);

api.get(
  '/tenants/:id/backups/:name',
  handle((request, response) => {
    response.download(backupFile(request.params.id, request.params.name));
  }),
);

api.get(
  '/tenants/:id/initial-password',
  handle((request, response) =>
    response.json({ password: initialPassword(request.params.id) }),
  ),
);

api.delete(
  '/tenants/:id',
  handle(async (request, response) => {
    await removeTenant(request.params.id);

    return response.status(204).send();
  }),
);

app.use('/api', api);

// Tela (build do Vite); em desenvolvimento quem serve é o próprio Vite
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get('*', (request, response) => {
    response.sendFile(path.join(webDist, 'index.html'));
  });
}

app.use((err: unknown, request: Request, response: Response, _next: NextFunction) => {
  if (err instanceof PanelError) {
    response.status(err.status).json({ message: err.message });
    return;
  }

  console.error(err);
  response.status(500).json({ message: 'Erro inesperado no painel.' });
});

async function start(): Promise<void> {
  // Confere a lista com a API (se ela ainda não subiu, tenta de novo depois)
  await syncWithApi().catch(err =>
    console.warn(`API do Pontual ainda indisponível: ${err.message}`),
  );

  app.listen(config.port, () => {
    console.log(`Painel Pontual em http://localhost:${config.port}`);
  });

  setInterval(() => {
    syncWithApi()
      .then(refreshAllMetrics)
      .catch(() => undefined);
  }, METRICS_INTERVAL_MS);
}

start().catch(err => {
  console.error('Não foi possível iniciar o painel:', err);
  process.exit(1);
});
