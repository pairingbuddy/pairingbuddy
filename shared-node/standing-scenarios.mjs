// The scenarios that stand, picked from the artifacts folder's file names, and their rows as the scenarios question and the
// report show them. Pure, no node: imports, so the mod can read them through its own fs as pb gate eval reads them through node's.
import { isVoidedAttempt, returnFileKey } from "./stage-graph.mjs";

// The newest return among the file names that match accepts, newest by attempt then round, or null.
export function newestKeyAmong(files, match) {
  const found = files
    .filter((file) => file.endsWith(".json") && !file.startsWith("."))
    .map((file) => ({ pbKey: file.slice(0, -".json".length), ...returnFileKey(file) }))
    .filter(match)
    .sort((a, b) => b.attempt - a.attempt || b.round - a.round);
  return found[0]?.pbKey ?? null;
}

// A key that can hold the scenarios that stand: an enumerator return or a code-scenarios fix whose attempt is not void.
export const isStandingScenarios = (ledger) => ({ role, item, stage, attempt }) =>
  ((role === "enumerate-scenarios-and-test-cases" && item === null) || (role === "fix" && stage === "code-scenarios")) && !isVoidedAttempt(ledger, stage, attempt);

// A key that can hold the tests that stand: a placeholders return whose attempt is not void. The newest lists every test of
// the task, the rows of earlier rounds included.
export const isStandingTests = (ledger) => ({ role, stage, attempt }) => role === "create-test-placeholders" && !isVoidedAttempt(ledger, stage, attempt);

const text = (value) => (typeof value === "string" && value.trim() !== "" ? value : undefined);

// A row of a list: its text on one line, so a model's line break cannot break the layout.
const oneLine = (value) => text(value)?.replace(/\s+/g, " ").trim();

// A model wrote the list, so a malformed scenario or test case drops the whole list rather than show part of it.
export function scenarioRows(scenarios) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) return undefined;
  const rows = scenarios.map((s) => ({ description: oneLine(s?.description), tests: Array.isArray(s?.test_cases) ? s.test_cases.map((c) => oneLine(c?.description)) : [undefined] }));
  return rows.every(({ description, tests }) => description !== undefined && !tests.includes(undefined)) ? rows : undefined;
}
