import type { EngineInterface } from 'claude-code'

export const PANE_ID = 'pairingbuddy'

// A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
export function openPane($: EngineInterface, focus?: boolean) {
  return $.ui.open({ id: PANE_ID, title: 'Pairing Buddy', closeOnEscape: true, ...(focus ? { focus: true } : {}) })
}

// What the last /pb did, kept by the caller across /pb calls.
export type PbToggle = { last: 'opened' | 'closed' | null }

// /pb: a pane the person sees is closed; one closed, waiting undrawn or behind another tab is opened with the keyboard.
// The /pb right after one that closed always opens: the engine's list can still show the pane just closed, and consecutive
// /pb calls must alternate. A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
export async function togglePane($: EngineInterface, toggle: PbToggle = { last: null }): Promise<'opened' | 'closed'> {
  const panes = await $.ui.panes().catch(() => [])
  const seen = panes.some(pane => pane.id === PANE_ID && pane.isShown && pane.isPlaced)
  if (seen && toggle.last !== 'closed') {
    await $.ui.close({ id: PANE_ID })
    toggle.last = 'closed'
    return 'closed'
  }
  await openPane($, true)
  toggle.last = 'opened'
  return 'opened'
}
