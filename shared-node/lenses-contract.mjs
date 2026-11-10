// Lens map: validates contracts/lenses.json. Problems are plain strings, like validateStages.
const MODEL_ALIASES = ["sonnet", "opus"];

const CAPS = ["maxRefuters", "maxFindingsPerLens"];
const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

// A refuting row must name both caps. Any cap a row does name, refuting or not, must be a positive integer, so a 0 cannot drop every finding.
function capProblems(row) {
  const refutes = row.refute !== undefined && row.refute !== "none";
  return CAPS.filter((cap) => (refutes || row[cap] !== undefined) && !isPositiveInt(row[cap])).map((cap) => `${row.row}: ${cap} must be a positive integer${refutes ? " (a refuting row needs it)" : ""}`);
}

export function lensMapProblems(contract) {
  return contract.rows.flatMap((row) => {
    if (!Array.isArray(row.lenses)) return [`${row.row}: needs a lenses list`];
    return [...capProblems(row), ...row.lenses.flatMap((lens) => {
      if (typeof lens.model !== "string" || lens.model === "") return [`${row.row}: lens ${lens.name} has no model`];
      if (!MODEL_ALIASES.includes(lens.model)) return [`${row.row}: lens ${lens.name} model ${lens.model} is not a bare alias (${MODEL_ALIASES.join(" or ")})`];
      return [];
    })];
  });
}
