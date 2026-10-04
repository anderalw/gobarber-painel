import fs from 'fs';
import path from 'path';

// .env ao lado do package.json (em produção, as variáveis vêm do Docker)
if (fs.existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;

function required(name: string): string {
  const value = env[name];

  if (!value) {
    throw new Error(`${name} não definido: configure no .env (ver .env.example).`);
  }

  return value;
}

export const config = {
  port: Number(env.PORT || 4000),

  // Único acesso ao painel: o dono do SaaS
  panelEmail: required('PANEL_EMAIL').toLowerCase(),
  panelPassword: required('PANEL_PASSWORD'),
  sessionSecret: required('SESSION_SECRET'),

  // Banco do painel (cobrança, anotações) e os backups gerados
  dataDir: path.resolve(env.DATA_DIR || 'data'),

  // API do Pontual (uma só para todas as barbearias) e o token da
  // plataforma (o mesmo PLATFORM_TOKEN da API)
  pontualApi: (env.PONTUAL_API || 'http://localhost:3333').replace(/\/+$/, ''),
  platformToken: required('PLATFORM_TOKEN'),

  // Endereço das barbearias: <slug>.<BASE_DOMAIN> (o mesmo da API)
  baseDomain: env.BASE_DOMAIN || 'localhost',
  // Como os links abrem: https://{host} no servidor; no computador, por
  // exemplo, http://{host}:3000 (o Vite) ou http://{host} (o Caddy local)
  siteUrl: env.SITE_URL || 'https://{host}',

  // Página de divulgação do produto (e www.): o domínio principal
  siteDomain: (env.SITE_DOMAIN || env.BASE_DOMAIN || 'localhost').toLowerCase(),

  // Cadastro pela página: dias de teste, mensalidade depois e se o
  // negócio é suspenso quando o teste acaba sem pagamento
  signup: {
    enabled: env.SIGNUP_ENABLED !== 'false',
    trialDays: Number(env.SIGNUP_TRIAL_DAYS || 7),
    priceCents: Number(env.SIGNUP_PRICE_CENTS || 9900),
    autoSuspend: env.TRIAL_AUTO_SUSPEND !== 'false',
  },

  // WhatsApp de contato (com DDI, só números) para quem quer continuar
  supportWhatsapp: (env.SUPPORT_WHATSAPP || '').replace(/\D/g, ''),
};

export type Config = typeof config;
