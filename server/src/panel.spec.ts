import { describe, expect, it } from 'vitest';

import { billingState, nextPeriod, trialUntil } from './billing';
import { buildCaddyfile } from './caddyfile';
import { envFile, envValue, slugify } from './text';
import type { Config } from './config';

const base = {
  tls: 'off',
  acmeEmail: '',
  panelDomain: '',
  panelUpstream: 'panel:4000',
} as Config;

describe('identificador e .env', () => {
  it('should turn a name into a slug', () => {
    expect(slugify('Barbearia do Zé!')).toBe('barbearia-do-ze');
    expect(slugify('  --Corte & Cia--  ')).toBe('corte-cia');
    expect(slugify('a'.repeat(40))).toHaveLength(30);
  });

  it('should quote .env values without interpolation', () => {
    expect(envValue('João D"Ávila')).toBe('"João D\\"Ávila"');
    // "$" viraria variável no compose
    expect(envValue('senha$123')).toBe('"senha$$123"');
    expect(envFile({ A: '1', B: 'dois' })).toBe('A="1"\nB="dois"\n');
  });
});

describe('cobrança', () => {
  const today = new Date(2026, 8, 30);

  it('should tell when the fee is due or late', () => {
    expect(billingState('2026-10-30', today)).toEqual({ state: 'ok', days: 30 });
    expect(billingState('2026-10-03', today)).toEqual({ state: 'due', days: 3 });
    // Pago até 29/09 (exclusivo 30/09): hoje já é atraso
    expect(billingState('2026-09-30', today)).toEqual({ state: 'late', days: 0 });
    expect(billingState('2026-09-20', today)).toEqual({ state: 'late', days: 10 });
  });

  it('should extend from the paid date or restart when late', () => {
    expect(nextPeriod('2026-10-05', today)).toEqual({
      start: '2026-10-05',
      end: '2026-11-05',
    });
    expect(nextPeriod('2026-09-10', today)).toEqual({
      start: '2026-09-30',
      end: '2026-10-30',
    });
    expect(trialUntil(today, 7)).toBe('2026-10-07');
  });
});

describe('Caddyfile', () => {
  it('should route each shop to its site, or show a notice', () => {
    const file = buildCaddyfile(
      [
        { project: 'gb-ze', domain: 'ze.localhost', status: 'active' },
        { project: 'gb-cia', domain: 'cia.localhost', status: 'suspended' },
        { project: 'gb-novo', domain: 'novo.localhost', status: 'provisioning' },
      ],
      base,
    );

    expect(file).toContain('admin 0.0.0.0:2019');
    expect(file).toContain('auto_https off');
    expect(file).toContain('http://ze.localhost {\n\treverse_proxy gb-ze-web-1:80\n}');
    expect(file).toMatch(/http:\/\/cia\.localhost \{[\s\S]*indisponível[\s\S]*503/);
    expect(file).toMatch(/http:\/\/novo\.localhost \{[\s\S]*preparando/);
    // Qualquer outro endereço
    expect(file).toContain(':80 {');
  });

  it('should use automatic HTTPS with real domains', () => {
    const file = buildCaddyfile(
      [{ project: 'gb-ze', domain: 'ze.pontual.app', status: 'active' }],
      {
        ...base,
        tls: 'auto',
        acmeEmail: 'eu@pontual.app',
        panelDomain: 'painel.pontual.app',
      },
    );

    expect(file).not.toContain('auto_https off');
    expect(file).toContain('email eu@pontual.app');
    expect(file).toContain('ze.pontual.app {');
    expect(file).toContain('painel.pontual.app {\n\treverse_proxy panel:4000\n}');
    expect(file).not.toContain(':80 {');
  });
});
