import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

import { config } from './config';

export type TenantStatus =
  | 'provisioning'
  | 'active'
  | 'suspended'
  | 'error';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  domain: string;
  admin_name: string;
  admin_email: string;
  timezone: string;
  monthly_price_cents: number;
  // 'yyyy-MM-dd', exclusivo: pago até a véspera
  paid_until: string;
  status: TenantStatus;
  notes: string | null;
  metrics_json: string | null;
  metrics_at: string | null;
  last_operation: string | null;
  last_log: string | null;
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
