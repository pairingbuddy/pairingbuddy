import { test } from "node:test";
import assert from "node:assert/strict";

function notImplemented(name) {
  assert.fail(`not implemented: ${name}`);
}

test("exports-gate-policy-auto", () => {
  notImplemented("exports-gate-policy-auto");
});

test("gate-policy-set-before-claude-starts", () => {
  notImplemented("gate-policy-set-before-claude-starts");
});

test("still-exports-solo-flag", () => {
  notImplemented("still-exports-solo-flag");
});

test("prompt-invokes-code-on-plan", () => {
  notImplemented("prompt-invokes-code-on-plan");
});

test("skill-solo-uses-new-plan-loop", () => {
  notImplemented("skill-solo-uses-new-plan-loop");
});

test("agents-do-not-read-policy-env", () => {
  notImplemented("agents-do-not-read-policy-env");
});

test("refuses-main", () => {
  notImplemented("refuses-main");
});

test("refuses-master", () => {
  notImplemented("refuses-master");
});

test("skill-solo-stops-on-human-task", () => {
  notImplemented("skill-solo-stops-on-human-task");
});

test("skill-solo-human-stop-message", () => {
  notImplemented("skill-solo-human-stop-message");
});

test("skill-solo-human-stop-not-auto-yes", () => {
  notImplemented("skill-solo-human-stop-not-auto-yes");
});
