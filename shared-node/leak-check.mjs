// The leak check pb publish and pb pr refresh run before anything leaves the machine: what goes out (the diff, the commit messages, the pull
// request's title, body and coordination comment) is scanned (shared-node/leak-scan.mjs), each hit is numbered and kept in
// run/leak-findings.json, and only the human's typed pb human leak allow <n> lets one through, kept in run/leak-allowed.json.
// run/ is closed to every write tool during a run, so no agent can allow a hit.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { redacted, scanDiff, scanText } from "./leak-scan.mjs";

export const FINDINGS_FILE = "leak-findings.json";
export const ALLOWED_FILE = "leak-allowed.json";

const fingerprintOf = ({ kind, excerpt, where }) => createHash("sha256").update(`${kind}\0${excerpt}\0${where}`).digest("hex");

// Every hit in what goes out, as {kind, where, shown, fingerprint}. texts: {title, body, comment, messages: [{sha, text}], diff}.
export function outgoingFindings({ title = "", body = "", comment = "", messages = [], diff = "" }, options) {
  const inText = (text, where) => scanText(text, options).map((finding) => ({ ...finding, where }));
  const found = [
    ...inText(title, "the pull request title"),
    ...inText(body, "the pull request body"),
    ...inText(comment, "the coordination comment"),
    ...messages.flatMap(({ sha, text }) => inText(text, `the message of commit ${sha.slice(0, 7)}`)),
    ...scanDiff(diff, options).map((finding) => ({ ...finding, where: finding.file ?? "the diff" })),
  ];
  return found.map((finding) => ({ kind: finding.kind, where: finding.where, shown: redacted(finding), fingerprint: fingerprintOf(finding) }));
}

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);

// The hits the human has not allowed, numbered from 1 and kept for pb human leak allow.
export function pendingLeaks(runDir, findings) {
  const allowed = new Set(readJson(join(runDir, ALLOWED_FILE), []).map(({ fingerprint }) => fingerprint));
  const pending = findings.filter(({ fingerprint }) => !allowed.has(fingerprint)).map((finding, i) => ({ n: i + 1, ...finding }));
  writeFileSync(join(runDir, FINDINGS_FILE), `${JSON.stringify(pending, null, 2)}\n`);
  return pending;
}

// pb human leak allow <n>: hit n of the last check goes through from now on. Returns the hit, or null when there is no hit n.
export function allowLeak(runDir, n) {
  const finding = readJson(join(runDir, FINDINGS_FILE), []).find((entry) => entry.n === n);
  if (finding === undefined) return null;
  const allowed = readJson(join(runDir, ALLOWED_FILE), []);
  const { n: _n, ...kept } = finding;
  writeFileSync(join(runDir, ALLOWED_FILE), `${JSON.stringify([...allowed, { ...kept, at: new Date().toISOString() }], null, 2)}\n`);
  return finding;
}

// The refusal's words: each hit, what to do, and the human's line for each false alarm (line(n) gives it).
export function leakRefusalText(pending, line) {
  const hits = pending.map(({ n, kind, shown, where }) => `${n}. ${kind} ${shown} in ${where}`).join("; ");
  const lines = pending.map(({ n }) => line(n)).join("; ");
  return `not published: what would leave the machine looks like it holds a secret or personal data: ${hits}. Nothing was pushed or opened, and no attempt was used. Take it out (rewrite the commit, or the draft) and run the same pb command again. If a hit is a false alarm, only the human can let it through, one line per hit: ${lines}`;
}
