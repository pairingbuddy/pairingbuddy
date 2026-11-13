import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildFindingId, buildKey, fixAttemptRound, isFindingId, lensSlug, parseKey } from "../../shared-node/keys.mjs";
import { buildLabel, parseLabel, readLabel } from "../../shared-node/labels.mjs";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

const { rows } = readJson("../../contracts/lenses.json");
const verdictSchema = readJson("../../contracts/schemas/refuter-verdict.schema.json");

const FINDINGS_PER_LENS = 2;
const MAX_ATTEMPTS = 5;

function instance({ stage }, { phase = null, role, item = null, round = 1 }) {
  return {
    role,
    item,
    round,
    key: buildKey({ stage, role, item, round, attempt: 1 }),
    label: buildLabel({ stage, phase, role, item, round }),
  };
}

function findingsOf(row) {
  return row.lenses.flatMap(({ name }) => Array.from({ length: FINDINGS_PER_LENS }, (_, n) => ({ id: buildFindingId({ lens: name, index: n + 1 }), lens: name })));
}

function refutedFindings(row) {
  return row.refute === "none" ? [] : findingsOf(row).slice(0, row.maxRefuters);
}

// One fix group takes two attempts, since a rejected fix retries within its group.
function fixInstances(row) {
  if (row.fix !== "course-checker") return [];
  return Array.from({ length: MAX_ATTEMPTS }, (_, n) => {
    const round = fixAttemptRound(n + 1);
    const item = `g${Math.ceil((n + 1) / 2)}`;
    return [instance(row, { role: "fix", item, round }), instance(row, { role: "course-checker", item, round })];
  }).flat();
}

function instancesOf(row) {
  return [
    ...(row.agents ?? []).map((agent) => instance(row, agent)),
    ...row.lenses.map(({ name }) => instance(row, { role: "lens", item: lensSlug(name) })),
    ...(row.bias ? [instance(row, { role: "bias-check" })] : []),
    ...(row.synth ? [instance(row, { role: "synthesizer" })] : []),
    ...refutedFindings(row).map(({ id }) => instance(row, { role: "refuter", item: id })),
    ...fixInstances(row),
  ];
}

// A stand-in for what the tap captures from a refuter: the schema's fields, nothing read from prose.
function verdictFrom({ key }, findingId) {
  return { pb_key: key, finding_id: findingId, verdict: "refuted" };
}

test("the lens map covers every D8 row and names a model per lens", () => {
  assert.equal(new Set(rows.map(({ row }) => row)).size, 18, "D8 has 18 rows");
  for (const row of rows) {
    assert.ok(row.lenses.length > 0 || row.agents?.length > 0, `${row.row} runs at least one agent`);
    for (const lens of row.lenses) assert.ok(lens.model, `${row.row} ${lens.name} names a model`);
  }
});

test("every row generates labels and keys that read back as their parts", () => {
  for (const row of rows) {
    const instances = instancesOf(row);
    assert.ok(instances.length > 0, `${row.row} generated nothing`);
    for (const { key, label, role, item, round } of instances) {
      assert.deepEqual(parseKey(key), { stage: row.stage, role, item, round, attempt: 1 }, key);
      const read = readLabel(label);
      assert.equal(read.unknown, false, label);
      assert.deepEqual({ stage: read.stage, role: read.role, item: read.item, round: read.round }, { stage: row.stage, role, item, round }, label);
    }
  }
});

test("no two agents in a row share a key or a label", () => {
  for (const row of rows) {
    const instances = instancesOf(row);
    assert.equal(new Set(instances.map(({ key }) => key)).size, instances.length, `${row.row} keys`);
    assert.equal(new Set(instances.map(({ label }) => label)).size, instances.length, `${row.row} labels`);
  }
});

test("every key is a safe lowercase file name", () => {
  for (const row of rows) {
    for (const { key } of instancesOf(row)) {
      assert.match(key, /^[a-z0-9][a-z0-9._-]*$/, key);
      assert.ok(Buffer.byteLength(`${key}.json`) <= 255, `${key} fits a file name`);
    }
  }
});

test("key parts cannot start with a dash", () => {
  const ok = { stage: "tdd", role: "implement-tests", item: "t3", round: 1, attempt: 1 };

  for (const part of ["stage", "role", "item"]) {
    assert.throws(() => buildKey({ ...ok, [part]: "--force" }), `${part} takes no leading dash`);
  }
  assert.throws(() => buildKey({ ...ok, stage: "-" }), "a dash is no stage");
  assert.throws(() => buildKey({ ...ok, role: "-" }), "a dash is no role");
  assert.throws(() => parseKey("-.implement-tests.t3.r1.a1"), /malformed key/);
  assert.throws(() => parseKey("tdd.implement-tests.--force.r1.a1"), /malformed key/);
});

test("each refuter joins to its finding through fields alone", () => {
  let joined = 0;
  for (const row of rows) {
    const findings = new Map(findingsOf(row).map((finding) => [finding.id, finding]));
    for (const finding of refutedFindings(row)) {
      const refuter = instance(row, { role: "refuter", item: finding.id });
      const verdict = verdictFrom(refuter, finding.id);

      assert.deepEqual(findings.get(verdict.finding_id), finding, `${row.row}: the verdict names its finding`);
      assert.deepEqual(findings.get(parseKey(verdict.pb_key).item), finding, `${row.row}: the key names its finding`);
      assert.deepEqual(findings.get(parseLabel(refuter.label).item), finding, `${row.row}: the label names its finding`);
      joined += 1;
    }
  }
  assert.ok(joined > 0, "some refuter was joined");
});

test("a refuter with no finding id has no key and no label", () => {
  const key = { stage: "scenarios", role: "refuter", round: 1, attempt: 1 };
  const label = { stage: "scenarios", phase: null, role: "refuter", round: 1 };

  for (const item of [null, undefined, "-", "t3", "necessity"]) {
    assert.throws(() => buildKey({ ...key, item }), /finding id/, `key with item ${item}`);
    assert.throws(() => buildLabel({ ...label, item }), /finding id/, `label with item ${item}`);
  }
  assert.throws(() => parseKey("scenarios.refuter.-.r1.a1"), /finding id/);
  assert.throws(() => parseLabel("pb1 scenarios - refuter - r1"), /malformed label/);
});

test("a finding id comes from the lens name and its position", () => {
  assert.equal(buildFindingId({ lens: "corpus misalignment", index: 2 }), "corpus-misalignment-2");
  assert.equal(buildFindingId({ lens: "PR-unit fit", index: 1 }), "pr-unit-fit-1");
  assert.ok(isFindingId("anti-patterns-12"));
  for (const bad of ["", "-", "t3", "necessity", "necessity-0", "necessity-01", "-1", "a b-1", "A-1", "a.b-1", "../a-1", "a-1\n", `${"x".repeat(63)}-1`, 1, null]) {
    assert.equal(isFindingId(bad), false, JSON.stringify(bad));
  }
  assert.throws(() => buildFindingId({ lens: "x".repeat(63), index: 1 }), /finding id/);
  assert.throws(() => buildFindingId({ lens: "necessity", index: 0 }), /positive integer/);
});

test("a lens name no slug can carry is refused", () => {
  assert.equal(lensSlug("  testable   acceptance criteria "), "testable-acceptance-criteria");
  for (const bad of ["", "   ", "a/b", "a.b", "é", "--x", 5, null]) {
    assert.throws(() => lensSlug(bad), `lensSlug must refuse ${JSON.stringify(bad)}`);
  }
});

test("each fix attempt has its own round, and a course checker never takes the lens round", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(fixAttemptRound), [2, 3, 4, 5, 6], "fix attempt n is round n+1");
  assert.throws(() => fixAttemptRound(0), /positive integer/);

  const row = rows.find(({ stage }) => stage === "scenarios");
  const checkers = fixInstances(row).filter(({ role }) => role === "course-checker");
  assert.deepEqual(checkers.map(({ round }) => round), [2, 3, 4, 5, 6], "attempts are counted across fix groups");
  assert.equal(parseLabel(checkers[4].label).role, "course-checker");

  assert.throws(() => buildKey({ stage: "scenarios", role: "course-checker", item: "g1", round: 1, attempt: 1 }), /round/);
  assert.throws(() => buildLabel({ stage: "scenarios", phase: null, role: "course-checker", item: "g1", round: 1 }), /round/);
  assert.throws(() => parseKey("scenarios.course-checker.g1.r1.a1"), /round/);
  assert.throws(() => parseLabel("pb1 scenarios - course-checker g1 r1"), /malformed label/);
});

test("a label carries no free text", () => {
  const ok = { stage: "scenarios", phase: null, role: "lens", item: "necessity", round: 1 };

  for (const part of ["stage", "role", "item"]) {
    for (const bad of ["Corpus", "a.b", "a/b", "é", "--x", "x".repeat(65)]) {
      assert.throws(() => buildLabel({ ...ok, [part]: bad }), `${part} refuses ${JSON.stringify(bad)}`);
    }
  }
  assert.throws(() => buildLabel({ ...ok, phase: "red" }), "phase is a tdd phase");
  assert.throws(() => buildLabel({ ...ok, phase: "VERIFY" }), "phase is a tdd phase");
  for (const phase of ["RED", "GREEN", "REFACTOR"]) {
    assert.equal(parseLabel(buildLabel({ ...ok, phase })).phase, phase);
  }
});

test("a label failing the regex is reported as unknown, with its raw text", () => {
  const drifted = [
    "",
    "review the auth module",
    "pb2 tdd RED implement-tests t3 r1",
    "pb1 tdd RED implement-tests t3",
    "pb1 tdd red implement-tests t3 r1",
    "pb1 tdd VERIFY implement-tests t3 r1",
    "pb1 Tdd RED implement-tests t3 r1",
    "pb1 scenarios - lens corpus/misalignment r1",
    "pb1 scenarios - refuter - r1",
    "pb1 scenarios - refuter necessity r1",
    "pb1 scenarios - course-checker g1 r1",
  ];

  for (const text of drifted) {
    assert.deepEqual(readLabel(text), { unknown: true, raw: text }, JSON.stringify(text));
  }
  assert.deepEqual(readLabel(undefined), { unknown: true, raw: "undefined" }, "a spawn with no label is unknown too");
  assert.equal(drifted.map(readLabel).filter(({ unknown }) => unknown).length, drifted.length, "drift is counted, never dropped");
  assert.deepEqual(
    readLabel("pb1 tdd RED implement-tests t3 r1"),
    { unknown: false, stage: "tdd", phase: "RED", role: "implement-tests", item: "t3", round: 1 },
    "a good label reads as its parts",
  );
  assert.deepEqual(
    readLabel("pb1 code-tdd RED implement-tests zero-percent-keeps-full-price r3"),
    { unknown: false, stage: "code-tdd", phase: "RED", role: "implement-tests", item: "zero-percent-keeps-full-price", round: 3 },
    "a code-tdd label reads as its parts",
  );
});

test("the verdict schema carries the finding id, with the key's own rule", () => {
  assert.deepEqual([...verdictSchema.required].sort(), ["finding_id", "pb_key", "verdict"]);
  assert.equal(verdictSchema.additionalProperties, false);
  assert.deepEqual(verdictSchema.properties.verdict.enum, ["survives", "refuted"], "the values name the buckets D8 returns");

  const pattern = new RegExp(verdictSchema.properties.finding_id.pattern);
  const candidates = [...rows.flatMap(findingsOf).map(({ id }) => id), "", "-", "t3", "necessity", "necessity-0", "A-1", "a b-1", "a-1\n", `${"x".repeat(62)}-1`, `${"x".repeat(63)}-1`];
  for (const id of candidates) {
    assert.equal(pattern.test(id), isFindingId(id), `schema and key agree on ${JSON.stringify(id)}`);
  }
});

test("keys and labels agree on what a finding id is, and inline into one scope", () => {
  const read = (name) => readFileSync(new URL(`../../shared-node/${name}`, import.meta.url), "utf8").replace(/^export /gm, "");
  const sut = new Function(`${read("keys.mjs")}\n${read("labels.mjs")}\nreturn { buildKey, buildLabel, readLabel };`)();
  const label = { stage: "scenarios", phase: null, role: "refuter", round: 1 };
  const key = { stage: "scenarios", role: "refuter", round: 1, attempt: 1 };

  for (const item of ["necessity-1", `${"x".repeat(61)}-12`, "necessity", "t3", "necessity-0", "a_b-1", `${"x".repeat(62)}-12`]) {
    const built = (build) => { try { build(); return true; } catch { return false; } };
    assert.equal(built(() => sut.buildLabel({ ...label, item })), built(() => sut.buildKey({ ...key, item })), item);
  }
  assert.equal(sut.readLabel("pb1 scenarios - refuter - r1").unknown, true);
});
