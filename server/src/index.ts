/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { NextFunction, Request, Response } from 'express';

import { config } from './config';
import { ensureNetwork } from './docker';
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
  cleanOldImports,
  listBackups,
  receiveImport,
  createTenant,
  details,
  editTenant,
  findTenant,
  initialPassword,
  overview,
  recoverInterrupted,
  refreshAllMetrics,
  refreshMetrics,
  registerPayment,
  removeTenant,
  reprovision,
  resume,
  suspend,
  syncCaddy,
  upgrade,
} from './tenants';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '..', '..', 'web', 'dist');

// Uso de cada barbearia: atualiza de tempos em tempos
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
    tls: config.tls,
    public_port: config.publicHttpPort,
    api_image: config.apiImage,
    web_image: config.webImage,
  });
});

api.use(requireAuth);

// Backup para importar: o arquivo vem cru no corpo (até 2 GB)
api.post(
  '/imports',
  handle(async (request, response) =>
    response.status(201).json(await receiveImport(request, 2 * 1024 * 1024 * 1024)),
  ),
);

api.get('/overview', handle(async (request, response) => response.json(await overview())));

api.post(
  '/tenants',
  handle((request, response) => {
    const body = request.body || {};

    return response.status(201).json(
      createTenant({
        name: String(body.name || ''),
        slug: body.slug ? String(body.slug) : undefined,
        domain: body.domain ? String(body.domain) : undefined,
        admin_name: String(body.admin_name || ''),
        admin_email: String(body.admin_email || ''),
        timezone: String(body.timezone || 'America/Sao_Paulo'),
        monthly_price_cents: Number(body.monthly_price_cents),
        trial_days: Number(body.trial_days ?? 7),
        notes: body.notes ? String(body.notes) : null,
        import_id: body.import_id ? String(body.import_id) : null,
      }),
    );
  }),
);

api.get(
  '/tenants/:id',
  handle(async (request, response) => response.json(await details(request.params.id))),
);

api.put(
  '/tenants/:id',
  handle(async (request, response) => {
    const body = request.body || {};

    editTenant(request.params.id, {
      name: String(body.name || ''),
      monthly_price_cents: Number(body.monthly_price_cents),
      notes: body.notes ? String(body.notes) : null,
    });

    return response.json(await details(request.params.id));
  }),
);

const actions: Record<string, (id: string) => void> = {
  suspend,
  resume,
  upgrade,
  retry: reprovision,
};

api.post(
  '/tenants/:id/:action(suspend|resume|upgrade|retry)',
  handle(async (request, response) => {
    actions[request.params.action](request.params.id);

    return response.status(202).json(await details(request.params.id));
  }),
);

api.post(
  '/tenants/:id/metrics',
  handle(async (request, response) => {
    await refreshMetrics(findTenant(request.params.id));

    return response.json(await details(request.params.id));
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

    return response.status(201).json(await details(request.params.id));
  }),
);

api.post(
  '/tenants/:id/backup',
  handle(async (request, response) => {
    backupTenant(request.params.id);

    return response.status(202).json(await details(request.params.id));
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
    await removeTenant(request.params.id, request.query.purge === '1');

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
  recoverInterrupted();
  cleanOldImports();
  await ensureNetwork(config.edgeNetwork);

  // Aplica os endereços no Caddy (se ele ainda não subiu, tenta de novo depois)
  await syncCaddy().catch(err =>
    console.warn(`Caddy ainda indisponível: ${err.message}`),
  );

  app.listen(config.port, () => {
    console.log(`Painel Pontual em http://localhost:${config.port}`);
  });

  setInterval(() => {
    refreshAllMetrics().catch(() => undefined);
    syncCaddy().catch(() => undefined);
  }, METRICS_INTERVAL_MS);
}

start().catch(err => {
  console.error('Não foi possível iniciar o painel:', err);
  process.exit(1);
});
