// What a human's answer to a wait outside the gates does to the ledger, for the tap to record: the session asks the
// question pb stored in needsHuman, and only the human's AskUserQuestion result is taken, so a model never answers it.
import { ACCEPT_CONFIG, CONFIG_GATE, STOP_AT_CONFIG } from "./config-wait.mjs";
import { HUMAN_STOPPED } from "./stop-codes.mjs";
import { validatedConfigHash } from "./test-run.mjs";

// The wait's time, kept so it stays waiting and never reads as work.
const keptWait = (ledger, gate, answeredAt) => {
  const { askedAt } = ledger.needsHuman;
  return typeof askedAt === "string" ? [...(ledger.gateWaits ?? []), { gate, askedAt, answeredAt }] : ledger.gateWaits;
};

const answered = (ledger, gate, answeredAt) => {
  const gateWaits = keptWait(ledger, gate, answeredAt);
  return { ...ledger, needsHuman: null, ...(gateWaits === undefined ? {} : { gateWaits }) };
};

// Accept pins test-config.json as it is now. validatedConfigHash refuses a file no test run can use, and then nothing is
// recorded: the wait stands. Stop is the human's own stop.
function answerConfig(ledger, answer, { root, answeredAt }) {
  if (answer === STOP_AT_CONFIG) return { ...answered(ledger, CONFIG_GATE, answeredAt), stop: { code: HUMAN_STOPPED, reason: "the human answered stop when the test settings changed", seq: ledger.seq + 1 } };
  const newHash = validatedConfigHash(root);
  const acceptances = newHash === ledger.configHash ? {} : { configHash: newHash, configAcceptances: [...(ledger.configAcceptances ?? []), { oldHash: ledger.configHash, newHash, seq: ledger.seq + 1 }] };
  return { ...answered(ledger, CONFIG_GATE, answeredAt), ...acceptances };
}

const WAITS = { [CONFIG_GATE]: { answers: [ACCEPT_CONFIG, STOP_AT_CONFIG], answer: answerConfig } };

// Whether the waiting needsHuman is one of these waits, not a gate of the contract.
export const isHumanWait = (ledger) => Object.hasOwn(WAITS, ledger?.needsHuman?.gate ?? "");

// The ledger with the human's answer recorded, or the ledger as it was when the answer is none the wait offers.
export function recordWaitAnswer(ledger, answer, { root, answeredAt = new Date().toISOString() }) {
  const wait = WAITS[ledger.needsHuman?.gate];
  if (wait === undefined || !wait.answers.includes(answer)) return ledger;
  return wait.answer(ledger, answer, { root, answeredAt });
}
