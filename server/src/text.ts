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
