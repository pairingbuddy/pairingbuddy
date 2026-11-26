import type { EngineInterface } from 'claude-code'
import { renderPlanPage } from '../shared-node/plan-page.mjs'
import { readCommits, REPORTS_DIR } from './report'
import { resolveOpenUnit, type View } from './view'

// The pane's one note line, as mod state. Repeated on purpose: the kit needs the key spelled as literals in the file that
// writes it. PANE_NOTE is also written in ./poll and ./report and read as noteAtom in register.tsx; keep the copies in step.
const PANE_NOTE = { plugin: 'pairingbuddy', key: 'pane-note' }

const pad = (n: number) => String(n).padStart(2, '0')

// The user's local date and time of day (YYYY-MM-DD-HHMMSS), as a report's name has it, so each page gets its own file.
export function stampOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

// What a /pb-plan came to: written (and whether it opened), failed in its own words, or no plan to show.
export type PlanOutcome = { path: string; opened: boolean } | { failed: string } | { none: true }

const OPENED = 'opened in your browser'
const NOT_OPENED = "couldn't open it"

// The one line /pb-plan answers with: the page's absolute path, so it can be clicked when the open did not work.
export function planLine(outcome: PlanOutcome): string {
  if ('none' in outcome) return 'Pairing Buddy: no plan to show yet'
  if ('failed' in outcome) return `Pairing Buddy: ${outcome.failed}`
  return `Pairing Buddy plan: ${outcome.path} · ${outcome.opened ? OPENED : NOT_OPENED}`
}

// A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
// Writes the whole plan the pane's PLAN block shows a window of, with the same states, under the reports folder, and opens
// it. view: what the pane draws now; planPath: where the plan is. Never throws: a failure is the pane note, in its own words.
export async function openPlan($: EngineInterface, view: View, planPath: string | null, now: number): Promise<PlanOutcome> {
  try {
    if (!view.plan) return { none: true }
    const open = view.planOpen && resolveOpenUnit(view.plan.units, view.planOpen)
    const subjects = await commitSubjects($, open ? open.commits ?? [] : [])
    const html = renderPlanPage({ plan: view.plan, states: view.planStates, open, building: view.planBuilding, publishing: view.planPublishing === true, path: planPath ?? undefined, subjects })
    const path = `${await $.session.root()}/${REPORTS_DIR}/${stampOf(now)}-plan.html`
    try {
      await $.fs.write(path, html)
    } catch {
      return failed($, "couldn't write the plan page")
    }
    // `open` is the macOS opener, as /pb-report uses it; elsewhere the page is written but nothing opens it.
    let opened = false
    try {
      opened = (await $.process.run(['open', path])).exitCode === 0
    } catch {
      // A rejected run counts as not opened.
    }
    await $.state.set(PANE_NOTE, `wrote ${path.split('/').pop()} · ${opened ? OPENED : NOT_OPENED}`)
    return { path, opened }
  } catch {
    return { failed: "couldn't show the plan" }
  }
}

// The open unit's commit subjects by full hash, from one read-only git call, as /pb-report reads a run's. A failed read
// gives none, and the page shows the bare hashes.
async function commitSubjects($: EngineInterface, shas: string[]): Promise<Record<string, string>> {
  const read = await readCommits($, shas)
  return Object.fromEntries((read ?? []).filter(({ subject }) => subject !== '').map(({ sha, subject }) => [sha, subject]))
}

async function failed($: EngineInterface, words: string): Promise<PlanOutcome> {
  await $.state.set(PANE_NOTE, words)
  return { failed: words }
}
