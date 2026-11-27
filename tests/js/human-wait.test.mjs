// Scenario: the run waits on a line only the human types (a config proposal's apply or refuse, a refusal whose only way
// through is a pb human verb). The views read it as WAITING FOR YOU, with what to type, instead of "working".
import { test } from "node:test";
import assert from "node:assert/strict";

import { HUMAN_LINE, withHumanWait } from "../../shared-node/human-wait.mjs";
import { alertBar, alertKind, alertLine, WAITING } from "../../shared-node/glance.mjs";

const proposal = {
  n: 2,
  file: "git-config.json",
  key: "pr.title_template",
  old: "{type}: {summary}",
  new: "KEY-1 {summary}",
  reason: "the team puts the ticket key first",
  status: "pending",
  at: "2026-11-27T10:00:00.000Z",
  lines: { apply: "!.pairingbuddy/bin/pb human config apply 2", refuse: "!.pairingbuddy/bin/pb human config refuse 2" },
};

test("a-pending-config-proposal-waits-on-the-human-with-both-lines", () => {
  const ledger = { seq: 7, stop: null, needsHuman: null };

  const read = withHumanWait(ledger, { proposals: [proposal] });

  assert.equal(read.needsHuman.gate, HUMAN_LINE);
  assert.equal(read.needsHuman.why, "apply or refuse the pr.title_template change");
  assert.match(read.needsHuman.detail, /"\{type\}: \{summary\}" → "KEY-1 \{summary\}"/);
  assert.match(read.needsHuman.detail, /the team puts the ticket key first/);
  assert.deepEqual(read.needsHuman.options, [`Apply it: type ${proposal.lines.apply}`, `Or refuse it: type ${proposal.lines.refuse}`]);
});

test("a-refusal-only-the-humans-line-clears-waits-on-them-with-that-line", () => {
  const refusal = { verb: "task end", message: "the last full suite run failed, so the task cannot end. Nothing was touched: ask the human to type !.pairingbuddy/bin/pb test --full", lines: ["!.pairingbuddy/bin/pb test --full"], at: "2026-11-27T11:00:00.000Z" };

  const read = withHumanWait({ seq: 3, stop: null, needsHuman: null }, { refusal });

  assert.equal(read.needsHuman.gate, HUMAN_LINE);
  assert.equal(read.needsHuman.why, "type the line pb task end gave you");
  assert.equal(read.needsHuman.detail, refusal.message);
  assert.deepEqual(read.needsHuman.options, ["Type !.pairingbuddy/bin/pb test --full"]);
  assert.equal(read.needsHuman.seq, Date.parse(refusal.at));
});

test("the-bar-and-the-status-line-say-what-to-type-for", () => {
  const read = withHumanWait({ seq: 7, stop: null, needsHuman: null }, { proposals: [proposal] });

  assert.equal(alertKind(read), WAITING);
  assert.equal(alertBar(read).text, "⏸ WAITING FOR YOU · apply or refuse the pr.title_template change");
  assert.equal(alertLine(read), "waiting for you: apply or refuse the pr.title_template change");
});
