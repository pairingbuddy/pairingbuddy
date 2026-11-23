// A stranded stage: active, but the session that ran it is gone (killed, or closed mid-stage), so nothing will finish it and
// only the human can move the run on, by adopting it. Pure, no node: imports, so the mod can import it.
//
// The rule, from what the mod can see: the stage is active, no stop or question stands, no agent this session spawned is still
// running, and nothing has moved for STRANDED_MS: not the owner (its lastSeen), the stage's start, the ledger's last write (a
// test run, a checkpoint or a return lands there) or this session's last spawn. The owner's lastSeen alone is not enough: a
// session blocked in a long Workflow call makes no tool call of its own, so its lastSeen stands still while its agents work,
// and they write the ledger. STRANDED_MS is pb human adopt's own "seen recently" span, so once the pane says take over, a
// plain adopt does it.
export const STRANDED_MS = 10 * 60_000;

// The gate-like id the stranded stage stands under in needsHuman, as a permission prompt does.
export const STRANDED_GATE = "stranded";
const STRANDED_LINE = "take over the run: its session is gone";

// The same stage, when this session ran its agents and none still runs: the session is alive (the views run in it), and
// only the stage's workflow ended without finishing, so the way on is to restart the stage, not to take the run over.
export const WORKFLOW_ENDED_GATE = "workflow-ended";
const WORKFLOW_ENDED_LINE = "restart the step: its workflow ended without finishing";
export const RESTART_LINE = "tell Claude to restart it: pb stage fail, then pb status --action";

const STRANDED_LINES = { [STRANDED_GATE]: STRANDED_LINE, [WORKFLOW_ENDED_GATE]: WORKFLOW_ENDED_LINE };

// The plain words for the stranded gates, or undefined for any other gate.
export const strandedLine = (gate) => STRANDED_LINES[gate];

const timeOf = (time) => (typeof time === "string" ? Date.parse(time) : typeof time === "number" ? time : NaN);

// Whether the ledger's active stage is stranded at `now`. ledgerWrittenMs: when the ledger was last written; spawnAt: this
// session's last spawn's start; spawnRunning: an agent this session spawned has not finished.
// When the stage last moved, in ms, or NaN when nothing says.
const lastMoved = (ledger, { ledgerWrittenMs, spawnAt }) => {
  const moved = [ledger.owner?.lastSeen, ledger.stage?.startedAt, ledgerWrittenMs, spawnAt].map(timeOf).filter(Number.isFinite);
  return moved.length > 0 ? Math.max(...moved) : NaN;
};

export function isStranded(ledger, { now, ledgerWrittenMs, spawnAt, spawnRunning = false }) {
  if (!ledger || ledger.stop || ledger.needsHuman || ledger.stage?.status !== "active" || spawnRunning) return false;
  if (!Number.isFinite(now)) return false;
  const moved = lastMoved(ledger, { ledgerWrittenMs, spawnAt });
  return Number.isFinite(moved) && now - moved > STRANDED_MS;
}

// The line that takes the run over, through the project's shim (shared-node/verbs.mjs SHIM, written by pb run open). The owner
// was not seen for STRANDED_MS, so adopt needs no --force.
export const TAKE_OVER_LINE = "type: !.pairingbuddy/bin/pb human adopt";

// The ledger as the views read it: a stranded stage is the question waiting on the human. Its seq is the ledger's, which
// stands while nothing writes it, so the alert fires once. seen.shim: the shim is there, so the take-over line can name it.
// pausedAt: the last move, where SPENT's clock stops (glance's pausedAtOf).
// seen.stageRanHere: this session spawned agents of the active stage, so its workflow, not its session, is what ended.
export function withStranded(ledger, seen) {
  if (!isStranded(ledger, seen)) return ledger;
  const pausedAt = lastMoved(ledger, seen);
  if (seen.stageRanHere) return { ...ledger, pausedAt, needsHuman: { gate: WORKFLOW_ENDED_GATE, reason: WORKFLOW_ENDED_LINE, seq: ledger.seq, fix: RESTART_LINE } };
  return { ...ledger, pausedAt, needsHuman: { gate: STRANDED_GATE, reason: STRANDED_LINE, seq: ledger.seq, ...(seen.shim ? { fix: TAKE_OVER_LINE } : {}) } };
}
