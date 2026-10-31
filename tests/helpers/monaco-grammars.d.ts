// Monaco's Monarch grammars ship without type declarations; the theme test reads their tokenizers.
declare module 'monaco-editor/languages/definitions/*' {
  export const language: { tokenizer: Record<string, unknown[]> };
}
