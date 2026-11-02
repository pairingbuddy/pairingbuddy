import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { test } from "node:test";

const pidFile = process.env.HANG_PID_FILE;
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
if (pidFile) writeFileSync(pidFile, `${process.pid}\n${grandchild.pid}\n`);
process.stderr.write("hang fixture started\n");

test("fixture hangs forever", () => new Promise(() => setInterval(() => {}, 1000)));
