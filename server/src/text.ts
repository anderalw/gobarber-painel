// Funções de texto sem dependências (testadas à parte)

// "Barbearia do Zé" -> "barbearia-do-ze"
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    // Tira os acentos (separados pelo NFD)
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
}

// Valor para o .env do compose: entre aspas, sem interpolar "$"
export function envValue(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '$$$$')}"`;
}

export function envFile(values: Record<string, string>): string {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${envValue(value)}`)
    .join('\n')}\n`;
}
