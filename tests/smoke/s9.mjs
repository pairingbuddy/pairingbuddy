// Pure assertion helpers for the S9 smoke: Solo on a two-unit plan opens two draft PRs.

export function summarizeDraftPrs({ creates, units }) {
  for (const u of units) {
    const create = creates.find((c) => c.argv[c.argv.indexOf("--head") + 1] === u.branch);
    if (create && !create.argv.includes("--draft")) {
      throw new Error(`${u.unit}: pr create for ${u.branch} is not a draft`);
    }
  }
  const heads = units.map((u) => u.branch);
  return { count: creates.length, heads };
}
