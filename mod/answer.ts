import type { EngineInterface } from 'claude-code'

// /pb-answer: the open unit's questions for you, numbered as pb numbers them, and the human's answer to one. The mod only
// reads: an answer is recorded by pb human answer, run as a process, never written here.
const UNIT = '.pairingbuddy/run/unit.json'
const HOW = 'Answer with /pb-answer <number> <your answer>. Your answer reaches the next step that starts.'

type Question = { task?: unknown; ambiguity?: unknown; answer?: unknown }

const oneLine = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim()
const isAnswered = (question: Question) => typeof question.answer === 'string'

// The list /pb-answer shows: each open question with its number and the task that raised it, then how to answer.
export function questionList(questions: Question[]): string {
  const open = questions.map((question, i) => ({ question, n: i + 1 })).filter(({ question }) => !isAnswered(question))
  const answered = questions.length - open.length
  if (open.length === 0) return `Pairing Buddy: no questions for you right now${answered > 0 ? `, ${answered} already answered` : ''}`
  const head = `Pairing Buddy: ${open.length} ${open.length === 1 ? 'question' : 'questions'} for you${answered > 0 ? `, ${answered} already answered` : ''}`
  return [head, ...open.map(({ question, n }) => `${n}. (${oneLine(question.task)}) ${oneLine(question.ambiguity)}`), HOW].join('\n')
}

async function unitQuestions($: EngineInterface): Promise<Question[] | null> {
  try {
    const unit = JSON.parse(await $.fs.read(`${await $.session.root()}/${UNIT}`))
    return Array.isArray(unit?.questions) ? unit.questions : []
  } catch {
    return null
  }
}

// What /pb-answer prints for its words: the list with none, else the outcome of recording the answer.
export async function runAnswer($: EngineInterface, args: string): Promise<string> {
  const words = args.trim()
  if (words === '') {
    const questions = await unitQuestions($)
    return questions === null ? 'Pairing Buddy: no unit is open, so there are no questions for you' : questionList(questions)
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
