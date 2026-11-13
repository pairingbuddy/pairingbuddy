import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import v8 from "node:v8";
import vm from "node:vm";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const CONFIG_PATH = fileURLToPath(new URL("../../contracts/agent-config.yaml", import.meta.url));

function readAgentNames() {
  const names = new Set();
  let inAgents = false;
  for (const line of readFileSync(CONFIG_PATH, "utf8").split("\n")) {
    if (/^\S/.test(line)) inAgents = /^agents:\s*(#.*)?$/.test(line);
    else if (inAgents) {
      const m = line.match(/^ {2}([^\s:#][^:]*):/);
      if (m) names.add(m[1].trim());
    }
  }
  return names;
}

function assertKnownAgent(agentType) {
  if (agentType === undefined) return;
  const name = /^pairingbuddy:(.+)$/.exec(agentType)?.[1];
  if (name === undefined || !readAgentNames().has(name)) {
    throw new Error(`Unknown agentType "${agentType}": expected pairingbuddy:<name> for an agent in contracts/agent-config.yaml`);
  }
}

function assertValidSchema(schema) {
  if (schema?.type !== "object") throw new Error('agent() schema must have type "object" at its root');
  if (typeof schema.properties !== "object" || schema.properties === null) {
    throw new Error("agent() schema must have a properties object");
  }
  if (schema.required !== undefined && !(Array.isArray(schema.required) && schema.required.every((k) => k in schema.properties))) {
    throw new Error("agent() schema required must be a subset of its properties");
  }
}

const ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };
const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

class MetaReader {
  constructor(source) {
    this.src = source;
    this.pos = 0;
  }

  fail(what) {
    const rest = this.src.slice(this.pos).split(/\s/, 1)[0].slice(0, 20);
    throw new Error(`Invalid meta: ${what}${rest ? ` at "${rest}"` : " at end of source"}`);
  }

  skipTrivia() {
    for (;;) {
      const c = this.src[this.pos];
      if (c !== undefined && /\s/.test(c)) this.pos++;
      else if (this.src.startsWith("//", this.pos)) {
        const end = this.src.indexOf("\n", this.pos);
        this.pos = end === -1 ? this.src.length : end + 1;
      } else if (this.src.startsWith("/*", this.pos)) {
        const end = this.src.indexOf("*/", this.pos + 2);
        if (end === -1) this.fail("unterminated comment");
        this.pos = end + 2;
      } else return;
    }
  }

  word() {
    this.skipTrivia();
    const start = this.pos;
    if (IDENT_START.test(this.src[this.pos] ?? "")) {
      while (IDENT_PART.test(this.src[this.pos] ?? "")) this.pos++;
    }
    return this.src.slice(start, this.pos);
  }

  expectWord(expected) {
    const save = this.pos;
    if (this.word() !== expected) {
      this.pos = save;
      this.skipTrivia();
      this.fail(`expected "export const meta =" first, wanted "${expected}"`);
    }
  }

  expectChar(ch) {
    this.skipTrivia();
    if (this.src[this.pos] !== ch) this.fail(`expected "${ch}"`);
    this.pos++;
  }

  string() {
    const quote = this.src[this.pos++];
    let out = "";
    for (;;) {
      const c = this.src[this.pos];
      if (c === undefined || c === "\n") this.fail("unterminated string");
      this.pos++;
      if (c === quote) return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.src[this.pos++];
      if (e === "u") {
        const hex = this.src.slice(this.pos, this.pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("bad unicode escape");
        out += String.fromCharCode(parseInt(hex, 16));
        this.pos += 4;
      } else if (e === undefined || e === "\n") this.fail("unterminated string");
      else out += ESCAPES[e] ?? e;
    }
  }

  number() {
    const m = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.src.slice(this.pos));
    if (!m) this.fail("expected a number");
    this.pos += m[0].length;
    if (IDENT_PART.test(this.src[this.pos] ?? "")) this.fail("malformed number");
    return Number(m[0]);
  }

  value() {
    this.skipTrivia();
    const c = this.src[this.pos];
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"' || c === "'") return this.string();
    if (c === "-" || /[0-9.]/.test(c ?? "")) return this.number();
    const save = this.pos;
    const w = this.word();
    if (w === "true") return true;
    if (w === "false") return false;
    if (w === "null") return null;
    this.pos = save;
    return this.fail("unsupported value");
  }

  key() {
    this.skipTrivia();
    const c = this.src[this.pos];
    if (c === '"' || c === "'") return this.string();
    const w = this.word();
    if (!w) this.fail("expected a key");
    return w;
  }

  list(close, item) {
    this.pos++;
    for (;;) {
      this.skipTrivia();
      if (this.src[this.pos] === close) {
        this.pos++;
        return;
      }
      item();
      this.skipTrivia();
      if (this.src[this.pos] === ",") this.pos++;
      else if (this.src[this.pos] !== close) this.fail(`expected "," or "${close}"`);
    }
  }

  object() {
    const out = {};
    this.list("}", () => {
      const k = this.key();
      this.expectChar(":");
      Object.defineProperty(out, k, { value: this.value(), enumerable: true, writable: true, configurable: true });
    });
    return out;
  }

  array() {
    const out = [];
    this.list("]", () => out.push(this.value()));
    return out;
  }

  meta() {
    this.expectWord("export");
    this.expectWord("const");
    this.expectWord("meta");
    this.expectChar("=");
    this.skipTrivia();
    if (this.src[this.pos] !== "{") this.fail("expected an object literal");
    const value = this.object();
    const save = this.pos;
    this.skipTrivia();
    if (this.src[this.pos] === ";") this.pos++;
    else this.pos = save;
    return value;
  }
}

function parseMeta(source) {
  const reader = new MetaReader(source);
  const meta = reader.meta();
  for (const field of ["name", "description"]) {
    if (typeof meta[field] !== "string") throw new Error(`Invalid meta: "${field}" must be a string`);
  }
  return { meta, body: source.slice(reader.pos) };
}

// Runs inside the vm context. Everything the script can reach is created here, in the context's
// own realm, and talks to the host only through `bridge`, which takes and returns JSON strings.
const BOOTSTRAP = `(function (bridge, metaJson, argsJson) {
  "use strict";
  const send = async (kind, payload) => {
    const reply = JSON.parse(await bridge(kind, JSON.stringify(payload)));
    if (reply.error !== undefined) throw new Error(reply.error);
    return reply.value;
  };
  const guard = (message) => {
    bridge("guard", JSON.stringify({ message }));
    throw new Error(message);
  };

  const RealDate = Date;
  function GuardedDate(...a) {
    if (!new.target) guard("new Date() without arguments is not allowed in deterministic workflows");
    if (a.length === 0) guard("new Date() without arguments is not allowed in deterministic workflows");
    return Reflect.construct(RealDate, a, new.target);
  }
  GuardedDate.prototype = RealDate.prototype;
  GuardedDate.UTC = RealDate.UTC;
  GuardedDate.parse = RealDate.parse;
  GuardedDate.now = () => guard("Date.now() is not allowed in deterministic workflows");
  RealDate.prototype.constructor = GuardedDate;
  globalThis.Date = GuardedDate;
  Math.random = () => guard("Math.random() is not allowed in deterministic workflows");
  delete globalThis.Intl;

  globalThis.meta = JSON.parse(metaJson);
  globalThis.args = argsJson === undefined ? undefined : JSON.parse(argsJson);
  globalThis.budget = { total: null, spent: () => 0, remaining: () => Infinity };
  globalThis.agent = async (prompt, opts = {}) => send("agent", { prompt, opts });
  globalThis.workflow = async (name, args) => send("workflow", { name, args });
  globalThis.phase = (name) => { send("phase", { name }); };
  globalThis.log = (message) => { send("log", { message }); };
  globalThis.parallel = async (thunks) =>
    Promise.all(thunks.map(async (t) => { try { return await t(); } catch { return null; } }));
  globalThis.pipeline = async (items, ...stages) =>
    Promise.all(
      items.map(async (item, index) => {
        try {
          let prev;
          for (const stage of stages) prev = await stage(prev, item, index);
          return prev;
        } catch {
          return null;
        }
      }),
    );
})`;

export async function runScript(path, { args, agent, workflow } = {}) {
  const source = readFileSync(path, "utf8");
  const { meta, body } = parseMeta(source);
  const calls = [];
  const logs = [];
  const phases = [];
  const workflows = [];
  const violations = [];

  // A guard failure is recorded here so that parallel(), pipeline() or a script's own catch cannot hide it.
  const fail = (message) => {
    violations.push(message);
    throw new Error(message);
  };

  const handlers = {
    guard: ({ message }) => void violations.push(message),
    phase: ({ name }) => void phases.push(name),
    log: ({ message }) => void logs.push(message),
    agent: async ({ prompt, opts }) => {
      try {
        assertKnownAgent(opts.agentType);
        if (opts.schema !== undefined) assertValidSchema(opts.schema);
      } catch (e) {
        fail(e.message);
      }
      if (!agent) fail("agent() was called but no agent responder was supplied");
      calls.push({ prompt, opts });
      const result = await agent(prompt, opts);
      if (opts.schema !== undefined && result !== null && (typeof result !== "object" || Array.isArray(result))) {
        fail("agent() with a schema must return an object");
      }
      return result;
    },
    workflow: async ({ name, args: wfArgs }) => {
      if (!workflow) fail(`workflow("${name}") was called but no workflow responder was supplied`);
      workflows.push({ name, args: wfArgs });
      return workflow(name, wfArgs);
    },
  };

  const bridge = async (kind, json) => {
    try {
      return JSON.stringify({ value: await handlers[kind](JSON.parse(json)) });
    } catch (e) {
      return JSON.stringify({ error: e.message });
    }
  };

  const context = vm.createContext({});
  vm.runInContext(BOOTSTRAP, context)(bridge, JSON.stringify(meta), args === undefined ? undefined : JSON.stringify(args));

  let result;
  let failure;
  try {
    result = v8.deserialize(v8.serialize(await vm.runInContext(`(async function () {\n${body}\n})`, context)()));
  } catch (e) {
    failure = e;
  }
  if (violations.length) throw new Error(violations[0]);
  if (failure) throw failure;
  return { meta, result, calls, logs, phases, workflows };
}

// Text between <tag>\n and \n</tag> in a spawn prompt.
export const blockOf = (prompt, tag) => prompt.slice(prompt.indexOf(`<${tag}>\n`) + tag.length + 3, prompt.indexOf(`\n</${tag}>`));
