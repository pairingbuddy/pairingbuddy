// Session pointers live under os.tmpdir() and are keyed by session id, and the fixtures share their ids. Node runs
// test files in parallel, so each file imports this first and gets a temp root of its own, which also keeps
// test pointers out of the real one. Spawned hooks inherit it through TMPDIR.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "pb-js-tests-")));
process.env.TMPDIR = dir;
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
