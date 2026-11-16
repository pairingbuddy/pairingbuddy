import type { EngineInterface } from 'claude-code'
import { renderReport } from '../shared-node/report.mjs'
import { taskCommitShas, taskRuns } from '../shared-node/task-runs.mjs'
import { readInputs, readKeptRuns, readReportLists, type Call, type Inputs, type Spawn } from './inputs'


// The pane's one note line, as mod state: the report press and the suggest submit (./suggest) both write it, so the latest action wins.
// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The same key is written in four copies, PANE_NOTE in ./poll, ./report and ./suggest and noteAtom in register.tsx; keep all four in step.
const PANE_NOTE = { plugin: 'pairingbuddy', key: 'pane-note' }

// Repeated on purpose: the kit needs the key spelled as literals in the file that writes it. The last-run snapshot key is written in two copies, LAST_RUN in ./poll and lastRunAtom in register.tsx, and read from a third, LAST_RUN in ./report; keep all three in step.
const LAST_RUN = { plugin: 'pairingbuddy', key: 'last-run' } as const

// Repeated on purpose: see ENDED_AT in ./poll; keep the copies in step.
const ENDED_AT = { plugin: 'pairingbuddy', key: 'ended-at' } as const

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

type Snapshot = { ledger?: unknown; tests?: string[]; now?: number | null; unit?: { key?: string } | null; prUrl?: string | null } | null | undefined

function fromSnapshot(snapshot: Snapshot, live: Inputs): Inputs {
  if (!snapshot?.ledger) return live
  return { ...live, ledger: snapshot.ledger as Inputs['ledger'], tests: snapshot.tests ?? [] }
}

// What a report press came to: written (and whether it opened), failed in its own words, or no run to report.
export type ReportOutcome = { path: string; opened: boolean } | { failed: string } | { none: true }

const NO_RUN = 'no run to report yet'
const OPENED = 'opened in your browser'
const NOT_OPENED = "couldn't open it"

// The one line /pb-report answers with: the report's absolute path, so it can be clicked when the open did not work.
export function reportLine(outcome: ReportOutcome): string {
  if ('none' in outcome) return `Pairing Buddy: ${NO_RUN}`
  if ('failed' in outcome) return `Pairing Buddy: ${outcome.failed}`
  return `Pairing Buddy report: ${outcome.path} \u00b7 ${outcome.opened ? OPENED : NOT_OPENED}`
}

// A function declaration, not an arrow: the mod loader rejects an exported arrow taking $ across files.
// Writes the run report under the reports folder. Never throws: a failed build, write or open is shown as the pane note, each in its own words, and only a failure before the build (reading inputs, session root) is dropped.
// The pane's button and /pb-report both run it; the command answers with what it returns.
export async function openReport($: EngineInterface, spawns: Spawn[], calls: Call[] = []): Promise<ReportOutcome> {
  try {
    const live = await readInputs($, spawns)
    // The last poll's snapshot: with no live ledger the report is built from its ledger, and it names the unit the run was in.
    const snapshot = (await $.state.get(LAST_RUN)).value as Snapshot
    const inputs = live.ledger ? live : fromSnapshot(snapshot, live)
    // A report built from the last polled ledger is of a run that is gone: it is never measured to now.
    const endedAt = live.ledger ? undefined : ((await $.state.get(ENDED_AT)).value as string | null | undefined) ?? undefined
    const lists = await readReportLists($, inputs.ledger)
    // The task's runs: the reported one and the runs pb kept of the same unit, so the report describes the whole task.
    const runs = taskRuns({ ledger: inputs.ledger, kept: await readKeptRuns($), unitKey: snapshot?.unit?.key ?? null, calls, scenarios: lists.scenarios, endedAt, prUrl: snapshot?.prUrl ?? undefined })
    // The button showed on a ledger that is gone or half-written now: write nothing rather than an empty report.
    const first = runs.find((run: { ledger?: Inputs['ledger'] }) => run.ledger?.kind !== 'publish')?.ledger ?? runs[0]?.ledger
    if (!first) return { none: true }
    const path = `${await $.session.root()}/${REPORTS_DIR}/${stampOf(inputs.now ?? Date.now())}-${slugOf(first.task)}.html`
    const commits = await readCommits($, taskCommitShas(runs))
    // Building and writing fail apart, so the note says which one did.
    let html: string
    try {
      html = renderReport({ ...inputs, ...lists, calls, commits, endedAt, now: live.ledger ? inputs.now : undefined, runs })
    } catch {
      return failed($, "couldn't build the report from the run's records")
    }
    try {
      await $.fs.write(path, html)
    } catch {
      return failed($, "couldn't write the report")
    }
    const name = path.split('/').pop()
    // `open` is the macOS opener and the mod API exposes no platform to pick another, so elsewhere the press writes the report but opens nothing.
    let opened = false
    try {
      opened = (await $.process.run(['open', path])).exitCode === 0
    } catch {
      // A rejected run counts as not opened.
    }
    await $.state.set(PANE_NOTE, `wrote ${name} \u00b7 ${opened ? OPENED : NOT_OPENED}`)
    return { path, opened }
  } catch {
    // The press never throws.
    return { failed: "couldn't read the run to report" }
  }
}

async function failed($: EngineInterface, words: string): Promise<ReportOutcome> {
  await $.state.set(PANE_NOTE, words)
  return { failed: words }
}
