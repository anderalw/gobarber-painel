import { addDays, format, formatDistanceToNow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import type { Runtime, Status, TenantView } from './api';

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
export function situation(tenant: Pick<TenantView, 'status' | 'runtime' | 'busy' | 'last_operation'>): {
  label: string;
  tone: Tone;
} {
  if (tenant.busy) {
    return { label: `${tenant.last_operation || 'Em andamento'}...`, tone: 'primary' };
  }

  const byStatus: Partial<Record<Status, { label: string; tone: Tone }>> = {
    provisioning: { label: 'Preparando', tone: 'primary' },
    suspended: { label: 'Suspensa', tone: 'neutral' },
    error: { label: 'Falhou ao criar', tone: 'danger' },
  };

  if (byStatus[tenant.status]) return byStatus[tenant.status] as { label: string; tone: Tone };

  const byRuntime: Record<Runtime, { label: string; tone: Tone }> = {
    online: { label: 'No ar', tone: 'success' },
    starting: { label: 'Iniciando', tone: 'primary' },
    partial: { label: 'Com problema', tone: 'danger' },
    stopped: { label: 'Parada', tone: 'danger' },
    absent: { label: 'Sem ambiente', tone: 'danger' },
  };

  return byRuntime[tenant.runtime];
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

export const TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'Brasília (SP, RJ, MG, Sul, NE...)' },
  { value: 'America/Manaus', label: 'Amazonas (Manaus)' },
  { value: 'America/Cuiaba', label: 'Mato Grosso (Cuiabá)' },
  { value: 'America/Campo_Grande', label: 'Mato Grosso do Sul' },
  { value: 'America/Porto_Velho', label: 'Rondônia' },
  { value: 'America/Boa_Vista', label: 'Roraima' },
  { value: 'America/Rio_Branco', label: 'Acre' },
  { value: 'America/Noronha', label: 'Fernando de Noronha' },
];

export const METHODS: Record<string, string> = {
  pix: 'Pix',
  boleto: 'Boleto',
  cartao: 'Cartão',
  transferencia: 'Transferência',
  dinheiro: 'Dinheiro',
};
