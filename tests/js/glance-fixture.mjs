// Shared by the glance tests: loads the recorded replay runs and names the common instants.
// Node imports the .ts data files directly (type stripping, Node 22.18+/23.6+); index.ts is not imported (extensionless './ledger' imports).
export async function recording(run, file) {
  return (await import(new URL(`../../mod/fixtures/replay/${run}/${file}.ts`, import.meta.url))).default;
}

export async function ledgerAtSeq(run, seq) {
  return (await recording(run, "ledger")).find((snapshot) => snapshot.ledger.seq === seq).ledger;
}

export const SOME_TIME = Date.parse("2026-11-03T07:12:00.000Z");
export const TDD_ACTIVE_SEQ = 7;
