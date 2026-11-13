// The corpus is what pb snapshot found, relayed by the runner as the JSON the CLI printed. A snapshot that failed is no
// corpus. Returns { paths, taskType, rolledBack }: the paths to attack, the task type pb snapshot printed beside them
// (for choosing the lens row), and rolledBack, the stage's rollbacks already made as printed (0 unless a non-negative integer).
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
  const rolledBack = Number.isInteger(printed.rolledBack) && printed.rolledBack >= 0 ? printed.rolledBack : 0;
  return { paths: printed.paths, taskType: printed.taskType, rolledBack };
}
