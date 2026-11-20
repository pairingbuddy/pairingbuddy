// Claude Code's own permission prompt, kept as a wait on the human (ledger.permissionWaits). Pure, no node: imports, so the
// mod and the report can import it. The hook (hooks/permission.mjs) opens a wait on the prompt's Notification and closes it
// on the next sign of life; the pane, the band, the alert and the report read an open one as NEEDS YOU, and its time as waited.

// Claude Code's Notification for a prompt still unanswered: "Claude needs your permission to use <tool>".
const PROMPT_MESSAGE = /needs your permission to use (.+?)\s*$/;

// The tool a permission prompt's message names, or undefined when it names none.
export function promptedTool(message) {
  const tool = typeof message === "string" ? PROMPT_MESSAGE.exec(message)?.[1] : undefined;
  return tool ? tool : undefined;
}

const waitsOf = (ledger) => (Array.isArray(ledger?.permissionWaits) ? ledger.permissionWaits : []);

// The wait still open: the last one, unless it was answered.
export function openPermissionWait(ledger) {
  const last = waitsOf(ledger).at(-1);
  return last && typeof last.askedAt === "string" && last.answeredAt === undefined ? last : null;
}

// Opens a wait at `at`. One already open stands; a stop or a gate question already has the human, so neither opens one.
export function askPermission(ledger, { tool, at }) {
  if (openPermissionWait(ledger) || ledger.stop || ledger.needsHuman) return ledger;
  const wait = { askedAt: at, seq: ledger.seq + 1, ...(tool ? { tool } : {}) };
  return { ...ledger, permissionWaits: [...waitsOf(ledger), wait] };
}

// The gate-like id an open wait stands under in needsHuman, with the tool after the colon when it is known.
const PERMISSION_GATE = "permission";
const ASKING = "Claude Code is asking your permission";
// What a tool's prompt is for, in the human's words: a Workflow call starts pb's next step.
const PURPOSES = { Workflow: "to start the next step" };

// The plain words for a permission gate, or undefined for any other gate.
export function permissionLine(gate) {
  if (typeof gate !== "string" || (gate !== PERMISSION_GATE && !gate.startsWith(`${PERMISSION_GATE}:`))) return undefined;
  const tool = gate.slice(PERMISSION_GATE.length + 1);
  const purpose = PURPOSES[tool] ?? (tool ? `to use ${tool}` : "");
  return [ASKING, purpose].filter(Boolean).join(" ");
}

// The ledger as the views read it: an open wait, while no stop stands and no gate asks, is the question waiting on the
// human, so STATUS, the band, the alert and the report treat it as any NEEDS YOU. It carries no askedAt: waitedSeconds
// counts the wait from permissionWaits, once.
export function withPermissionAsk(ledger) {
  const wait = openPermissionWait(ledger);
  if (!wait || ledger.stop || ledger.needsHuman) return ledger;
  const gate = wait.tool ? `${PERMISSION_GATE}:${wait.tool}` : PERMISSION_GATE;
  return { ...ledger, needsHuman: { gate, reason: permissionLine(gate), seq: wait.seq } };
}

// Closes the open wait at `at`; with none open the ledger is unchanged.
export function answerPermission(ledger, at) {
  if (!openPermissionWait(ledger)) return ledger;
  const waits = waitsOf(ledger);
  return { ...ledger, permissionWaits: [...waits.slice(0, -1), { ...waits.at(-1), answeredAt: at }] };
}
