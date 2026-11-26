import type { EngineInterface } from 'claude-code'
import { renderQuestionsPage } from '../shared-node/questions-page.mjs'
import { stampOf } from './plan-page'
import { REPORTS_DIR } from './report'

// /pb-answer: the open unit's questions for you, numbered as pb numbers them, and the human's answer to one. The mod only
// reads: an answer is recorded by pb human answer, run as a process, never written here.
const UNIT = '.pairingbuddy/run/unit.json'
const HOW = 'Answer with /pb-answer <number> <your answer>. Your answer reaches the next step that starts.'

type Question = { task?: unknown; ambiguity?: unknown; answer?: unknown }
type UnitRecord = { unit?: unknown; questions?: Question[]; questionsMore?: unknown }

// The terminal shows only a few questions, each on one line cut at a fixed width; the page has them all in full.
const LISTED = 3
const WIDTH = 100
const SHORT_HOW = 'Answer: /pb-answer <number> <your answer>'
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

// What /pb-answer prints for its words: the list with none, else the outcome of recording the answer.
export async function runAnswer($: EngineInterface, args: string): Promise<string> {
  const words = args.trim()
  if (words === '') {
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
