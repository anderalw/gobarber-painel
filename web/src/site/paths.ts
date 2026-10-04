// Endereços da página de divulgação: no domínio principal ficam na raiz;
// em desenvolvimento, embaixo de /divulgacao
const base = (): string =>
  window.location.pathname.startsWith('/divulgacao') ? '/divulgacao' : '';

export const homePath = (): string => base() || '/';

// Área do cliente (conta e dados do negócio)
export const accountPath = (): string => `${base()}/conta`;

export const isAccountPage = (): boolean => /\/conta\/?$/.test(window.location.pathname);
