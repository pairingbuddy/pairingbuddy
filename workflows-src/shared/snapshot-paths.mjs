// The corpus is what pb snapshot found, relayed by the runner as the JSON the CLI printed. A snapshot that failed is no
// corpus. Returns { paths, taskType }: the paths to attack and the task type pb snapshot printed beside them, for choosing
// the lens row.
function snapshotResult(run) {
  const { cli_exit_code: exitCode, cli_output: output } = run.result;
  let printed = null;
  try {
    printed = JSON.parse(output);
  } catch {
    // Left null: the check below names the failure.
  }
  const usable = exitCode === 0 && printed !== null && printed.ok === true && Array.isArray(printed.paths) && printed.paths.every((p) => typeof p === 'string');
  if (!usable) throw new Error(`pb snapshot gave no corpus (exit ${exitCode}): ${output}`);
  return { paths: printed.paths, taskType: printed.taskType };
}
