import type { EngineInterface } from 'claude-code'

export const PANE_ID = 'pairingbuddy'

// A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
export function openPane($: EngineInterface, focus?: boolean) {
  return $.ui.open({ id: PANE_ID, title: 'Pairing Buddy', closeOnEscape: true, ...(focus ? { focus: true } : {}) })
}
