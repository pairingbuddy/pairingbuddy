// The runner prompt's own wording, written by a workflow stage and read back from the harness transcript by stage-run.
// Workflow bundles inline this file, so it imports nothing.
export const RETURN_KEY_PREFIX = 'Return pb_key exactly as: ';
export const FINISH_WORDS = 'stage finish';
const SPENT_TOKENS_PREFIX = 'pb_spent_output_tokens: ';
export const TOKENS_UNIT = 'output tokens';

export const returnKeyLine = (pbKey) => `${RETURN_KEY_PREFIX}${pbKey}`;

// The pb key text of a return key line, or null for any other line.
export const returnKeyOf = (line) => (line.startsWith(RETURN_KEY_PREFIX) ? line.slice(RETURN_KEY_PREFIX.length) : null);

export const spentTokensLine = (tokens) => `${SPENT_TOKENS_PREFIX}${tokens}`;

// The token count of a spent line, or null for any other line.
export const spentTokensOf = (line) => {
  if (!line.startsWith(SPENT_TOKENS_PREFIX)) return null;
  const count = line.slice(SPENT_TOKENS_PREFIX.length);
  return /^\d+$/.test(count) ? Number(count) : null;
};

// Whether a command words string finishes the stage.
export const isFinishWords = (words) => words === FINISH_WORDS;

// Whether a rendered command line is the stage finish command: a pb.mjs path, shell-quoted or not, then the finish words.
export const isFinishCommand = (line) => line.endsWith(`pb.mjs ${FINISH_WORDS}`) || line.endsWith(`pb.mjs' ${FINISH_WORDS}`);
