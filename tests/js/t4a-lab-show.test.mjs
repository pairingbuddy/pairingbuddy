import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { setupLab, showLab } = await import("../smoke/t4a-lab.mjs");

const LAB_SCRIPT = fileURLToPath(new URL("../smoke/t4a-lab.mjs", import.meta.url));
const NO_LAB = /No lab yet.*setup/i;

test("show-latest-lab", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "t4a-lab-show-")));
  try {
    const labsRoot = join(root, "labs");
    const older = setupLab({ root: labsRoot, now: new Date(2026, 10, 4, 9, 0, 0) });
    const newer = setupLab({ root: labsRoot, broken: "render", now: new Date(2026, 10, 4, 10, 0, 0) });
    const subject = "add notes for the newer lab";
    writeFileSync(join(newer.repo, "notes.txt"), "x\n");
    execFileSync("git", ["add", "notes.txt"], { cwd: newer.repo });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", subject], { cwd: newer.repo });

    const report = showLab({ root: labsRoot });

    assert.ok(report.includes(newer.dir), "the report names the newest lab's path");
    assert.ok(!report.includes(older.dir), "the report omits the older lab");
    assert.match(report, /broken render/, "the report names the lab's mode");
    assert.ok(report.includes(subject), "the report lists the commit made after the base");
    assert.match(report, /no ledger yet/, "a missing ledger reads as no ledger yet");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function withTempRoot(body) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "t4a-lab-none-")));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("show-no-lab-empty-root", () => {
  withTempRoot((root) => {
    const empty = join(root, "empty");
    mkdirSync(empty);

    const report = showLab({ root: empty });

    assert.match(report, NO_LAB, "an empty root says to run setup first");
  });
});

test("show-no-lab-missing-root", () => {
  withTempRoot((root) => {
    const missing = join(root, "missing");

    const report = showLab({ root: missing });

    assert.match(report, NO_LAB, "a missing root says to run setup first");
  });
});

test("show-no-lab-cli", () => {
  withTempRoot((root) => {
    const empty = join(root, "empty");
    mkdirSync(empty);

    const cli = spawnSync(process.execPath, [LAB_SCRIPT, "show"], { env: { ...process.env, T4A_LABS: empty }, encoding: "utf8" });

    assert.notEqual(cli.status, 0, "the CLI exits non-zero when there is no lab");
    assert.match(cli.stdout + cli.stderr, NO_LAB, "the CLI prints the setup hint");
  });
});

function withLab(body) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "t4a-lab-state-")));
  try {
    const lab = setupLab({ root: join(root, "labs"), now: new Date(2026, 10, 4, 11, 0, 0) });
    body(lab, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("show-ledger-and-reports", async (t) => {
  await t.test("a readable ledger shows the stage name and status", () => {
    withLab((lab, root) => {
      const dir = join(lab.repo, ".pairingbuddy/run/task");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "ledger.json"), JSON.stringify({ stage: { name: "code-tdd", status: "active" } }));

      const report = showLab({ root: join(root, "labs") });

      assert.match(report, /code-tdd active/, "the report shows the stage name and status");
    });
  });

  await t.test("an invalid ledger shows ledger unreadable", () => {
    withLab((lab, root) => {
      const dir = join(lab.repo, ".pairingbuddy/run/task");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "ledger.json"), "{not json");

      const report = showLab({ root: join(root, "labs") });

      assert.match(report, /ledger unreadable/, "the report flags the corrupt ledger");
    });
  });

  await t.test("every file in the reports folder is listed", () => {
    withLab((lab, root) => {
      const dir = join(lab.repo, ".pairingbuddy/reports");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "alpha.md"), "a\n");
      writeFileSync(join(dir, "beta.md"), "b\n");

      const report = showLab({ root: join(root, "labs") });

      assert.ok(report.includes("alpha.md"), "the report lists the first file");
      assert.ok(report.includes("beta.md"), "the report lists the second file");
    });
  });
});
