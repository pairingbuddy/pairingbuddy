import type { EngineInterface } from 'claude-code'

export const PANE_ID = 'pairingbuddy'

// A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
export function openPane($: EngineInterface, focus?: boolean) {
  return $.ui.open({ id: PANE_ID, title: 'Pairing Buddy', closeOnEscape: true, ...(focus ? { focus: true } : {}) })
}

// /pb: a pane the person sees is closed; one closed, waiting undrawn or behind another tab is opened with the keyboard.
// A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
export async function togglePane($: EngineInterface): Promise<'opened' | 'closed'> {
  const panes = await $.ui.panes().catch(() => [])
  if (panes.some(pane => pane.id === PANE_ID && pane.isShown && pane.isPlaced)) {
    await $.ui.close({ id: PANE_ID })
    return 'closed'
  }
  await openPane($, true)
  return 'opened'
}
