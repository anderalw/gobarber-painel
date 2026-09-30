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

  // Banco do painel e as pastas de cada barbearia (compose + .env)
  dataDir: path.resolve(env.DATA_DIR || 'data'),

  // Endereço padrão das barbearias: <slug>.<BASE_DOMAIN>
  baseDomain: env.BASE_DOMAIN || 'localhost',
  // 'auto': HTTPS automático (domínio de verdade); 'off': só HTTP (testes)
  tls: (env.TLS === 'auto' ? 'auto' : 'off') as 'auto' | 'off',
  // Porta pública do Caddy no modo 'off' (entra nos links: :8081)
  publicHttpPort: Number(env.PUBLIC_HTTP_PORT || 80),
  acmeEmail: env.ACME_EMAIL || '',
  // Painel servido pelo próprio Caddy (ex.: painel.minhaempresa.com.br)
  panelDomain: env.PANEL_DOMAIN || '',
  panelUpstream: env.PANEL_UPSTREAM || 'panel:4000',

  // API de administração do Caddy e a rede que ele divide com os sites
  caddyAdmin: env.CADDY_ADMIN || 'http://127.0.0.1:2019',
  edgeNetwork: env.EDGE_NETWORK || 'gobarber-edge',

  // Imagens publicadas pelo GitHub Actions do Pontual
  apiImage: env.API_IMAGE || 'ghcr.io/anderalw/pontual-api:latest',
  webImage: env.WEB_IMAGE || 'ghcr.io/anderalw/pontual-web:latest',
  // false: usa só as imagens que já estão na máquina (testes locais)
  pullImages: env.PULL_IMAGES !== 'false',
};

export type Config = typeof config;
