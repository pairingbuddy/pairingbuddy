// Pure rules for the light review: which focuses a change needs.
// No imports: the bundler inlines this file as plain source.

// Reduce a repo-relative directory to a bare form: no leading "./", no trailing "/".
// "" and "." (the repo root) become "".
function normalizeDirectory(directory) {
  let bare = directory;
  while (bare.startsWith("./")) bare = bare.slice(2);
  while (bare.endsWith("/")) bare = bare.slice(0, -1);
  return bare === "." ? "" : bare;
}

function isInsideDirectory(directory, path) {
  const bareDirectory = normalizeDirectory(directory);
  if (bareDirectory === "") return true;
  return normalizeDirectory(path).startsWith(`${bareDirectory}/`);
}

export function ruleFocuses(changedPaths, testConfig, lightReview, matchesGlob) {
  const runners = Object.values(testConfig.runners);
  const isTestFile = (path) =>
    runners.some((runner) => isInsideDirectory(runner.test_directory, path) && matchesGlob(runner.file_pattern, path));
  const kinds = changedPaths.map((path) => (isTestFile(path) ? lightReview.rule.test : lightReview.rule.production));
  return lightReview.catalog.map((entry) => entry.name).filter((name) => kinds.includes(name));
}

export function settleFocuses(ruleFocusNames, changes, lightReview) {
  const hasReason = (change) => typeof change.reason === "string" && change.reason.trim() !== "";
  const inCatalog = (change) => lightReview.catalog.some((entry) => entry.name === change.focus);
  const rejectionOf = (change) => {
    if (!hasReason(change)) return "a change needs a reason";
    if (!inCatalog(change)) return "a focus must be in the catalog";
    return null;
  };
  const rejection = (change, why) => ({ focus: change.focus, change: change.change, why });
  const judged = changes.map((change) => ({ change, why: rejectionOf(change) }));
  const accepted = judged.filter((entry) => entry.why === null).map((entry) => entry.change);
  const rejected = judged
    .filter((entry) => entry.why !== null)
    .map(({ change, why }) => rejection(change, why));
  const focuses = ruleFocusNames.filter((name) => !accepted.some((a) => a.change === "drop" && a.focus === name));
  for (const change of accepted.filter((a) => a.change === "add")) {
    if (focuses.includes(change.focus)) continue;
    if (focuses.length >= lightReview.maxFocuses) {
      rejected.push(rejection(change, `at most ${lightReview.maxFocuses} focuses`));
      continue;
    }
    focuses.push(change.focus);
  }
  return { focuses, rejected };
}
