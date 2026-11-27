// The pane's first glance as a human reads it: a loud state's bar (the lines above GOAL), then STATUS and its own lines,
// each trimmed of its label and padding. Nothing for a pane with neither.
export function firstGlance(lines: string[]): string[] {
  const goal = lines.findIndex(line => line.startsWith('GOAL'))
  const bar = lines.slice(0, Math.max(goal, 0)).map(line => line.trim())
  const at = lines.findIndex(line => line.startsWith('STATUS'))
  if (at < 0) return bar
  const end = lines.findIndex((line, i) => i > at && !line.startsWith(' '))
  const status = lines.slice(at, end < 0 ? undefined : end).map(line => line.replace(/^(STATUS)?\s+/, ''))
  return [...bar, ...status]
}
