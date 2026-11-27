// A wait on a line only the human types: a config proposal's apply or refuse (run/config-proposals.json), or a pb refusal
// whose only way through is a pb human verb (run/human-wait.json). Pure, no node: imports, so the mod can import it. The
// views read either as the question waiting on the human, so STATUS, the band, the alert and the status line say WAITING
// FOR YOU with what to type, instead of "working" while nothing moves.

// The gate-like id the wait stands under in needsHuman.
export const HUMAN_LINE = "human-line";

// The file under .pairingbuddy/run/ where pb keeps the last refusal that hands the human a typed line.
export const HUMAN_WAIT_FILE = "human-wait.json";

const shown = (value) => JSON.stringify(value);

// Its seq is the time it was raised, so the alert sounds once for one wait and again for the next; n stands in without one.
const seqOf = (at, fallback) => (Number.isFinite(Date.parse(at)) ? Date.parse(at) : fallback);

function proposalWait(proposal) {
  const lines = proposal.lines ?? {};
  const options = [lines.apply && `Apply it: type ${lines.apply}`, lines.refuse && `Or refuse it: type ${lines.refuse}`].filter(Boolean);
  return {
    gate: HUMAN_LINE,
    why: `apply or refuse the ${proposal.key} change`,
    detail: `The session proposes ${proposal.key} in ${proposal.file}: ${shown(proposal.old)} → ${shown(proposal.new)}. Why: ${proposal.reason}`,
    options,
    seq: seqOf(proposal.at, proposal.n),
  };
}

function refusalWait(refusal) {
  const lines = Array.isArray(refusal.lines) ? refusal.lines.filter((line) => typeof line === "string" && line !== "") : [];
  return { gate: HUMAN_LINE, why: `type the line pb ${refusal.verb} gave you`, detail: String(refusal.message ?? ""), options: lines.map((line) => `Type ${line}`), seq: seqOf(refusal.at, 1) };
}

const pending = (proposals) => (Array.isArray(proposals) ? proposals.filter((proposal) => proposal?.status === "pending") : []);

// The ledger as the views read it: a wait on the human's line, while no stop stands and no gate asks, is the question
// waiting on the human.
export function withHumanWait(ledger, { proposals, refusal } = {}) {
  if (ledger?.stop || ledger?.needsHuman) return ledger;
  const first = pending(proposals)[0];
  const wait = first ? proposalWait(first) : refusal?.verb ? refusalWait(refusal) : undefined;
  return wait ? { ...(ledger ?? {}), needsHuman: wait } : ledger;
}

// Where a typed line ends inside a refusal's words: the next clause ("; or …", ", then …"), the next sentence, or the end.
const LINE_END = /;\s|,\s+then\s|\.\s+(?=[A-Z])|\.?\s*$/;

// The lines a human types that a message holds, each from its typed prefix (typedCommand(root, "")) to where it ends.
export function humanLinesIn(message, prefix) {
  const text = String(message ?? "");
  const start = String(prefix ?? "").trimEnd();
  if (start === "") return [];
  const lines = [];
  for (let at = text.indexOf(start); at >= 0; at = text.indexOf(start, at + start.length)) {
    const rest = text.slice(at);
    const end = LINE_END.exec(rest.slice(start.length));
    lines.push(rest.slice(0, start.length + (end ? end.index : rest.length - start.length)).trim());
  }
  return lines;
}
