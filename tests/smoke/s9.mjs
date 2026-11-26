// Pure assertion helpers for the S9 smoke: Solo on a two-unit plan opens two draft PRs.

import { parseArgs } from "node:util";
import { clampBudget } from "./claude-run.mjs";

export const S9_BUDGET_USD = 6;

const HEAD_FLAG = "--head";
const DRAFT_FLAG = "--draft";
const COMPLETE_MARKER = "Session complete";
const STOPPED_MARKER = "Session stopped";

function headOf({ argv }) {
  const at = argv.indexOf(HEAD_FLAG);
  return at === -1 ? undefined : argv[at + 1];
}

export function summarizeDraftPrs({ creates, units }) {
  if (creates.length !== units.length) {
    throw new Error(`expected ${units.length} pr creates, saw ${creates.length}`);
  }
  for (const u of units) {
    const create = creates.find((c) => headOf(c) === u.branch);
    if (!create) {
      throw new Error(`${u.unit}: no pr create for ${u.branch}`);
    }
    if (!create.argv.includes(DRAFT_FLAG)) {
      throw new Error(`${u.unit}: pr create for ${u.branch} is not a draft`);
    }
  }
  const heads = units.map((u) => u.branch);
  return { count: heads.length, heads };
}

export function assertForcedStopLocal({ remote, local, creates }) {
  if (remote.after.length !== remote.before.length || remote.after.some((ref) => !remote.before.includes(ref))) {
    throw new Error("forced stop pushed a ref to the remote");
  }
  if (local.aheadOfRemote < 1) {
    throw new Error(`${local.branch} has no commits ahead of the remote`);
  }
  if (creates.length !== 0) {
    throw new Error(`forced stop opened ${creates.length} pr creates`);
  }
}

export function assertForcedStopSummary({ summary }) {
  if (summary.includes(COMPLETE_MARKER)) {
    throw new Error("forced stop summary says Session complete");
  }
  if (!summary.includes(STOPPED_MARKER)) {
    throw new Error("forced stop summary does not say Session stopped");
  }
}

export function assertReportHasPrLinks({ report, urls }) {
  for (const url of urls) {
    if (!report.includes(url)) {
      throw new Error(`report is missing PR link ${url}`);
    }
  }
}

export function parseOptions(argv) {
  const { values } = parseArgs({ args: argv, options: { "budget-usd": { type: "string" } } });
  return { budgetUsd: clampBudget(values["budget-usd"], S9_BUDGET_USD) };
}
