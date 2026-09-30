import { Config } from './config';
import { TenantStatus } from './db';

export interface Site {
  project: string;
  domain: string;
  status: TenantStatus;
}

// Página simples para quando o site não pode abrir
function page(title: string, text: string, status: number): string {
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#111214;color:#e8e8ea;font-family:system-ui,sans-serif;text-align:center"><div><h1 style="font-size:22px">${title}</h1><p style="color:#9a9aa3">${text}</p></div></body></html>`;

  return [
    '\theader Content-Type "text/html; charset=utf-8"',
    `\trespond \`${html}\` ${status}`,
  ].join('\n');
}

// Endereço como o Caddy entende: no modo sem TLS, só HTTP
function address(domain: string, config: Config): string {
  return config.tls === 'off' ? `http://${domain}` : domain;
}

// Caddyfile completo: cada barbearia no seu domínio, apontando para o
// contêiner do site dela (na rede compartilhada). Suspensa ou em preparação
// mostra um aviso no lugar do site
export function buildCaddyfile(sites: Site[], config: Config): string {
  const global = [
    '{',
    // O painel recarrega a configuração por aqui (não fica exposto fora)
    '\tadmin 0.0.0.0:2019 {',
    '\t\torigins 127.0.0.1:2019 localhost:2019 caddy:2019',
    '\t}',
  ];

  if (config.tls === 'off') global.push('\tauto_https off');
  if (config.tls === 'auto' && config.acmeEmail) {
    global.push(`\temail ${config.acmeEmail}`);
  }

  global.push('}');

  const blocks = sites.map(site => {
    let body: string;

    if (site.status === 'suspended') {
      body = page(
        'Sistema temporariamente indisponível',
        'Entre em contato com o suporte do Pontual.',
        503,
      );
    } else if (site.status === 'provisioning') {
      body = page(
        'Estamos preparando o seu sistema',
        'Em alguns minutos ele estará no ar.',
        503,
      );
    } else {
      body = `\treverse_proxy ${site.project}-web-1:80`;
    }

    return `${address(site.domain, config)} {\n${body}\n}`;
  });

  if (config.panelDomain) {
    blocks.push(
      `${address(config.panelDomain, config)} {\n\treverse_proxy ${config.panelUpstream}\n}`,
    );
  }

  // Sem TLS, qualquer outro endereço cai numa resposta curta
  if (config.tls === 'off') {
    blocks.push(`:80 {\n${page('Pontual', 'Endereço não encontrado.', 404)}\n}`);
  }

  return `${[global.join('\n'), ...blocks].join('\n\n')}\n`;
}

// Aplica a configuração no Caddy (sem derrubar as conexões)
export async function loadCaddyfile(
  caddyfile: string,
  config: Config,
): Promise<void> {
  const response = await fetch(`${config.caddyAdmin}/load`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/caddyfile',
      // A administração do Caddy só aceita as origens listadas no "admin"
      Origin: new URL(config.caddyAdmin).origin,
    },
    body: caddyfile,
  });

  if (!response.ok) {
    throw new Error(`Caddy recusou a configuração: ${await response.text()}`);
  }
}
