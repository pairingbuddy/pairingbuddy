// Pure assertion helpers for the S9 smoke: Solo on a two-unit plan opens two draft PRs.

const HEAD_FLAG = "--head";
const DRAFT_FLAG = "--draft";

function headOf({ argv }) {
  const at = argv.indexOf(HEAD_FLAG);
  return at === -1 ? undefined : argv[at + 1];
}

export function summarizeDraftPrs({ creates, units }) {
  // A unit with no matching create is skipped in this draft loop; the count check after it catches that.
  for (const u of units) {
    const create = creates.find((c) => headOf(c) === u.branch);
    if (create && !create.argv.includes(DRAFT_FLAG)) {
      throw new Error(`${u.unit}: pr create for ${u.branch} is not a draft`);
    }
  }
  // Runs after the draft loop, so it is the check that reports a unit the loop skipped.
  if (creates.length !== units.length) {
    throw new Error(`expected ${units.length} pr creates, saw ${creates.length}`);
  }
  const heads = units.map((u) => u.branch);
  return { count: heads.length, heads };
}

export function assertReportHasPrLinks({ report, urls }) {
  for (const url of urls) {
    if (!report.includes(url)) {
      throw new Error(`report is missing PR link ${url}`);
    }
  }
}
