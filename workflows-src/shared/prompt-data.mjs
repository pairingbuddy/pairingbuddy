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
const TOOL_RULE = 'Look at files with Read, Glob and Grep. Use Bash only for one plain command, such as running the tests or one git command: never with `&&`, `;`, `|`, `$(...)` or `cd`, and never to echo an environment variable. A compound command waits on a permission prompt that can hold the whole run.';

// Where a prompt's paths are: a redraft that loaded a skill read its inputs under the skill's plugin folder, found nothing
// there, and its reads outside the project asked for permission.
const PATH_RULE = 'Every path in this prompt that does not start with / is relative to the project root, your working directory: read and write it there, never under a skill\'s base directory or the plugin folder.';

// Every agent a stage spawns goes through here, so each prompt opens with the tool rule and the path rule. They go first, so
// a data block stays the prompt's last lines.
const pbAgent = (prompt, options) => agent(`${TOOL_RULE}\n${PATH_RULE}\n\n${prompt}`, options);
