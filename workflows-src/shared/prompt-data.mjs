// Prompt data helpers. A value goes into a prompt as one JSON string with "<" escaped, so it cannot close its XML-ish tag or pass for an instruction.

function asPromptData(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// The corpus paths are evidence to read, one escaped JSON line per path, or 'none' when the corpus is empty or not an array.
function corpusBlock(corpus) {
  return Array.isArray(corpus) && corpus.length > 0 ? corpus.map(asPromptData).join('\n') : 'none';
}

// The tool rule every agent's definition carries (contracts/agent-config.yaml, focus_warning), said again in each prompt: an
// agent that inspected files with a compound Bash call waited on a permission prompt mid-stage.
const TOOL_RULE = 'Look at files with Read. Find and search with Glob and Grep when they exist, otherwise with one plain `find` or `grep` Bash command. Use Bash only for one plain command, such as running the tests or one git command: never with `&&`, `;`, `|`, `$(...)` or `cd`, and never to echo an environment variable. A compound command waits on a permission prompt that can hold the whole run.';

// The tool rule of the agents the gate confines to Read, Grep and Glob (contracts/agent-config.yaml, confined_tool_rule): on a
// Claude Code build with no Glob or Grep they cannot search, so they read the files their input names instead of reaching
// for a Bash call the gate denies.
const CONFINED_TOOL_RULE = 'You have Read, Grep and Glob, and no Bash: the gate denies every other tool. Look at files with Read. Find and search with Glob and Grep when they exist. Where they do not, do not search: read the files your input names (the subject, the corpus, the findings, the diff) and the files they point at, and say in your return what you could not read that way.';
const CONFINED_AGENT_TYPES = ['pairingbuddy:lens', 'pairingbuddy:refuter', 'pairingbuddy:synthesizer', 'pairingbuddy:course-checker'];
const toolRuleFor = (agentType) => (CONFINED_AGENT_TYPES.includes(agentType) ? CONFINED_TOOL_RULE : TOOL_RULE);

// Where a prompt's paths are: a redraft that loaded a skill read its inputs under the skill's plugin folder, found nothing
// there, and its reads outside the project asked for permission.
const PATH_RULE = 'Every path in this prompt that does not start with / is relative to the project root, your working directory: read and write it there, never under a skill\'s base directory or the plugin folder.';

// Every agent a stage spawns goes through here, so each prompt opens with the tool rule and the path rule. They go first, so
// a data block stays the prompt's last lines.
const pbAgent = (prompt, options) => agent(`${toolRuleFor(options?.agentType)}\n${PATH_RULE}\n\n${prompt}`, options);
