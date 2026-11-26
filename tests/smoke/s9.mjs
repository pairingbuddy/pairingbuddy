// Pure assertion helpers for the S9 smoke: Solo on a two-unit plan opens two draft PRs.

export function summarizeDraftPrs({ creates, units }) {
  const heads = units.map((u) => u.branch);
  return { count: creates.length, heads };
}
