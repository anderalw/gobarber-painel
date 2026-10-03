import { describe, expect, it } from 'vitest';

import { billingState, nextPeriod, trialUntil } from './billing';
import { slugify } from './text';

describe('identificador', () => {
  it('should turn a name into a slug', () => {
    expect(slugify('Barbearia do Zé!')).toBe('barbearia-do-ze');
    expect(slugify('  --Corte & Cia--  ')).toBe('corte-cia');
    expect(slugify('a'.repeat(40))).toHaveLength(30);
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
