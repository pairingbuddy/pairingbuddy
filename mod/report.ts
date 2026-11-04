import type { EngineInterface } from 'claude-code'
import { renderReport } from '../shared-node/report.mjs'
import { readInputs, type Spawn } from './inputs'


// The pane's one note line, as mod state: the report press and the suggest submit (./suggest) both write it, so the latest action wins.
// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The same key is written in four copies, PANE_NOTE in ./poll, ./report and ./suggest and noteAtom in register.tsx; keep all four in step.
const PANE_NOTE = { plugin: 'pairingbuddy', key: 'pane-note' }

export const REPORTS_DIR = '.pairingbuddy/reports'

const pad = (n: number) => String(n).padStart(2, '0')

function slugOf(task: string | undefined): string {
  const plain = (task ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase() // "Åtgärda" -> "atgarda"
  const dashed = plain.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  // The cut can leave a dash at the end, so trim again. Scripts that come out empty fall back to "run".
  return dashed.slice(0, 40).replace(/-+$/, '') || 'run'
}

// The user's local date and time of day (YYYY-MM-DD-HHMMSS), so each press gets its own file and names sort by time.
function stampOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

// The argv that reads the run's own commits, in the ledger's order: --no-walk=unsorted shows exactly these shas and does not sort them.
export function commitsArgv(shas: string[]): string[] {
  return ['git', 'log', '--no-walk=unsorted', '--format=%H%x09%s', ...shas]
}

// The run's commits come from the checkpoint shas the ledger records in ledger.commits. With none, git is not called, because git log defaults to HEAD when given no revisions.
// One read-only git call. Any failure gives null, which the report shows as unknown, and never stops the report.
async function readCommits($: EngineInterface, shas: string[]): Promise<{ sha: string; subject: string }[] | null> {
  if (shas.length === 0) return []
  try {
    const result = await $.process.run(commitsArgv(shas))
    if (result.exitCode !== 0) return null
    return String(result.stdout ?? '')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const tab = line.indexOf('\t')
        return tab < 0 ? { sha: line, subject: '' } : { sha: line.slice(0, tab), subject: line.slice(tab + 1) }
      })
  } catch {
    return null
  }
}

// A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
// Writes the run report under the reports folder. Never throws: a failed write or open is shown as the pane note, and only a failure before the write (reading inputs, session root) is dropped.
export async function openReport($: EngineInterface, spawns: Spawn[]): Promise<void> {
  try {
    const inputs = await readInputs($, spawns)
    // The button showed on a ledger that is gone or half-written now: write nothing rather than an empty report.
    if (!inputs.ledger) return
    const path = `${await $.session.root()}/${REPORTS_DIR}/${stampOf(inputs.now ?? Date.now())}-${slugOf(inputs.ledger.task)}.html`
    const shas = inputs.ledger.commits ?? []
    const commits = await readCommits($, shas)
    try {
      await $.fs.write(path, renderReport({ ...inputs, commits }))
    } catch {
      await $.state.set(PANE_NOTE, "couldn't write the report")
      return
    }
    const name = path.split('/').pop()
    // `open` is the macOS opener and the mod API exposes no platform to pick another, so elsewhere the press writes the report but opens nothing.
    let opened = false
    try {
      opened = (await $.process.run(['open', path])).exitCode === 0
    } catch {
      // A rejected run counts as not opened.
    }
    await $.state.set(PANE_NOTE, `wrote ${name} \u00b7 ${opened ? 'opened in your browser' : "couldn't open it"}`)
  } catch {
    // The press never throws.
  }
}
