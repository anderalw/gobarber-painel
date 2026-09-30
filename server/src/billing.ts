import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from 'date-fns';

// Mensalidade que a barbearia paga pelo sistema

export type BillingState = 'ok' | 'due' | 'late';

// Com quantos dias de antecedência aparece como "vence logo"
export const DUE_SOON_DAYS = 5;

export const toDay = (date: Date): string => format(date, 'yyyy-MM-dd');

// paidUntil é exclusivo: o último dia pago é a véspera
export function billingState(
  paidUntil: string,
  today: Date,
): { state: BillingState; days: number } {
  const days = differenceInCalendarDays(parseISO(paidUntil), today);

  if (days <= 0) return { state: 'late', days: Math.max(0, -days) };
  if (days <= DUE_SOON_DAYS) return { state: 'due', days };

  return { state: 'ok', days };
}

// Período que um pagamento cobre: emenda no anterior; atrasado, a partir
// de hoje (o tempo em atraso não é cobrado de novo)
export function nextPeriod(
  paidUntil: string,
  today: Date,
): { start: string; end: string } {
  const current = parseISO(paidUntil);
  const start = current > today ? current : today;

  return { start: toDay(start), end: toDay(addMonths(start, 1)) };
}

export function trialUntil(today: Date, trialDays: number): string {
  return toDay(addDays(today, trialDays));
}
