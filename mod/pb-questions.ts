import type { EngineInterface } from 'claude-code'
import { renderQuestionsPage } from '../shared-node/questions-page.mjs'
import { taskTitle } from '../shared-node/questions.mjs'
import { stampOf } from './plan-page'
import { REPORTS_DIR } from './report'

// /pb-questions: the open unit's questions for you, numbered as pb numbers them. It asks what the person wants to do: answer
// them one dialog at a time, or see them all on a page first. The mod only reads: an answer is recorded by pb human answer,
// run as a process, never written here.
const UNIT = '.pairingbuddy/run/unit.json'

type Question = { task?: unknown; step?: unknown; ambiguity?: unknown; answer?: unknown; options?: unknown }
type UnitRecord = { unit?: unknown; questions?: Question[]; questionsMore?: unknown }

const oneLine = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim()
const isAnswered = (question: Question) => typeof question.answer === 'string'

async function unitRecord($: EngineInterface): Promise<UnitRecord | null> {
  try {
    const unit = JSON.parse(await $.fs.read(`${await $.session.root()}/${UNIT}`))
    return unit && typeof unit === 'object' ? unit : null
  } catch {
    return null
  }
}

// The walk's own choices, after any suggested answers; typed words are the answer itself.
const SKIP = 'Skip this one'
const STOP = 'Stop answering'

// The dialog has room for four choices: at most two of the reviewer's suggested answers, then the walk's own two. A label
// equal to one of the walk's own is left out, so choosing it can only mean skip or stop.
const SUGGESTED = 2
const suggested = (question: Question) => (Array.isArray(question.options) ? question.options : [])
  .filter((option): option is string => typeof option === 'string' && option.trim() !== '' && option !== SKIP && option !== STOP)
  .slice(0, SUGGESTED)

// One dialog's question: the doubt in full, then the task and the step that raised it.
// The dialog's free-text choice is the engine's own, labelled "Type something", so the how line names it as drawn.
export const HOW_TO_ANSWER = 'To answer, pick a suggestion or choose "Type something" and write your answer. "Skip this one" leaves it for later; "Stop answering" ends here.'

function dialogText(question: Question): string {
  const where = [taskTitle(question.task), oneLine(question.step)].filter(Boolean).join(' · ')
  const asked = where ? `${where}:\n${String(question.ambiguity ?? '')}` : String(question.ambiguity ?? '')
  return `${asked}\n\n${HOW_TO_ANSWER}`
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

// Answer them now: the open questions one dialog at a time. Stop answering, or Esc, ends the walk at once and leaves
// the rest open; Skip this one leaves that one open and goes on.
async function walk($: EngineInterface, unit: UnitRecord): Promise<string> {
  const questions = Array.isArray(unit.questions) ? unit.questions : []
  const open = questions.map((question, i) => ({ question, n: i + 1 })).filter(({ question }) => !isAnswered(question))
  const more = Number.isInteger(unit.questionsMore) ? Number(unit.questionsMore) : 0
  let answered = 0
  for (const [i, { question, n }] of open.entries()) {
    let reply: string
    try {
      reply = await $.ui.ask(dialogText(question), { options: [...suggested(question), SKIP, STOP], header: `Q ${i + 1} of ${open.length}` })
    } catch {
      break
    }
    if (reply === STOP) break
    if (reply === SKIP || reply.trim() === '') continue
    const recorded = await recordAnswer($, n, reply.trim())
    if (!recorded.ok) return `Pairing Buddy: answered ${answered}, then question ${n} was not recorded: ${recorded.why}`
    answered++
  }
  return `Pairing Buddy: answered ${answered} · ${open.length + more - answered} still open · /pb-questions to come back`
}

// The menu's two choices: answer the open questions now, one dialog each, or see them all on the page first.
const ANSWER_NOW = 'Answer them now'
const SEE_FIRST = 'See them all first'

const openCount = (unit: UnitRecord) => (Array.isArray(unit.questions) ? unit.questions.filter(q => !isAnswered(q)).length : 0)
  + (Number.isInteger(unit.questionsMore) ? Number(unit.questionsMore) : 0)

// /pb-questions: one command with no words. It asks what the person wants to do with the questions for them, then does it.
export async function runQuestions($: EngineInterface): Promise<string> {
  const unit = await unitRecord($)
  if (unit === null) return 'Pairing Buddy: no unit is open, so there are no questions for you'
  const count = openCount(unit)
  if (count === 0) return answeredOnly($, unit)
  const closed = `Pairing Buddy: closed. Your ${count} ${count === 1 ? 'question is' : 'questions are'} still open · /pb-questions to come back`
  let choice: string
  try {
    choice = await $.ui.ask(`${count} ${count === 1 ? 'question' : 'questions'} for you. Answer them now (one at a time, stop whenever you like), or see them all first on a page?`, { options: [ANSWER_NOW, SEE_FIRST], header: 'Questions' })
  } catch (error) {
    return isDismissal(error) ? closed : dialogFailed($, unit)
  }
  if (choice === ANSWER_NOW) return walk($, unit)
  if (choice === SEE_FIRST) return seePage($, unit, `${count} ${count === 1 ? 'question' : 'questions'} for you`)
  return closed
}

// No question open: nothing to ask when none was ever answered either; otherwise the choice to look back at the answers.
const SEE_ANSWERED = 'See what you answered'
async function answeredOnly($: EngineInterface, unit: UnitRecord): Promise<string> {
  const answered = Array.isArray(unit.questions) ? unit.questions.filter(isAnswered).length : 0
  if (answered === 0) return 'Pairing Buddy: no questions for you right now'
  let choice: string
  try {
    choice = await $.ui.ask(`No questions are open. You answered ${answered}.`, { options: [SEE_ANSWERED, 'Close'], header: 'Questions' })
  } catch {
    return 'Pairing Buddy: closed'
  }
  if (choice !== SEE_ANSWERED) return 'Pairing Buddy: closed'
  return seePage($, unit, `${answered} ${answered === 1 ? 'question' : 'questions'} you answered`, '')
}

// ui.ask rejects both when the person dismisses the dialog and when it cannot open (a deny, or no one to ask in a -p run).
// Only a dismissal is the person's Esc; anything else leaves them the page, so a dialog that never showed is not read as a no.
const DISMISSAL = /dismiss|cancel|abort|interrupt|reject|declin/i
const isDismissal = (error: unknown) => DISMISSAL.test(error instanceof Error ? error.message : String(error))

async function dialogFailed($: EngineInterface, unit: UnitRecord): Promise<string> {
  const path = await writeQuestionsPage($, unit)
  if (path === null) return "Pairing Buddy: couldn't open the dialog or write the questions page"
  try {
    await $.process.run(['open', path])
  } catch {
    // The line still names the page, opened or not.
  }
  return `Pairing Buddy: couldn't open the dialog; opened the page instead: ${path}`
}

// Writes the questions page and opens it, in one line: what it holds, where it is, and how to answer when some are open.
const AGAIN = ' · to answer, type /pb-questions again'
async function seePage($: EngineInterface, unit: UnitRecord, what: string, then = AGAIN): Promise<string> {
  const path = await writeQuestionsPage($, unit)
  if (path === null) return "Pairing Buddy: couldn't write the questions page"
  let opened = false
  try {
    opened = (await $.process.run(['open', path])).exitCode === 0
  } catch {
    // A rejected run counts as not opened.
  }
  return `Pairing Buddy: ${what}, ${opened ? 'opened in your browser' : "written but couldn't open it"}: ${path}${then}`
}
