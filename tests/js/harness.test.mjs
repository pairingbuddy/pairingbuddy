import { test, before, after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { runScript } from "./harness.mjs";

// Tests for the JS harness (tests/js/harness.mjs). Run through tests/test_js_suite.py.

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const fixture = (name) => new URL(`../fixtures/js_harness/${name}.js`, import.meta.url).pathname;
const REPO_ROOT = new URL("../../", import.meta.url).pathname;

const TMP = mkdtempSync(join(tmpdir(), "harness-"));
let tmpCount = 0;
const inlineScript = (source) => {
  const path = join(TMP, `script_${tmpCount++}.js`);
  writeFileSync(path, source);
  return path;
};
after(() => rmSync(TMP, { recursive: true, force: true }));

const META = 'export const meta = { name: "n", description: "d" };\n';
const run = (body, options) => runScript(inlineScript(`${META}${body}\n`), options);
const runWithMeta = (metaBody) => runScript(inlineScript(`export const meta = { ${metaBody} };\nreturn 1;\n`));

const respondOk = async () => "ok";
const NAMED = 'name: "a", description: "b"';

// ---------------------------------------------------------------------------
// harness-nondeterminism-guards
// ---------------------------------------------------------------------------

test("date-now-throws", async () => {
  await assert.rejects(runScript(fixture("date_now"), { args: {} }), /Date\.now\(\) is not allowed/);
});

test("math-random-throws", async () => {
  await assert.rejects(runScript(fixture("math_random"), { args: {} }), /Math\.random\(\) is not allowed/);
});

test("argless-new-date-throws", async () => {
  await assert.rejects(
    runScript(fixture("argless_new_date"), { args: {} }),
    /new Date\(\) without arguments is not allowed/,
  );
});

test("date-now-in-nested-function-throws", async () => {
  await assert.rejects(runScript(fixture("date_now_nested"), { args: {} }), /Date\.now\(\) is not allowed/);
});

test("new-date-with-argument-allowed", async () => {
  const sut = await runScript(fixture("new_date_with_arg"), { args: {} });

  assert.equal(sut.result, 0, "new Date(0).getTime() returns 0");
});

test("date-statics-and-instances-still-work", async () => {
  const sut = await run(`return {
  isDate: new Date(0) instanceof Date,
  utc: Date.UTC(1970, 0, 2),
  parsed: Date.parse("1970-01-02T00:00:00Z"),
  sameConstructor: new Date(0).constructor === Date,
  sameProtoConstructor: Date.prototype.constructor === Date,
  sameProto: Object.getPrototypeOf(new Date(0)) === Date.prototype,
};`);

  assert.deepEqual(sut.result, {
    isDate: true,
    utc: 86400000,
    parsed: 86400000,
    sameConstructor: true,
    sameProtoConstructor: true,
    sameProto: true,
  });
});

const CLOCK_ESCAPES = {
  "Date() called without new": ["return Date();", /new Date\(\) without arguments is not allowed/],
  "constructor of a date instance": ["return new (new Date(0).constructor)().getTime();", /new Date\(\) without arguments is not allowed/],
  "Date.prototype.constructor": ["return new Date.prototype.constructor().getTime();", /new Date\(\) without arguments is not allowed/],
  "Date.now through Date.prototype.constructor": ["return Date.prototype.constructor.now();", /Date\.now\(\) is not allowed/],
  "Date.now through an instance constructor": ["return new Date(0).constructor.now();", /Date\.now\(\) is not allowed/],
  "Reflect.construct on Date": ["return Reflect.construct(Date, []).getTime();", /new Date\(\) without arguments is not allowed/],
  "Reflect.construct on the prototype constructor": [
    "return Reflect.construct(Date.prototype.constructor, []).getTime();",
    /new Date\(\) without arguments is not allowed/,
  ],
};

for (const [label, [body, message]] of Object.entries(CLOCK_ESCAPES)) {
  test(`date-escape-throws: ${label}`, async () => {
    await assert.rejects(run(body), message);
  });
}

test("intl-is-not-available", async () => {
  const sut = await run("return typeof Intl;");

  assert.equal(sut.result, "undefined", "Intl.DateTimeFormat().format() would read the clock");
});

// Guard failures must survive parallel() and pipeline(), which turn ordinary errors into null.
const FAN_OUT_GUARDS = {
  "Date.now in a parallel thunk": ["await parallel([async () => Date.now()]);", /Date\.now\(\) is not allowed/],
  "Math.random in a parallel thunk": ["await parallel([async () => Math.random()]);", /Math\.random\(\) is not allowed/],
  "argless new Date in a parallel thunk": ["await parallel([async () => new Date()]);", /new Date\(\) without arguments is not allowed/],
  "unknown agentType in a parallel thunk": [
    'await parallel([() => agent("p", { agentType: "no-such-agent" })]);',
    /Unknown agentType "no-such-agent"/,
  ],
  "Date.now in a pipeline stage": ['await pipeline(["x"], () => Date.now());', /Date\.now\(\) is not allowed/],
  "Math.random in a pipeline stage": ['await pipeline(["x"], () => Math.random());', /Math\.random\(\) is not allowed/],
  "unknown agentType in a pipeline stage": [
    'await pipeline(["x"], () => agent("p", { agentType: "no-such-agent" }));',
    /Unknown agentType "no-such-agent"/,
  ],
  "a guard failure caught by the script itself": [
    'try { Date.now(); } catch {}\nreturn 1;',
    /Date\.now\(\) is not allowed/,
  ],
  "Date called with arguments, guard caught by the script": [
    'try { Date("2020-01-01"); } catch {}\nreturn 1;',
    /new Date\(\) without arguments is not allowed/,
  ],
  "agent called with no agent responder in a parallel thunk": ['await parallel([() => agent("p")]);', /agent responder/i, {}],
};

for (const [label, [body, message, options = { agent: respondOk }]] of Object.entries(FAN_OUT_GUARDS)) {
  test(`guard-failure-is-not-swallowed: ${label}`, async () => {
    await assert.rejects(run(body, options), message);
  });
}

// ---------------------------------------------------------------------------
// harness-agent-type-validation
// ---------------------------------------------------------------------------

test("unknown-agent-type-fails-before-the-responder-runs", async () => {
  const seen = [];
  const agent = async (prompt) => seen.push(prompt);

  await assert.rejects(
    runScript(fixture("unknown_agent_type"), { args: {}, agent }),
    /Unknown agentType "no-such-agent"/,
  );

  assert.deepEqual(seen, [], "the responder is never called for an unknown agentType");
});

const REJECTED_AGENT_TYPES = {
  "bare plugin agent name": "curate-guidance",
  "built-in agent": "general-purpose",
  "unknown name under the plugin namespace": "pairingbuddy:no-such-agent",
  "a key of another section of the config": "pairingbuddy:scenarios",
  "another top-level section": "pairingbuddy:focus_warning",
  "a bare key of another section": "scenarios",
  "an agent-level indented key of another section": "pairingbuddy:content",
};

for (const [label, agentType] of Object.entries(REJECTED_AGENT_TYPES)) {
  test(`agent-type-rejected: ${label}`, async () => {
    const seen = [];
    const agent = async (prompt) => seen.push(prompt);

    await assert.rejects(
      run(`await agent("p", { agentType: ${JSON.stringify(agentType)} });`, { agent }),
      new RegExp(`Unknown agentType "${agentType}"`),
    );

    assert.deepEqual(seen, [], "the responder is never called");
  });
}

test("lens-call-without-agent-type-rejected", async () => {
  const seen = [];
  const agent = async (prompt) => seen.push(prompt);
  const schema = { type: "object", properties: { pb_key: { type: "string", enum: ["code-review.lens.-.r1.a1"] } } };

  await assert.rejects(
    run(`await agent("p", { schema: ${JSON.stringify(schema)} });`, { agent }),
    /lens.*agentType/i,
  );

  assert.deepEqual(seen, [], "the responder is never called");
});

test("lens-call-with-const-key-without-agent-type-rejected", async () => {
  const seen = [];
  const agent = async (prompt) => seen.push(prompt);
  const schema = { type: "object", properties: { pb_key: { type: "string", const: "code-review.lens.-.r1.a1" } } };

  await assert.rejects(
    run(`await agent("p", { schema: ${JSON.stringify(schema)} });`, { agent }),
    /lens.*agentType/i,
  );

  assert.deepEqual(seen, [], "the responder is never called");
});

test("lens-call-with-wrong-agent-type-rejected", async () => {
  const seen = [];
  const agent = async (prompt) => seen.push(prompt);
  const schema = { type: "object", properties: { pb_key: { type: "string", enum: ["code-review.lens.-.r1.a1"] } } };

  await assert.rejects(
    run(`await agent("p", { agentType: "pairingbuddy:curate-guidance", schema: ${JSON.stringify(schema)} });`, { agent }),
    /lens.*agentType/i,
  );

  assert.deepEqual(seen, [], "the responder is never called");
});

test("lens-call-with-lens-agent-type-accepted", async () => {
  const seen = [];
  const agent = async (prompt) => (seen.push(prompt), {});
  const schema = { type: "object", properties: { pb_key: { type: "string", enum: ["code-review.lens.-.r1.a1"] } } };

  await run(`await agent("p", { agentType: "pairingbuddy:lens", schema: ${JSON.stringify(schema)} });`, { agent });

  assert.deepEqual(seen, ["p"], "the lens call reaches the responder");
});

for (const role of ["refuter", "synthesizer"]) {
  const keySchema = JSON.stringify({ type: "object", properties: { pb_key: { type: "string", enum: [`code-review.${role}.${role === "refuter" ? "f-1" : "-"}.r1.a1`] } } });
  const callWith = (agentType) => `await agent("p", { ${agentType ? `agentType: "${agentType}", ` : ""}schema: ${keySchema} });`;

  test(`${role}-call-needs-its-own-agent-type`, async () => {
    const seen = [];
    const agent = async (prompt) => (seen.push(prompt), {});

    await assert.rejects(run(callWith(undefined), { agent }), new RegExp(`${role}.*agentType`, "i"));
    await assert.rejects(run(callWith("pairingbuddy:curate-guidance"), { agent }), new RegExp(`${role}.*agentType`, "i"));
    assert.deepEqual(seen, [], "the responder is never called for a rejected call");

    await run(callWith(`pairingbuddy:${role}`), { agent });
    assert.deepEqual(seen, ["p"], `the ${role} call with pairingbuddy:${role} reaches the responder`);
  });
}

test("non-key-pb-key-enum-on-non-lens-call-does-not-throw", async () => {
  const agent = async () => ({});
  const schema = { type: "object", properties: { pb_key: { type: "string", enum: ["not a key"] } } };

  await run(`await agent("p", { schema: ${JSON.stringify(schema)} });`, { agent });
});

test("known-agent-type-recorded", async () => {
  const sut = await runScript(fixture("known_agent_types"), { args: {}, agent: respondOk });

  assert.deepEqual(
    sut.calls.map((c) => [c.prompt, c.opts.agentType]),
    [
      ["namespaced prompt", "pairingbuddy:curate-guidance"],
      ["untyped prompt", undefined],
    ],
    "the plugin-namespaced and an absent agentType are allowed and recorded with prompt and opts",
  );
});

// ---------------------------------------------------------------------------
// harness-agent-schema
// ---------------------------------------------------------------------------

const BAD_SCHEMAS = {
  "array root": ['{ type: "array" }', /schema.*type/i],
  "missing properties": ['{ type: "object" }', /schema.*properties/i],
  "required not a subset of properties": [
    '{ type: "object", properties: { a: { type: "string" } }, required: ["a", "b"] }',
    /schema.*required/i,
  ],
};

for (const [label, [schema, message]] of Object.entries(BAD_SCHEMAS)) {
  test(`agent-schema-misuse-fails: ${label}`, async () => {
    await assert.rejects(
      run(`await agent("p", { schema: ${schema} });`, { agent: async () => ({ a: "x" }) }),
      message,
    );
  });
}

test("agent-schema-misuse-is-not-swallowed-by-parallel", async () => {
  await assert.rejects(
    run('await parallel([() => agent("p", { schema: { type: "array" } })]);', { agent: async () => ({}) }),
    /schema.*type/i,
  );
});

test("agent-schema-requires-an-object-result", async () => {
  await assert.rejects(
    run('await agent("p", { schema: { type: "object", properties: { a: {} } } });', { agent: async () => "a string" }),
    /schema.*object/i,
  );
});

test("agent-schema-valid-passes-the-object-through", async () => {
  const sut = await run(
    'return await agent("p", { schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] } });',
    { agent: async () => ({ a: "x" }) },
  );

  assert.deepEqual(sut.result, { a: "x" });
});

test("agent-schema-allows-a-skipped-agent-result", async () => {
  const sut = await run('return await agent("p", { schema: { type: "object", properties: {} } });', {
    agent: async () => null,
  });

  assert.equal(sut.result, null, "null is the skipped-agent case");
});

// ---------------------------------------------------------------------------
// harness-meta-rules
// ---------------------------------------------------------------------------

const META_NOT_FIRST = {
  "a statement before meta": ['const x = 1;\nexport const meta = { name: "a", description: "b" };\nreturn x;\n', "export"],
  "a log call before meta": ['log("hi");\nexport const meta = { name: "a", description: "b" };\nreturn 1;\n', "export"],
  "a different export first": ['export const other = 1;\nexport const meta = { name: "a", description: "b" };\nreturn 1;\n', "meta"],
  "let instead of const": ['export let meta = { name: "a", description: "b" };\nreturn 1;\n', "const"],
  "no meta at all": ["return 1;\n", "export"],
};

for (const [label, [source, wanted]] of Object.entries(META_NOT_FIRST)) {
  test(`meta-not-first-statement-fails: ${label}`, async () => {
    await assert.rejects(
      runScript(inlineScript(source)),
      new RegExp(`Invalid meta: expected "export const meta =" first, wanted "${wanted}"`),
    );
  });
}

// Each non-literal sits in a non-required field beside a valid name and description,
// so the required-field check cannot be what rejects it.
const NON_LITERAL_VALUES = {
  "function call": [`${NAMED}, extra: foo()`, /Invalid meta: unsupported value at "foo\(\)"/],
  "identifier value": [`${NAMED}, extra: someName`, /Invalid meta: unsupported value at "someName"/],
  "nested call in array": [`${NAMED}, phases: [String(1)]`, /Invalid meta: unsupported value at "String\(1\)/],
  "template interpolation": [`${NAMED}, extra: \`x \${y} z\``, /Invalid meta: unsupported value/],
  "plain template without interpolation": [`${NAMED}, extra: \`plain\``, /Invalid meta: unsupported value/],
  "spread": [`${NAMED}, ...other`, /Invalid meta: expected a key/],
  "string concatenation": [`${NAMED}, extra: "x" + "y"`, /Invalid meta: expected "," or "\}"/],
  "arithmetic expression": [`${NAMED}, count: 1 + 2`, /Invalid meta: expected "," or "\}"/],
  "getter": [`${NAMED}, get extra() { return 1; }`, /Invalid meta: expected ":"/],
  "method": [`${NAMED}, run() { return 1; }`, /Invalid meta: expected ":"/],
  "shorthand properties": ["name, description", /Invalid meta: expected ":"/],
};

for (const [label, [body, message]] of Object.entries(NON_LITERAL_VALUES)) {
  test(`meta-non-literal-value-fails: ${label}`, async () => {
    await assert.rejects(runWithMeta(body), message);
  });
}

const MISSING_OR_WRONG_FIELDS = {
  "name missing": ['description: "only a description"', "name"],
  "description missing": ['name: "only-a-name"', "description"],
  "both missing": ['phases: ["One"]', "name"],
  "name is a number": ['name: 1, description: "d"', "name"],
  "description is a number": ['name: "n", description: 1', "description"],
  "description is null": ['name: "n", description: null', "description"],
  "description is an array": ['name: "n", description: ["d"]', "description"],
};

for (const [label, [body, field]] of Object.entries(MISSING_OR_WRONG_FIELDS)) {
  test(`meta-required-field-must-be-a-string: ${label}`, async () => {
    await assert.rejects(runWithMeta(body), new RegExp(`Invalid meta: "${field}" must be a string`));
  });
}

const MALFORMED_METAS = {
  "number followed by letters": [`${NAMED}, count: 1abc`, /Invalid meta: malformed number/],
  "unterminated block comment": [`${NAMED}, /* never closed`, /Invalid meta: unterminated comment/],
  "raw newline in a string": [`${NAMED}, extra: "line1\nline2"`, /Invalid meta: unterminated string/],
  "unterminated string": [`${NAMED}, extra: "open`, /Invalid meta: unterminated string/],
  "missing comma between items": ['name: "a" description: "b"', /Invalid meta: expected "," or "\}"/],
  "bad unicode escape": [`${NAMED}, extra: "\\u00G1"`, /Invalid meta: bad unicode escape/],
};

for (const [label, [body, message]] of Object.entries(MALFORMED_METAS)) {
  test(`meta-malformed-syntax-fails: ${label}`, async () => {
    await assert.rejects(runWithMeta(body), message);
  });
}

test("valid-meta-returned", async () => {
  const path = inlineScript(String.raw`export const meta = {
  // a line comment with { ( } inside
  name: "demo", /* block comment { ( } */
  description: "braces { ( } in a string",
  phases: [["Plan", { weight: 1.5, tags: ["a", ["b"]] }], ["Build"]],
  count: 3,
  negative: -2,
  exponent: 1e3,
  enabled: true,
  disabled: false,
  nothing: null,
  "quoted-key": 'single } quoted ( string',
  escaped: "tab\there \"quoted\" \u0041 back\\slash",
};
return 7;
`);

  const sut = await runScript(path);

  assert.deepEqual(sut.meta, {
    name: "demo",
    description: "braces { ( } in a string",
    phases: [["Plan", { weight: 1.5, tags: ["a", ["b"]] }], ["Build"]],
    count: 3,
    negative: -2,
    exponent: 1000,
    enabled: true,
    disabled: false,
    nothing: null,
    "quoted-key": "single } quoted ( string",
    escaped: 'tab\there "quoted" A back\\slash',
  }, "the harness returns the literal meta");
  assert.equal(sut.result, 7, "the script body still runs");
});

test("meta-proto-key-is-an-own-property", async () => {
  const sut = await runWithMeta(`${NAMED}, __proto__: "own"`);

  assert.equal(Object.hasOwn(sut.meta, "__proto__"), true, "__proto__ is stored as data");
  assert.equal(Object.getPrototypeOf(sut.meta), Object.prototype, "the prototype is untouched");
});

// ---------------------------------------------------------------------------
// harness-args
// ---------------------------------------------------------------------------

test("args-are-passed-to-the-script", async () => {
  const sut = await run("return args;", { args: { feature: "x", list: [1, 2] } });

  assert.deepEqual(sut.result, { feature: "x", list: [1, 2] });
});

test("args-stay-undefined-when-not-passed", async () => {
  const sut = await run("return typeof args;");

  assert.equal(sut.result, "undefined");
});

test("args-stay-undefined-when-explicitly-undefined", async () => {
  const sut = await run("return typeof args;", { args: undefined });

  assert.equal(sut.result, "undefined");
});

// ---------------------------------------------------------------------------
// harness-recording-stand-ins
// ---------------------------------------------------------------------------

test("stand-ins-record-calls-phases-logs", async () => {
  const responses = ["answer-1", "answer-2"];
  const agent = async () => responses.shift();

  const sut = await runScript(fixture("records"), { args: {}, agent });

  assert.deepEqual(
    sut.calls.map((c) => c.prompt),
    ["first prompt", "second prompt"],
    "calls are recorded in call order",
  );
  assert.equal(sut.calls[0].opts.agentType, "pairingbuddy:curate-guidance", "opts are recorded");
  assert.deepEqual(sut.phases, ["Plan", "Build"], "phases are recorded in order");
  assert.deepEqual(
    sut.logs,
    ["planning started", "building answer-1"],
    "logs show the responder value was the agent result",
  );
  assert.deepEqual(
    sut.result,
    { first: "answer-1", second: "answer-2" },
    "result is the script return value",
  );
});

test("recorded-opts-are-a-host-copy", async () => {
  const sut = await run('const opts = { label: "a" };\nawait agent("p", opts);\nopts.label = "b";\nreturn 1;', {
    agent: respondOk,
  });

  assert.deepEqual(sut.calls[0].opts, { label: "a" }, "later script mutation does not change the record");
});

test("parallel-keeps-order-and-resolves-a-throwing-thunk-to-null", async () => {
  const sut = await run(`return await parallel([
  async () => "a",
  async () => { throw new Error("boom"); },
  async () => "c",
]);`);

  assert.deepEqual(sut.result, ["a", null, "c"]);
});

test("parallel-runs-thunks-concurrently", async () => {
  const sut = await run(`let release;
const gate = new Promise((resolve) => { release = resolve; });
return await parallel([
  async () => { await gate; return "first"; },
  async () => { release(); return "second"; },
]);`);

  assert.deepEqual(sut.result, ["first", "second"], "the first thunk can only finish once the second has started");
});

test("pipeline-passes-prev-item-index-and-drops-a-failed-item", async () => {
  const sut = await run(`const seen = [];
const out = await pipeline(["x", "y", "z"],
  (prev, item, index) => { seen.push(["s1", prev, item, index]); if (item === "y") throw new Error("bad"); return item + "1"; },
  (prev, item, index) => { seen.push(["s2", prev, item, index]); return prev + "2"; },
);
return { out, seen };`);

  assert.deepEqual(sut.result.out, ["x12", null, "z12"], "a throwing item resolves to null");
  assert.deepEqual(
    sut.result.seen,
    [["s1", undefined, "x", 0], ["s1", undefined, "y", 1], ["s1", undefined, "z", 2], ["s2", "x1", "x", 0], ["s2", "z1", "z", 2]],
    "stages get (prev, item, index) and a dropped item skips later stages",
  );
});

test("workflow-resolves-through-the-option-and-is-recorded", async () => {
  const workflow = async (name, args) => ({ ran: name, args });

  const sut = await run('return await workflow("child-flow", { n: 1 });', { workflow });

  assert.deepEqual(sut.result, { ran: "child-flow", args: { n: 1 } }, "the responder result is returned");
  assert.deepEqual(sut.workflows, [{ name: "child-flow", args: { n: 1 } }], "the call is recorded");
});

test("workflow-without-args-is-recorded-with-undefined-args", async () => {
  const workflow = async (name, args) => ({ ran: name, args });

  const sut = await run('return await workflow("child-flow");', { workflow });

  assert.deepEqual(sut.workflows, [{ name: "child-flow", args: undefined }]);
});

test("workflow-without-a-responder-throws-naming-the-workflow", async () => {
  await assert.rejects(run('await workflow("child-flow", { n: 1 });'), /child-flow/);
});

test("meta-is-readable-in-the-script-body", async () => {
  const sut = await run("return meta.name;");

  assert.equal(sut.result, "n");
});

test("budget-has-the-design-values", async () => {
  const sut = await run("return { total: budget.total, spent: budget.spent(), remaining: budget.remaining() };");

  assert.deepEqual(sut.result, { total: null, spent: 0, remaining: Infinity });
});

// ---------------------------------------------------------------------------
// harness-isolation
// ---------------------------------------------------------------------------

const NODE_GLOBALS = {
  process: "typeof process",
  require: "typeof require",
  fetch: "typeof fetch",
  "globalThis.process": "typeof globalThis.process",
  "globalThis.require": "typeof globalThis.require",
};

for (const [label, expression] of Object.entries(NODE_GLOBALS)) {
  test(`script-has-no-node-global: ${label}`, async () => {
    const sut = await run(`return ${expression};`);

    assert.equal(sut.result, "undefined", `${label} is not defined in the script`);
  });
}

test("static-import-is-a-syntax-error", async () => {
  await assert.rejects(run("import fs from 'node:fs';\nreturn 1;"), /Cannot use import statement/);
});

// Each route tries to reach the host Function constructor and asks whether `process` is visible there.
const ESCAPE_PROBE = 'constructor("return typeof process")';
const ESCAPE_ROUTES = {
  "agent.constructor": [`return await agent.${ESCAPE_PROBE}();`, {}],
  "log.constructor": [`return log.${ESCAPE_PROBE}();`, {}],
  "phase.constructor": [`return phase.${ESCAPE_PROBE}();`, {}],
  "budget.constructor.constructor": [`return budget.constructor.${ESCAPE_PROBE}();`, {}],
  "meta.constructor.constructor": [`return meta.constructor.${ESCAPE_PROBE}();`, {}],
  "args.constructor.constructor": [`return args.constructor.${ESCAPE_PROBE}();`, { args: { a: 1 } }],
  "responder-returned object constructor": [
    `const r = await agent("p");\nreturn r.constructor.${ESCAPE_PROBE}();`,
    { agent: async () => ({ x: 1 }) },
  ],
  "responder-returned array constructor": [
    `const r = await agent("p");\nreturn r.constructor.${ESCAPE_PROBE}();`,
    { agent: async () => [1] },
  ],
  "workflow-returned object constructor": [
    `const r = await workflow("w");\nreturn r.constructor.${ESCAPE_PROBE}();`,
    { workflow: async () => ({ x: 1 }) },
  ],
  "parallel promise constructor": [
    `const p = parallel([async () => 1]);\nconst probe = p.constructor.${ESCAPE_PROBE}();\nawait p;\nreturn probe;`,
    {},
  ],
  "caught responder error constructor": [
    `try { await agent("p"); } catch (e) { return e.constructor.${ESCAPE_PROBE}(); }\nreturn "not thrown";`,
    { agent: async () => { throw new Error("host error"); } },
  ],
  "caught guard error constructor": [
    `try { null.x; } catch (e) { return e.constructor.${ESCAPE_PROBE}(); }\nreturn "not thrown";`,
    {},
  ],
};

for (const [label, [body, options]] of Object.entries(ESCAPE_ROUTES)) {
  test(`script-cannot-reach-the-host: ${label}`, async () => {
    const sut = await run(body, options);

    assert.equal(sut.result, "undefined", `${label} must stay inside the script's realm`);
  });
}

test("host-function-constructor-cannot-escape-the-clock-guard", async () => {
  const sut = await run('return await agent.constructor("return typeof Date.now")();');

  assert.equal(sut.result, "function", "code built in the context sees the guarded Date, not the host one");
  await assert.rejects(
    run('return await agent.constructor("return Date.now()")();'),
    /Date\.now\(\) is not allowed/,
  );
});

// ---------------------------------------------------------------------------
// harness-bundler-integration
// ---------------------------------------------------------------------------

let builtDir;
before(() => {
  builtDir = join(TMP, "built");
  execFileSync(
    process.execPath,
    [
      join(REPO_ROOT, "scripts/build-workflows.mjs"),
      "--root",
      join(REPO_ROOT, "tests/fixtures/workflow_bundler"),
      "--out",
      builtDir,
    ],
    { stdio: "pipe" },
  );
});

test("built-script-runs-with-args", async () => {
  const sut = await runScript(join(builtDir, "trivial.js"), { args: {} });

  assert.deepEqual(sut.meta, { name: "trivial", description: "Fixture stage" });
  assert.deepEqual(sut.result, { started: true, greeting: "hello fixture" });
});

test("built-script-runs-bare-without-args", async () => {
  const sut = await runScript(join(builtDir, "trivial.js"));

  assert.deepEqual(sut.result, { started: false }, "the guard line returns early when args is undefined");
});

// Scenario: harness-agent-type-enforcement. The harness rejects calls whose agentType does not match their role.
test("harness-rejects-course-checker-without-agent-type", async () => {
  const seen = [];
  const agent = async (prompt) => (seen.push(prompt), {});
  const schema = JSON.stringify({ type: "object", properties: { pb_key: { type: "string", enum: ["code-review.course-checker.g1.r2.a1"] } } });
  const noAgentType = `await agent("p", { schema: ${schema} });`;
  const wrongAgentType = `await agent("p", { agentType: "pairingbuddy:curate-guidance", schema: ${schema} });`;
  const rightAgentType = `await agent("p", { agentType: "pairingbuddy:course-checker", schema: ${schema} });`;
  const expectedMessage = /A course-checker call must name agentType "pairingbuddy:course-checker"/;

  await assert.rejects(run(noAgentType, { agent }), expectedMessage);
  await assert.rejects(run(wrongAgentType, { agent }), expectedMessage);
  assert.deepEqual(seen, [], "the responder is never called for a rejected call");

  await run(rightAgentType, { agent });
  assert.deepEqual(seen, ["p"], "the course-checker call with pairingbuddy:course-checker reaches the responder");
});
