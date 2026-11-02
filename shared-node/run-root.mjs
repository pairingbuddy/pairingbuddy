// Finds the run a path or a session belongs to. Hooks import this, so it uses only built-ins and never calls git.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

// A session id becomes a file name, so one that could climb out of the directory gets no pointer.
const SESSION_ID = /^[\w-][\w.-]*$/;

function holdsRun(dir) {
  const run = join(dir, ".pairingbuddy", "run");
  return existsSync(join(run, "task", "ledger.json")) || existsSync(join(run, "unit.json"));
}

// The first directory at or above `start` whose .pairingbuddy/run/ holds run state. An empty run/ is not a run.
export function findRunRoot(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    if (holdsRun(dir)) return dir;
    if (dir === dirname(dir)) return null;
  }
}

// Outside the worktree, so that a session's run can be found from a cwd that has left it.
export const sessionsDirectory = () => join(tmpdir(), "pairingbuddy-sessions");

const pointerPath = (sessionId) => (typeof sessionId === "string" && SESSION_ID.test(sessionId) ? join(sessionsDirectory(), sessionId) : null);

function readPointer(pointer) {
  try {
    return readFileSync(pointer, "utf8");
  } catch {
    return null;
  }
}

// The run this session was bound to, while that run still exists.
export function boundRunRoot(sessionId) {
  const pointer = pointerPath(sessionId);
  const root = pointer === null ? null : readPointer(pointer);
  return root !== null && isAbsolute(root) && holdsRun(root) ? root : null;
}

export const findSessionRoot = (cwd, sessionId) => findRunRoot(cwd) ?? boundRunRoot(sessionId);

export function bindSession(sessionId, root) {
  const pointer = pointerPath(sessionId);
  if (pointer === null || readPointer(pointer) === root) return;
  try {
    mkdirSync(sessionsDirectory(), { recursive: true, mode: 0o700 });
    const temp = `${pointer}.${process.pid}.tmp`;
    writeFileSync(temp, root, { mode: 0o600 });
    renameSync(temp, pointer);
  } catch {
    // Without a pointer only the walk from the cwd finds the run, which must not cost a run its tools.
  }
}
