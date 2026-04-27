const QUIT_ALIASES = new Set(['quit', 'exit', ':q']);

export function isQuitAlias(input: string): boolean {
  return QUIT_ALIASES.has(input.trim().toLowerCase());
}
