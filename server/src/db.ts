import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

import { config } from './config';

// 'legacy': do tempo em que cada barbearia tinha os próprios contêineres e
// ainda não está na API (importe o backup dela)
export type TenantStatus = 'active' | 'suspended' | 'legacy';

export interface Tenant {
  id: string;
  // Id da barbearia na API do Pontual (vazio nas antigas)
  api_id: string | null;
  slug: string;
  name: string;
  // Endereço principal: o domínio próprio ou <slug>.<BASE_DOMAIN>
  domain: string;
  custom_domain: string | null;
  admin_name: string;
  admin_email: string;
  // Senha criada com a barbearia (o cliente pode ter trocado)
  initial_password: string | null;
  timezone: string;
  monthly_price_cents: number;
  // 'yyyy-MM-dd', exclusivo: pago até a véspera
  paid_until: string;
  status: TenantStatus;
  notes: string | null;
  metrics_json: string | null;
  metrics_at: string | null;
  // 'new': criada vazia; 'import': a partir de um backup; 'found': já
  // existia na API (ex.: a barbearia da instalação de antes)
  origin: 'new' | 'import' | 'found';
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  tenant_id: string;
  amount_cents: number;
  method: string;
  period_start: string;
  period_end: string;
  paid_at: string;
  note: string | null;
}

fs.mkdirSync(config.dataDir, { recursive: true });

// Banco do painel: poucas linhas, um arquivo SQLite (embutido no Node)
export const db = new DatabaseSync(path.join(config.dataDir, 'painel.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    domain TEXT NOT NULL UNIQUE,
    admin_name TEXT NOT NULL,
    admin_email TEXT NOT NULL,
    timezone TEXT NOT NULL,
    monthly_price_cents INTEGER NOT NULL,
    paid_until TEXT NOT NULL,
    status TEXT NOT NULL,
    notes TEXT,
    metrics_json TEXT,
    metrics_at TEXT,
    last_operation TEXT,
    last_log TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    method TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    paid_at TEXT NOT NULL,
    note TEXT
  );
`);

// Colunas adicionadas depois da primeira versão
const columns = (db.prepare('PRAGMA table_info(tenants)').all() as Array<{ name: string }>).map(
  column => column.name,
);

const added: Record<string, string> = {
  origin: "TEXT NOT NULL DEFAULT 'new'",
  import_id: 'TEXT',
  api_id: 'TEXT',
  custom_domain: 'TEXT',
  initial_password: 'TEXT',
};

Object.entries(added).forEach(([name, definition]) => {
  if (!columns.includes(name)) {
    db.exec(`ALTER TABLE tenants ADD COLUMN ${name} ${definition}`);
  }
});

// Barbearias do tempo dos contêineres separados (preparando, com erro...)
// ainda sem lugar na API
db.exec(
  "UPDATE tenants SET status = 'legacy' WHERE api_id IS NULL AND status NOT IN ('legacy')",
);
