// Tests a refactor-tests fix renamed or split, as its return declares them in `renamed`: [{ test_id, to: [{ test_function,
// test_file? }] }]. pb selects each test of the task by its recorded name, so a rename it was not told of selects nothing.
// The ledger keeps every declared rename (tests.renamed, by test id), and each read of the tests artifact applies them.
// Pure; no I/O.

// A split keeps the first new name under the test's own id; each other one gets the id with -2, -3 and so on.
const MAX_ID = 64;
export const splitId = (id, n) => (n === 0 ? id : `${id.slice(0, MAX_ID - String(n + 1).length - 1)}-${n + 1}`);

// The rows of the tests artifact with every rename applied: a renamed row keeps its id, a split row becomes one row per
// new name. renamed maps a test id to its new names.
export function applyRenames(rows, renamed = {}) {
  return rows.flatMap((row) => {
    const to = renamed[row.test_id];
    if (!Array.isArray(to) || to.length === 0) return [row];
    return to.map(({ test_function, test_file }, n) => ({ ...row, test_id: splitId(row.test_id, n), test_function, test_file: test_file ?? row.test_file }));
  });
}

// The renames a fix's return declares, by test id, or {} when it declares none.
export function declaredRenames(result) {
  const list = result?.renamed;
  if (!Array.isArray(list)) return {};
  return Object.fromEntries(list.map(({ test_id, to }) => [test_id, to]));
}
