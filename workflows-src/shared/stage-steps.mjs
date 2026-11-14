// What every stage does alike. RUNNER_SCHEMA comes from the stage's own pb-inline line, and buildKey, buildLabel,
// shellWord and the spent-line wording from its pb-inline-module lines.

// The output tokens the run had spent when this stage began, so the finish runner can report what the stage itself spent.
const spentAtStart = budget.spent();
// Only the finish runner reports the stage's own spend, never less than zero.
const spentLines = (commands) =>
  commands.some(isFinishWords)
    ? [spentTokensLine(Math.max(0, Math.floor(budget.spent() - spentAtStart)))]
    : [];

const isMissing = (value) => value === undefined || value === null || value === '';

function missingArgument() {
  if (isMissing(args.task)) return { started: false, reason: 'args.task is required' };
  if (isMissing(args.pluginRoot)) return { started: false, reason: 'args.pluginRoot is required' };
  return null;
}

const pinnedKey = (schema, pbKey) => ({
  ...schema,
  properties: { ...schema.properties, pb_key: { ...schema.properties.pb_key, enum: [pbKey] } },
});

// The serialized task cannot end its block or start a line of its own.
const taskBlock = () => ['<task>', JSON.stringify(args.task).replace(/</g, '\\u003c'), '</task>'];

const pbCommand = (words) => `node ${shellWord(`${args.pluginRoot}/cli/pb.mjs`)} ${words}`;

// The CLI commits and proves the evidence, so the runner only runs the words it is given. A stage that runs it more than
// once gives each run its own round, since a key is one return. spawn counts it, for a stage that keeps a count.
async function runCommands(stage, commands, { tddPhase = null, item = null, round = 1, spawn = agent } = {}) {
  phase('runner');
  const role = 'runner';
  const pbKey = buildKey({ stage, role, item, round, attempt: args.attempt });
  const label = buildLabel({ stage, phase: tddPhase, role, item, round });
  const prompt = [
    'Run the commands below, in order, exactly as written.',
    returnKeyLine(pbKey),
    ...spentLines(commands),
    '',
    '<commands>',
    ...commands.map(pbCommand),
    '</commands>',
  ].join('\n');
  const result = await spawn(prompt, { agentType: 'pairingbuddy:runner', label, schema: pinnedKey(RUNNER_SCHEMA, pbKey) });
  return { pbKey, label, result };
}

// What a stage that reviewed its work tells the session first: review, how each finding ended (lensAttack's review), then
// result, what the stage ends with: the artifact the last kept fix wrote, else the stage's own first return. The round's
// pre-fix lists stay behind these, under lensAttack.
const endState = (lensResult, result) => ({ review: lensResult.review, result: lensResult.final ?? result });

// The early return for a lens round that stopped the stage, or null to carry on. A step-failed stop always needs a stop runner; an attempt-cap stop only when the fix loop has not recorded it already.
async function fixStop(stage, lensResult, round) {
  const reason = lensResult.stopReason;
  if (reason !== 'step-failed' && reason !== 'attempt-cap') return null;
  const early = { started: true, stopReason: reason, review: lensResult.review, lensAttack: lensResult };
  if (reason === 'attempt-cap' && lensResult.stopRecorded === true) return early;
  const runner = await runCommands(stage, [`stage stop ${reason}`], { round });
  return { ...early, runner };
}
