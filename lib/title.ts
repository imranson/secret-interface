export const MAX_TITLE_LENGTH = 60

/** Derives a sidebar title from the first user message: first line, Markdown stripped, truncated. */
export function deriveTitle(text: string, max: number = MAX_TITLE_LENGTH): string {
  const firstLine =
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  const plain = firstLine
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return 'New conversation'
  if (plain.length <= max) return plain
  return `${plain.slice(0, max - 1).trimEnd()}…`
}
