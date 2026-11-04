// The one place that says which paths the mod may write. Empty today: the mod writes nothing.
export const ALLOWED_WRITES: string[] = []

// Where a recorded call came from: a label, or a function read when the call is made. Empty records no prefix.
export type Where = string | (() => string)

function prefix(where: Where) {
  const label = typeof where === 'function' ? where() : where
  return label ? `${label}: ` : ''
}

// Records a call that changes the world beneath the mod, with where it came from.
export function recordOther(touched: string[], where: Where, call: string) {
  touched.push(`${prefix(where)}${call}`)
}

// The one write recorder. An allowed path is applied to `files` when given, so an unchanged check
// sees it; anything else is recorded and refused. Returns whether the write was allowed.
export function recordWrite(files: Map<string, string> | undefined, touched: string[], where: Where, path: string, text: string): boolean {
  if (ALLOWED_WRITES.some(allowed => path === allowed || path.startsWith(allowed))) {
    files?.set(path, text)
    return true
  }
  recordOther(touched, where, `fs.write ${path}`)
  return false
}

// Registers the three engine handlers that change the world (fs.write, process.run, process.spawn).
// Each is recorded in `touched` and refused, except an allowed write, which answers `{ value: undefined }`.
export function refuseWorldChanges(on: Function, touched: string[], where: Where = '', files?: Map<string, string>) {
  on('fs.write', (_: unknown, e: { path: string; text: string }) =>
    recordWrite(files, touched, where, e.path, e.text) ? { value: undefined } : { deny: 'the mod is read-only' })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    recordOther(touched, where, `process.run ${e.argv.join(' ')}`)
    return { deny: 'the mod is read-only' }
  })
  on('process.spawn', async function* (_: unknown, e: { argv: string[] }) {
    recordOther(touched, where, `process.spawn ${e.argv.join(' ')}`)
    return { deny: 'the mod is read-only' } as never
  })
}
