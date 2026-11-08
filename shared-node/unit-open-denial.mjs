// The rule for a model's `pb unit open` outside a run. Kept apart from gate-rules.mjs so that the no-run Bash path
// loads only the shell reading. Node built-ins only.
import { disguisesPb, pbUnitOpenCalls, pbWithEnvironment } from "./shell-calls.mjs";
import { shellWord } from "./shell-word.mjs";
import { typedCommand } from "./verbs.mjs";

// Strips the quoting a shell removes before it reads words. The one copy: gate-rules.mjs imports it.
export const SHELL_QUOTING = /\\\n|\$(?=['"])|['"\\]/g;
const MENTIONS_UNIT_OPEN = /\bunit\s+open\b/;
const CONFIRMING_FLAG = /^--(yes|branch)(=|$)/;

// A model's `pb unit open` that is not a plain call, or that confirms (--yes) or names a branch (--branch) is denied; the caller has already let
// the auto policy through. Interactive, the human confirms by typing the command. Returns the reason, or null to allow.
export function unitOpenDenial(payload, { denyBuiltWords = false } = {}) {
  const command = payload?.tool_input?.command;
  if (payload?.tool_name !== "Bash" || typeof command !== "string") return null;
  const calls = pbUnitOpenCalls(command);
  const disguised = disguisesPb(command);
  const mentionsUnitOpen = MENTIONS_UNIT_OPEN.test(command.replace(SHELL_QUOTING, "")) || calls.length > 0;
  // With no run (denyBuiltWords), any disguised pb call is denied: words a shell builds cannot be shown not to spell a
  // confirming unit open, and no other rule reads the command. In a run, checkBash denies those with its own message.
  if (!mentionsUnitOpen && !(denyBuiltWords && disguised)) return null;
  if (disguised || (calls.length > 0 && pbWithEnvironment(command))) {
    return "Outside the auto policy, pb unit open must be a plain call: its words cannot come from a variable, a substitution or a shell function, and it takes no environment prefix. Ask the human to type it, with its leading !.";
  }
  const call = calls.find(({ rest }) => rest.some((word) => CONFIRMING_FLAG.test(word)));
  if (call === undefined) return null;
  const args = call.rest.slice(2).map(shellWord).join(" ");
  const typed = typedCommand(payload.cwd ?? process.cwd(), `unit open${args === "" ? "" : ` ${args}`}`);
  return `Only the auto policy lets the model confirm a unit. Ask the human to type this at the prompt, with its leading !: ${typed}`;
}
