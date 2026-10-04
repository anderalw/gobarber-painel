import { addDays, format, formatDistanceToNow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import type { Status, TenantView } from './api';

export const money = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// "99,90" -> 9990; null se inválido
export function parseMoney(text: string): number | null {
  const clean = text.replace(/[R$\s.]/g, '').replace(',', '.');

  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;

  return Math.round(Number(clean) * 100);
}

export const day = (iso: string): string => format(parseISO(iso), 'dd/MM/yyyy');

// "pago até" é exclusivo: o último dia pago é a véspera
export const lastPaidDay = (paidUntil: string): string =>
  format(addDays(parseISO(paidUntil), -1), 'dd/MM/yyyy');

export const ago = (iso: string): string =>
  formatDistanceToNow(parseISO(iso), { locale: ptBR, addSuffix: true });

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'primary';

// Situação do sistema da barbearia (o que o cliente dela vê)
export function situation(tenant: Pick<TenantView, 'status'>): {
  label: string;
  tone: Tone;
} {
  const byStatus: Record<Status, { label: string; tone: Tone }> = {
    active: { label: 'No ar', tone: 'success' },
    suspended: { label: 'Suspensa', tone: 'neutral' },
    legacy: { label: 'Modelo antigo', tone: 'warning' },
  };

  return byStatus[tenant.status];
}

export function billingLabel(tenant: Pick<TenantView, 'billing'>): {
  label: string;
  tone: Tone;
} {
  const { state, days } = tenant.billing;

  if (state === 'late') {
    return {
      label: days === 0 ? 'Vence hoje' : `Atrasada há ${days} ${days === 1 ? 'dia' : 'dias'}`,
      tone: 'danger',
    };
  }

  if (state === 'due') {
    return { label: days === 1 ? 'Vence amanhã' : `Vence em ${days} dias`, tone: 'warning' };
  }

  return { label: 'Em dia', tone: 'success' };
}

export const METHODS: Record<string, string> = {
  pix: 'Pix',
  boleto: 'Boleto',
  cartao: 'Cartão',
  transferencia: 'Transferência',
  dinheiro: 'Dinheiro',
};

// Nome de cada ramo de negócio (os mesmos da API)
export const SEGMENT_NAMES: Record<string, string> = {
  barbershop: 'Barbearia',
  beauty: 'Salão de beleza / estética',
  tattoo: 'Estúdio de tatuagem',
  physio: 'Fisioterapia',
  clinic: 'Consultório',
};

export function segmentName(key?: string): string {
  return SEGMENT_NAMES[key || 'barbershop'] || key || 'Barbearia';
}
