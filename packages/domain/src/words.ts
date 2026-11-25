/** ARCHITECTURE §4.6: split on whitespace, lowercase, strip leading/trailing characters outside a-z, 0-9 and "'"; drop empty results. */
export function normalizeWords(text: string): readonly string[] {
  const words: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const word = raw.toLowerCase().replace(/^[^a-z0-9']+/, '').replace(/[^a-z0-9']+$/, '');
    if (word !== '') words.push(word);
  }
  return words;
}
