import type { EngineInterface } from 'claude-code'
import { renderQuestionsPage } from '../shared-node/questions-page.mjs'
import { taskTitle } from '../shared-node/questions.mjs'
import { stampOf } from './plan-page'
import { REPORTS_DIR } from './report'

// /pb-answer: the open unit's questions for you, numbered as pb numbers them, and the human's answer to one. The mod only
// reads: an answer is recorded by pb human answer, run as a process, never written here.
const UNIT = '.pairingbuddy/run/unit.json'
const HOW = 'Answer with /pb-answer <number> <your answer>. Your answer reaches the next step that starts.'

type Question = { task?: unknown; step?: unknown; ambiguity?: unknown; answer?: unknown }
type UnitRecord = { unit?: unknown; questions?: Question[]; questionsMore?: unknown }

// The terminal shows only a few questions, each on one line cut at a fixed width; the page has them all in full.
const LISTED = 3
const WIDTH = 100
const SHORT_HOW = 'Answer them one by one: /pb-answer'
const cut = (text: string) => (text.length <= WIDTH ? text : `${text.slice(0, WIDTH - 1).trimEnd()}…`)

const oneLine = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim()
const isAnswered = (question: Question) => typeof question.answer === 'string'

// The short reply /pb-answer gives next to the page: the count and where the page is, the first few open questions on one
// line each, then how to answer.
export function questionList(unit: UnitRecord, where: string): string {
  const questions = Array.isArray(unit.questions) ? unit.questions : []
  const open = questions.map((question, i) => ({ question, n: i + 1 })).filter(({ question }) => !isAnswered(question))
  const more = Number.isInteger(unit.questionsMore) ? Number(unit.questionsMore) : 0
  const count = open.length + more
  if (count === 0) return `Pairing Buddy: no questions for you right now${where}`
  const head = `Pairing Buddy: ${count} ${count === 1 ? 'question' : 'questions'} for you${where}`
  const rest = count - Math.min(open.length, LISTED)
  const lines = open.slice(0, LISTED).map(({ question, n }) => cut(`${n}. ${oneLine(question.ambiguity)}`))
  return [head, ...lines, ...(rest > 0 ? [`+${rest} more on the page`] : []), SHORT_HOW].join('\n')
}

async function unitRecord($: EngineInterface): Promise<UnitRecord | null> {
  try {
    const unit = JSON.parse(await $.fs.read(`${await $.session.root()}/${UNIT}`))
    return unit && typeof unit === 'object' ? unit : null
  } catch {
    return null
  }
}

// Writes the questions page under the reports folder and opens it; says where it is, or that it could not.
async function openQuestionsPage($: EngineInterface, unit: UnitRecord): Promise<string> {
  try {
    const path = `${await $.session.root()}/${REPORTS_DIR}/${stampOf(await $.clock.now())}-questions.html`
    await $.fs.write(path, renderQuestionsPage({ unit }))
    let opened = false
    try {
      opened = (await $.process.run(['open', path])).exitCode === 0
    } catch {
      // A rejected run counts as not opened.
    }
    return ` · ${opened ? `opened ${path} in your browser` : `wrote ${path}, couldn't open it`}`
  } catch {
    return " · couldn't write the questions page"
  }
}

// The walk's own choices, after any suggested answers; typed words are the answer itself.
const SKIP = 'Skip this one'
const STOP = 'Stop answering'

// One dialog's question: the doubt in full, then the task and the step that raised it.
function dialogText(question: Question): string {
  const where = [taskTitle(question.task), oneLine(question.step)].filter(Boolean).join(' · ')
  return where ? `${where}:\n${String(question.ambiguity ?? '')}` : String(question.ambiguity ?? '')
}

type Recorded = { ok: true } | { ok: false; why: string }

// Records answer to question n through pb human answer, the one writer of answers.
async function recordAnswer($: EngineInterface, n: number | string, answer: string): Promise<Recorded> {
  try {
    const ran = await $.process.run(['node', `${$.plugin.root}/cli/pb.mjs`, 'human', 'answer', String(n), answer], { cwd: await $.session.root() })
    return ran.exitCode === 0 ? { ok: true } : { ok: false, why: oneLine(ran.stderr).replace(/^pb:\s*/, '') }
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) }
  }
}

// Writes the questions page without opening it; its path, or null when it could not be written.
async function writeQuestionsPage($: EngineInterface, unit: UnitRecord): Promise<string | null> {
  try {
    const path = `${await $.session.root()}/${REPORTS_DIR}/${stampOf(await $.clock.now())}-questions.html`
    await $.fs.write(path, renderQuestionsPage({ unit }))
    return path
  } catch {
    return null
  }
}

// /pb-answer with no words: the open questions one dialog at a time. Stop answering, or Esc, ends the walk at once and leaves
// the rest open; Skip this one leaves that one open and goes on.
async function walk($: EngineInterface, unit: UnitRecord): Promise<string> {
  const questions = Array.isArray(unit.questions) ? unit.questions : []
  const open = questions.map((question, i) => ({ question, n: i + 1 })).filter(({ question }) => !isAnswered(question))
  const more = Number.isInteger(unit.questionsMore) ? Number(unit.questionsMore) : 0
  if (open.length + more === 0) return 'Pairing Buddy: no questions for you right now'
  let answered = 0
  for (const [i, { question, n }] of open.entries()) {
    let reply: string
    try {
      reply = await $.ui.ask(dialogText(question), { options: [SKIP, STOP], header: `Q ${i + 1} of ${open.length}` })
    } catch {
      break
    }
    if (reply === STOP) break
    if (reply === SKIP || reply.trim() === '') continue
    const recorded = await recordAnswer($, n, reply.trim())
    if (!recorded.ok) return `Pairing Buddy: answered ${answered}, then question ${n} was not recorded: ${recorded.why}`
    answered++
  }
  const page = await writeQuestionsPage($, (await unitRecord($)) ?? unit)
  return `Pairing Buddy: answered ${answered} · ${open.length + more - answered} left · ${page ? `page: ${page}` : "couldn't write the questions page"}`
}

// What /pb-answer prints for its words: the list with none, else the outcome of recording the answer.
export async function runAnswer($: EngineInterface, args: string): Promise<string> {
  const words = args.trim()
  if (words === '') {
    const unit = await unitRecord($)
    if (unit === null) return 'Pairing Buddy: no unit is open, so there are no questions for you'
    return walk($, unit)
  }
  if (words === 'list') {
    const unit = await unitRecord($)
    if (unit === null) return 'Pairing Buddy: no unit is open, so there are no questions for you'
    return questionList(unit, await openQuestionsPage($, unit))
  }
  const parsed = /^(\d+)\s+([\s\S]+)$/.exec(words)
  if (!parsed) return `Pairing Buddy: start with the question number. ${HOW}`
  const [, n, answer] = parsed
  try {
    const root = await $.session.root()
    const ran = await $.process.run(['node', `${$.plugin.root}/cli/pb.mjs`, 'human', 'answer', n, answer], { cwd: root })
    if (ran.exitCode !== 0) return `Pairing Buddy: not recorded: ${oneLine(ran.stderr).replace(/^pb:\s*/, '')}`
    const { open } = JSON.parse(String(ran.stdout))
    const still = open === 0 ? 'No question is open now.' : `${open} ${open === 1 ? 'question' : 'questions'} still open.`
    return `Pairing Buddy: your answer to question ${n} is recorded. It reaches the next step that starts; work already done is reworked at the next task if your answer needs it. ${still}`
  } catch (e) {
    return `Pairing Buddy: not recorded: ${e instanceof Error ? e.message : String(e)}`
  }
}
