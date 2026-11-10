// The stage's rollback notes: one "## Rollback <n>: <key>" entry per rollback. No fs, no Node APIs.
export const rollbackHeading = (number, key) => `## Rollback ${number}: ${key}`;

// [{number, key, text}] from the notes file text, in file order.
export function parseFixNotes(text) {
  return text.split(/^## Rollback (\d+): (\S+)\n/m).slice(1).reduce((entries, part, i, parts) => (
    i % 3 === 0 ? [...entries, { number: Number(part), key: parts[i + 1], text: parts[i + 2].trim() }] : entries
  ), []);
}
