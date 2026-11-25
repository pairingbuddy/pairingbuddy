// The JSON object a relayed CLI printed, or null when there is none. The relay may carry text around the JSON, so this slices from the first '{' to the last '}'. A missing output (undefined) yields null too.
function relayedJson(text) {
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
}

// The verdict of a relayed 'pr lint' run as { ok, failures }, or null when the step is broken: the JSON is unreadable, ok is
// not a boolean, ok is false without a failures array, or a pass comes with an exit code other than 0. failures is [] when ok
// is true. pb prints the lint's JSON only when the lint ran, so a failing verdict stands whatever exit the runner claims (T10a
// pr-draft: the runner relayed exit 1 with the failing verdict, and the stage stopped instead of redrafting).
function lintReportOf(relay) {
  const report = relayedJson(relay.cli_output ?? '');
  if (typeof report?.ok !== 'boolean') return null;
  if (report.ok) return relay.cli_exit_code === 0 ? { ok: true, failures: [] } : null;
  return Array.isArray(report.failures) ? { ok: false, failures: report.failures } : null;
}

// A relay that shows pb never answered: no line pb wrote (its "pb: " refusal or its JSON). The runner ran something else
// or nothing (T4d run: the relayed user words said "pb stage fail", the runner ran that, the guard blocked it, and it
// returned exit 1 "not run"). That says nothing about the step, so the step's runner runs again rather than the step failing.
function isBrokenRelay(relay) {
  if (!Number.isInteger(relay?.cli_exit_code)) return false;
  const output = relay.cli_output ?? '';
  return !/^pb: /m.test(output) && relayedJson(output) === null;
}
