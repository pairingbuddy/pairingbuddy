// Scenario: stop-code-plain-names. Every stop code the CLI can write has a plain name in shared-node/plain-names.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { plainName } from "../../shared-node/plain-names.mjs";
import * as verbs from "../../shared-node/verbs.mjs";
import { STOP_CODES, ATTEMPT_CAP, MISSING_ARTIFACT, COMMIT_PLAN_UNUSABLE, COMMIT_FAILED, NO_SELECTOR_TEMPLATE, HUMAN_STOPPED } from "../../shared-node/verbs.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// The text of the {...} object opening at `open`, braces balanced (template ${...} included).
function objectAt(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

const refOf = (ref) => (ref.startsWith('"') ? ref.slice(1, -1) : verbs[ref]);

// Scans cli/ and shared-node/ for every place a stop is built, and classifies each one. Anything it cannot classify is
// returned in `unclassified`, so a new write shape fails the test instead of being skipped.
//   written:     code: X in a stop object, or the code argument of orStop(); X is a string literal or a verbs.mjs export
//   passedCode:  a stop object with the shorthand `code`, fed by a variable (orStop's parameter, stageStop's argument)
//   unclassified: any other `stop:` or `stop =` that is not a clear (null), a validity-table entry or a stop object, or an orStop call of another shape
function scanStopWrites() {
  const scan = { written: [], passedCode: [], unclassified: [] };
  for (const dir of ["cli", "shared-node"]) {
    for (const file of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".mjs"))) {
      const path = `${dir}/${file}`;
      const text = readFileSync(join(ROOT, dir, file), "utf8").replace(/^\s*\/\/.*$/gm, "");
      for (const m of text.matchAll(/\bstop\s*[:=](?!=)\s*/g)) {
        const rest = text.slice(m.index + m[0].length);
        const open = rest.match(/^(?:ledger\.stop \?\? )?\{/);
        if (open) {
          const body = objectAt(rest, open[0].length - 1);
          const literal = body.match(/[{,]\s*code:\s*(\w+|"[^"]+")/);
          if (literal) scan.written.push({ file: path, ref: literal[1], code: refOf(literal[1]) });
          else if (/[{,]\s*code\s*[,}]/.test(body)) scan.passedCode.push({ file: path });
          else scan.unclassified.push({ file: path, text: body.slice(0, 80) });
        } else if (!/^(null\b|\w+ \? null : ledger\.stop\b|\[\(\) =>)/.test(rest)) {
          scan.unclassified.push({ file: path, text: rest.slice(0, 80) });
        }
      }
      for (const m of text.matchAll(/(?<!function )orStop\(/g)) {
        const call = text.slice(m.index).match(/^orStop\([^,]+,\s*\{[^}]*\},\s*(\w+|"[^"]+")/);
        if (call) scan.written.push({ file: path, ref: call[1], code: refOf(call[1]) });
        else scan.unclassified.push({ file: path, text: text.slice(m.index, m.index + 80) });
      }
    }
  }
  return scan;
}

test("every-cli-stop-code-has-plain-name: STOP_CODES is not empty", () => {
  assert.ok(STOP_CODES.length > 0, "STOP_CODES is empty");
});

for (const code of STOP_CODES) {
  test(`every-cli-stop-code-has-plain-name: ${code}`, () => {
    const name = plainName(code);

    assert.equal(typeof name, "string", `stop code ${code} has no plain name`);
    assert.notEqual(name.trim(), "", `stop code ${code} has an empty plain name`);
  });
}

for (const code of STOP_CODES) {
  test(`plain-names-are-plain-words: ${code}`, () => {
    const name = plainName(code);

    assert.ok(!name.includes(code), `plain name "${name}" contains the raw id ${code}`);
    assert.doesNotMatch(name, /[A-Za-z0-9][-_][A-Za-z0-9]/, `plain name "${name}" for ${code} reads as an identifier, not words`);
  });
}

test("unmapped-code-detected: every stop the source builds is classified", () => {
  const { unclassified } = scanStopWrites();

  assert.deepEqual(unclassified, [], "stop writes the scan cannot classify; teach scanStopWrites the new shape");
});

test("unmapped-code-detected: every code reference resolves to a code", () => {
  const { written } = scanStopWrites();

  const unresolved = written.filter(({ code }) => code === undefined);

  assert.deepEqual(unresolved, [], "stop codes written through identifiers verbs.mjs does not export");
});

test("unmapped-code-detected: the source writes exactly the known codes", () => {
  const { written } = scanStopWrites();

  const codes = [...new Set(written.map(({ code }) => code))].sort();

  assert.deepEqual(codes, [ATTEMPT_CAP, COMMIT_FAILED, COMMIT_PLAN_UNUSABLE, HUMAN_STOPPED, MISSING_ARTIFACT, NO_SELECTOR_TEMPLATE].sort());
});

test("unmapped-code-detected: the stage codes come through the shorthand stop in cli/pb.mjs", () => {
  const { passedCode } = scanStopWrites();

  assert.deepEqual(passedCode, [{ file: "cli/pb.mjs" }, { file: "cli/pb.mjs" }], "stop objects fed by a code variable");
});

test("unmapped-code-detected: every code written by the source is in STOP_CODES", () => {
  const { written } = scanStopWrites();

  const unlisted = written.filter(({ code }) => !STOP_CODES.includes(code));

  assert.deepEqual(unlisted, [], "codes written by the CLI that are not in STOP_CODES");
});
