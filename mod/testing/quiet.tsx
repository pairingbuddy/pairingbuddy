// Answers the engine calls a polling pane makes that a test does not assert on, and records the sounds it plays.
// It lives outside the `*.test.tsx` pattern, so `claude plugin test` does not run it.
export function quietEngine(on: Function): unknown[] {
  const alerts: unknown[] = []
  const kept = new Map<string, unknown>()
  on('audio.play', (_: unknown, e: unknown) => (alerts.push(e), { value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: kept.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => (kept.set(e.key, e.value), { value: undefined }))
  on('store.delete', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [...kept.keys()] }))
  on('state.set', () => ({ value: { isSet: true, version: 1 } }))
  return alerts
}
