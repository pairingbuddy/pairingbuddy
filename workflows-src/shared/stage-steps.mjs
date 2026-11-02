// What every stage does alike. RUNNER_SCHEMA comes from the stage's own pb-inline line, and buildKey and buildLabel
// from its pb-inline-module lines.

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

const pbCommand = (words) => `node ${args.pluginRoot}/cli/pb.mjs ${words}`;

// The stage's last step. The CLI commits and proves the evidence, so the runner only runs the words it is given.
async function runCommands(stage, commands) {
  phase('runner');
  const role = 'runner';
  const pbKey = buildKey({ stage, role, item: null, round: 1, attempt: args.attempt });
  const label = buildLabel({ stage, phase: null, role, item: null, round: 1 });
  const prompt = [
    'Run the commands below, in order, exactly as written.',
    `Return pb_key exactly as: ${pbKey}`,
    '',
    '<commands>',
    ...commands.map(pbCommand),
    '</commands>',
  ].join('\n');
  const result = await agent(prompt, { agentType: 'pairingbuddy:runner', label, schema: pinnedKey(RUNNER_SCHEMA, pbKey) });
  return { pbKey, label, result };
}
