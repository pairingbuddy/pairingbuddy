import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildKey, parseKey } from "../../shared-node/keys.mjs";
import { buildLabel, parseLabel } from "../../shared-node/labels.mjs";

// Parts are passed as one object: { stage, role, item, round, attempt } for keys,
// { stage, phase, role, item, round } for labels. A "-" item or phase in the
// string form is the null value in the object form.

// stage-keys
test("key-missing-item-builds-as-dash", () => {
  assert.equal(buildKey({ stage: "tdd", role: "implement-tests", round: 1, attempt: 1 }), "tdd.implement-tests.-.r1.a1", "an omitted item builds as -");
});

test("key-rejects-non-string-parts-with-the-part-named", () => {
  const ok = { stage: "tdd", role: "implement-tests", item: "t3", round: 1, attempt: 1 };

  assert.throws(() => buildKey({ ...ok, stage: ["tdd"] }), /key stage must be a non-empty string/, "an array is not a stage");
  assert.throws(() => buildKey({ ...ok, role: 5 }), /key role must be a non-empty string/, "a number is not a role");
});

test("key-parse-rejects-whitespace-in-role", () => {
  assert.throws(() => parseKey("tdd.implement tests.t3.r1.a1"), /malformed key/, "a role with a space is not a key");
});

test("key-round-trip", () => {
  const parts = { stage: "tdd", role: "implement-tests", item: "t3", round: 1, attempt: 2 };

  const key = buildKey(parts);

  assert.equal(key, "tdd.implement-tests.t3.r1.a2", "key follows <stage>.<role>.<item>.r<round>.a<attempt>");
  assert.deepEqual(parseKey(key), parts, "parseKey returns the original parts");
});

test("key-dash-item-round-trip", () => {
  const expected = "tdd.implement-tests.-.r1.a1";

  assert.equal(buildKey({ stage: "tdd", role: "implement-tests", item: null, round: 1, attempt: 1 }), expected, "null item builds as -");
  assert.equal(buildKey({ stage: "tdd", role: "implement-tests", item: "-", round: 1, attempt: 1 }), expected, "- item builds as -");
  assert.deepEqual(
    parseKey(expected),
    { stage: "tdd", role: "implement-tests", item: null, round: 1, attempt: 1 },
    "- parses back to the no-item value",
  );
});

test("key-rejects-dot-in-part", () => {
  const ok = { stage: "tdd", role: "implement-tests", item: "t3", round: 1, attempt: 1 };

  assert.throws(() => buildKey({ ...ok, stage: "t.dd" }), "dot in stage");
  assert.throws(() => buildKey({ ...ok, role: "implement.tests" }), "dot in role");
  assert.throws(() => buildKey({ ...ok, item: "t.3" }), "dot in item");
});

test("key-rejects-whitespace-in-part", () => {
  const ok = { stage: "tdd", role: "implement-tests", item: "t3", round: 1, attempt: 1 };

  for (const [name, bad] of [["space", "t 3"], ["tab", "t\t3"], ["newline", "t\n3"], ["leading space", " t3"], ["trailing newline", "t3\n"]]) {
    assert.throws(() => buildKey({ ...ok, stage: bad }), `${name} in stage`);
    assert.throws(() => buildKey({ ...ok, role: bad }), `${name} in role`);
    assert.throws(() => buildKey({ ...ok, item: bad }), `${name} in item`);
  }
});

test("key-rejects-empty-part-and-non-positive-numbers", () => {
  const ok = { stage: "tdd", role: "implement-tests", item: "t3", round: 1, attempt: 1 };

  assert.throws(() => buildKey({ ...ok, stage: "" }), "empty stage");
  assert.throws(() => buildKey({ ...ok, role: "" }), "empty role");
  assert.throws(() => buildKey({ ...ok, item: "" }), "empty item");
  assert.throws(() => buildKey({ ...ok, round: 0 }), "round 0");
  assert.throws(() => buildKey({ ...ok, round: -1 }), "negative round");
  assert.throws(() => buildKey({ ...ok, attempt: 0 }), "attempt 0");
  assert.throws(() => buildKey({ ...ok, attempt: -2 }), "negative attempt");
  assert.throws(() => buildKey({ ...ok, round: 1.5 }), "fractional round");
  assert.throws(() => buildKey({ ...ok, attempt: 1.5 }), "fractional attempt");
  assert.throws(() => buildKey({ ...ok, round: "1" }), "numeric-string round");
  assert.throws(() => buildKey({ ...ok, attempt: "1" }), "numeric-string attempt");
});

test("key-parse-rejects-malformed", () => {
  const malformed = [
    "",
    "tdd.implement-tests.t3.r1",
    "tdd.implement-tests.t3.r1.a1.extra",
    "tdd.implement-tests.t3.1.a1",
    "tdd.implement-tests.t3.r1.1",
    "tdd.implement-tests.t3.rx.a1",
    "tdd.implement-tests.t3.r0.a1",
    "tdd.implement-tests.t3.r1.a0",
    "tdd.implement-tests.t3.r-1.a1",
    "tdd.implement-tests.t3.r01.a1",
    "tdd.implement-tests.t3.r1.a01",
    "x.tdd.implement-tests.t3.r1.a1",
    "tdd.implement-tests.t.3.r1.a1",
    "tdd.implement-tests.t 3.r1.a1",
    "tdd.implement-tests.t\t3.r1.a1",
    "tdd.implement-tests.t3.r1.a1\n",
    " tdd.implement-tests.t3.r1.a1",
    "tdd..t3.r1.a1",
    "..t3.r1.a1",
  ];

  for (const text of malformed) {
    assert.throws(() => parseKey(text), `parseKey must reject ${JSON.stringify(text)}`);
  }
});

// stage-labels
test("label-round-trip", () => {
  const parts = { stage: "tdd", phase: "RED", role: "implement-tests", item: "t3", round: 1 };

  const label = buildLabel(parts);

  assert.equal(label, "pb1 tdd RED implement-tests t3 r1", "label follows D10");
  assert.deepEqual(parseLabel(label), parts, "parseLabel returns the original parts");
});

test("label-dash-phase-and-item-round-trip", () => {
  const expected = "pb1 plan - brainstorm - r2";

  assert.equal(buildLabel({ stage: "plan", phase: null, role: "brainstorm", item: null, round: 2 }), expected, "null phase and item build as -");
  assert.equal(buildLabel({ stage: "plan", phase: "-", role: "brainstorm", item: "-", round: 2 }), expected, "- phase and item build as -");
  assert.deepEqual(
    parseLabel(expected),
    { stage: "plan", phase: null, role: "brainstorm", item: null, round: 2 },
    "- parses back to the no-phase and no-item values",
  );
});

test("label-rejects-space-in-part", () => {
  const ok = { stage: "tdd", phase: "RED", role: "implement-tests", item: "t3", round: 1 };

  assert.throws(() => buildLabel({ ...ok, stage: "t dd" }), "space in stage");
  assert.throws(() => buildLabel({ ...ok, phase: "R ED" }), "space in phase");
  assert.throws(() => buildLabel({ ...ok, role: "implement tests" }), "space in role");
  assert.throws(() => buildLabel({ ...ok, item: "t 3" }), "space in item");
});

test("label-rejects-any-whitespace-in-part", () => {
  const ok = { stage: "tdd", phase: "RED", role: "implement-tests", item: "t3", round: 1 };

  for (const [name, bad] of [["tab", "t\t3"], ["newline", "t\n3"], ["non-breaking space", "t\u00a03"], ["trailing newline", "t3\n"]]) {
    for (const part of ["stage", "phase", "role", "item"]) {
      assert.throws(() => buildLabel({ ...ok, [part]: bad }), `${name} in ${part}`);
    }
  }
});

test("label-rejects-empty-part-and-non-positive-round", () => {
  const ok = { stage: "tdd", phase: "RED", role: "implement-tests", item: "t3", round: 1 };

  assert.throws(() => buildLabel({ ...ok, stage: "" }), "empty stage");
  assert.throws(() => buildLabel({ ...ok, phase: "" }), "empty phase");
  assert.throws(() => buildLabel({ ...ok, role: "" }), "empty role");
  assert.throws(() => buildLabel({ ...ok, item: "" }), "empty item");
  assert.throws(() => buildLabel({ ...ok, round: 0 }), "round 0");
  assert.throws(() => buildLabel({ ...ok, round: -1 }), "negative round");
  assert.throws(() => buildLabel({ ...ok, round: 1.5 }), "fractional round");
  assert.throws(() => buildLabel({ ...ok, round: "1" }), "numeric-string round");
});

test("label-parse-rejects-malformed", () => {
  const malformed = [
    "",
    "pb2 tdd RED implement-tests t3 r1",
    "tdd RED implement-tests t3 r1",
    "pb1 tdd RED implement-tests t3",
    "pb1 tdd RED implement-tests r1",
    "pb1 tdd RED implement-tests t3 r1 extra",
    "pb1 tdd RED implement-tests t3 1",
    "pb1 tdd RED implement-tests t3 rx",
    "pb1 tdd RED implement-tests t3 r0",
    "pb1 tdd RED implement-tests t3 r-1",
    "pb1 tdd RED implement-tests t3 r01",
    "pb1 tdd  RED implement-tests t3 r1",
    "pb1 tdd RED implement-tests t3  r1",
    "pb1\ttdd RED implement-tests t3 r1",
    "pb1 tdd RED implement-tests t3\tr1",
    "pb1 tdd RED implement-tests t3 r1\n",
    "pb1  tdd RED implement-tests t3 r1",
    " pb1 tdd RED implement-tests t3 r1",
    "pb1 tdd RED implement-tests t3 r1 ",
  ];

  for (const text of malformed) {
    assert.throws(() => parseLabel(text), `parseLabel must reject ${JSON.stringify(text)}`);
  }
});

// bundled-inline
// The workflow bundle inlines both files into one scope with `export ` stripped, so helper names
// must not clash. Bundler inclusion of shared-node itself is Task 22.
test("keys-and-labels-still-reject-bad-parts-when-concatenated", () => {
  const read = (name) => readFileSync(new URL(`../../shared-node/${name}`, import.meta.url), "utf8").replace(/^export /gm, "");
  const source = `${read("keys.mjs")}\n${read("labels.mjs")}\nreturn { buildKey, parseKey, buildLabel, parseLabel };`;
  const sut = new Function(source)();
  const key = { stage: "tdd", role: "implement-tests", item: "t3", round: 1, attempt: 1 };
  const label = { stage: "tdd", phase: "RED", role: "implement-tests", item: "t3", round: 1 };

  assert.throws(() => sut.buildKey({ ...key, stage: "a.b" }), "dot in key stage");
  assert.throws(() => sut.buildKey({ ...key, item: "x.y" }), "dot in key item");
  assert.throws(() => sut.buildKey({ ...key, role: "a\tb" }), "whitespace in key role");
  assert.throws(() => sut.buildLabel({ ...label, role: "a b" }), "space in label role");
  assert.throws(() => sut.buildLabel({ ...label, item: "" }), "empty label item");
  assert.equal(sut.buildKey(key), "tdd.implement-tests.t3.r1.a1", "valid key still builds");
  assert.equal(sut.buildLabel(label), "pb1 tdd RED implement-tests t3 r1", "valid label still builds");
  assert.throws(() => sut.parseKey("x.tdd.implement-tests.t3.r1.a1"), "parseKey still strict");
  assert.throws(() => sut.parseLabel("pb1  tdd RED implement-tests t3 r1"), "parseLabel still strict");
});

test("key-parts-restricted-to-lowercase-safe-characters", () => {
  const ok = { stage: "tdd", role: "implement-tests", item: "t3", round: 1, attempt: 1 };

  assert.equal(buildKey({ ...ok, item: "a_b-9" }), "tdd.implement-tests.a_b-9.r1.a1", "underscore, hyphen and digits are allowed");
  for (const bad of ["T1", "src/foo", "a:b", "é", "x".repeat(65)]) {
    assert.throws(() => buildKey({ ...ok, item: bad }), `buildKey must reject item ${JSON.stringify(bad)}`);
    assert.throws(() => buildKey({ ...ok, stage: bad }), `buildKey must reject stage ${JSON.stringify(bad)}`);
    assert.throws(() => buildKey({ ...ok, role: bad }), `buildKey must reject role ${JSON.stringify(bad)}`);
    assert.throws(() => parseKey(`tdd.implement-tests.${bad}.r1.a1`), /malformed key/, `parseKey must reject ${JSON.stringify(bad)}`);
  }
  const longest = "x".repeat(64);
  assert.equal(parseKey(buildKey({ ...ok, item: longest })).item, longest, "64 characters is allowed");
});
