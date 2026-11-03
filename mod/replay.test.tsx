import { expect, test } from 'claude-code/testing'
import { replay } from './testing/replay'
import gOpen1 from './fixtures/replay/g-open-1'

// mod/fixtures/replay/g-open-1/ is a trimmed committed copy of one bug_fix run recorded in
// tests/smoke/recordings/g-open-1/ (gitignored, so the test never reads from it).

test("band's label at each recorded step, in time order, follows the ledger's current stage", async ($, on) => {
  const drawn: [number, string][] = []
  for await (const step of replay($, on, gOpen1)) {
    drawn.push([step.t, (step.nodes as { text: string }).text])
  }

  // Written by hand from the recording: running only while a stage is active, so idle between stages.
  expect(drawn, 'the band label at each step t').toEqual([
    [21.031, 'Workflow idle'], // spawn before any ledger exists
    [28.673, 'Workflow idle'], // ledger: no stage yet
    [32.51, 'Workflow idle'], // spawn
    [32.597, 'Workflow running'], // ledger: code-scenarios active
    [32.65, 'Workflow running'], // spawn
    [39.519, 'Workflow running'], // spawn
    [40.589, 'Workflow idle'], // ledger: code-scenarios done
    [49.807, 'Workflow idle'], // spawn
    [49.891, 'Workflow running'], // ledger: code-tdd active
    [50.076, 'Workflow running'], // spawn
    [53.328, 'Workflow running'], // spawn
    [141.309, 'Workflow idle'], // ledger: code-tdd done
    [147.905, 'Workflow idle'], // spawn
    [147.99, 'Workflow running'], // ledger: code-safety-net active
    [148.104, 'Workflow running'], // spawn
    [156.812, 'Workflow idle'], // ledger: code-safety-net done
    [163.721, 'Workflow idle'], // ledger: final snapshot
  ])
})
