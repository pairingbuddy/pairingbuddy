// Lens map: validates contracts/lenses.json. Problems are plain strings, like validateStages.
const MODEL_ALIASES = ["sonnet", "opus"];

export function lensMapProblems(contract) {
  return contract.rows.flatMap((row) => {
    if (!Array.isArray(row.lenses)) return [`${row.row}: needs a lenses list`];
    return row.lenses.flatMap((lens) => {
      if (typeof lens.model !== "string" || lens.model === "") return [`${row.row}: lens ${lens.name} has no model`];
      if (!MODEL_ALIASES.includes(lens.model)) return [`${row.row}: lens ${lens.name} model ${lens.model} is not a bare alias (${MODEL_ALIASES.join(" or ")})`];
      return [];
    });
  });
}
