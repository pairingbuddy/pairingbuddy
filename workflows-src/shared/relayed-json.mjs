// The JSON object a relayed CLI printed, or null when there is none. The relay may carry text around the JSON, so this slices from the first '{' to the last '}'. A missing output (undefined) yields null too.
function relayedJson(text) {
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
}

// The verdict of a relayed 'pr lint' run as { ok, failures }, or null when the step is broken: the exit code is not 0, the JSON is unreadable, ok is not a boolean, or ok is false without a failures array. failures is [] when ok is true.
function lintReportOf(relay) {
  if (relay.cli_exit_code !== 0) return null;
  const report = relayedJson(relay.cli_output ?? '');
  if (typeof report?.ok !== 'boolean') return null;
  if (report.ok) return { ok: true, failures: [] };
  return Array.isArray(report.failures) ? { ok: false, failures: report.failures } : null;
}
