import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

// Formato de backup do Pontual (o mesmo do scripts/exportar-backup.mjs do
// backend): .tar.gz com manifest.json, postgres.sql, mongo.archive
// (opcional) e files/ (fotos)

export interface Manifest {
  format: 'gobarber-backup';
  version: number;
  created_at: string;
  source?: string;
  // Segredo do sistema de origem: mantém a maquininha e o WhatsApp
  // conectados (as credenciais ficam cifradas com ele)
  app_secret?: string;
}

export interface BackupSummary {
  created_at: string;
  has_mongo: boolean;
  files: number;
  has_secret: boolean;
  size_bytes: number;
}

// O tar recebe só caminhos relativos (com cwd): o GNU tar do Git Bash
// confundiria "C:\..." com um servidor remoto
function tar(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, error => {
      if (error) reject(new Error(`tar falhou: ${error.message}`));
      else resolve();
    });
  });
}

export async function extract(archive: string, destination: string): Promise<void> {
  fs.mkdirSync(destination, { recursive: true });

  await tar(
    ['-xzf', path.relative(destination, archive).split(path.sep).join('/'), '-C', '.'],
    destination,
  );
}

export async function pack(source: string, archive: string): Promise<void> {
  await tar(
    ['-czf', path.relative(source, archive).split(path.sep).join('/'), '.'],
    source,
  );
}

// Confere o conteúdo extraído e resume o que tem
export function inspect(directory: string, sizeBytes: number): {
  manifest: Manifest;
  summary: BackupSummary;
} {
  const manifestFile = path.join(directory, 'manifest.json');

  if (!fs.existsSync(manifestFile)) {
    throw new Error('Arquivo não é um backup do Pontual (falta o manifest.json).');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Manifest;

  if (manifest.format !== 'gobarber-backup' || manifest.version !== 1) {
    throw new Error('Formato de backup não reconhecido.');
  }

  if (!fs.existsSync(path.join(directory, 'postgres.sql'))) {
    throw new Error('O backup não tem o banco principal (postgres.sql).');
  }

  const filesDir = path.join(directory, 'files');

  return {
    manifest,
    summary: {
      created_at: manifest.created_at,
      has_mongo: fs.existsSync(path.join(directory, 'mongo.archive')),
      files: fs.existsSync(filesDir) ? fs.readdirSync(filesDir).length : 0,
      has_secret: !!manifest.app_secret,
      size_bytes: sizeBytes,
    },
  };
}
