import { test } from 'claude-code/testing'

test('units appear nested under their tracer, in plan order, each with its task titles and ticked state', async () => {
  throw new Error('not implemented: tree-groups-units-under-tracers')
})

test('each unit shows the state unitStates gives it: open, hand-ticked, unpublished, published, accepted or legacy', async () => {
  throw new Error('not implemented: tree-shows-unit-state')
})

test('a unit with a Depends on line shows the unit it is based on', async () => {
  throw new Error('not implemented: tree-shows-dependency-base')
})

test('the open unit from unit.json shows its branch, base and the commits recorded for it', async () => {
  throw new Error('not implemented: tree-marks-open-unit-with-base-and-commits')
})

test('a unit with a PR: line shows its PR link', async () => {
  throw new Error('not implemented: tree-shows-pr-link')
})

test('when parsePlan reports problems, the view shows them instead of hiding them', async () => {
  throw new Error('not implemented: tree-shows-plan-problems')
})

test('an unchecked [HUMAN] task shows as waiting on a person, with its title', async () => {
  throw new Error('not implemented: human-task-shows-waiting-on-person')
})

test('a ticked [HUMAN] task no longer shows as waiting', async () => {
  throw new Error('not implemented: checked-human-task-not-waiting')
})

test('an unchecked agent task is not shown as waiting on a person', async () => {
  throw new Error('not implemented: agent-task-not-marked-waiting')
})

test('with no plan MD and no plan path in the ledger, the view renders a plain no-plan state and nothing else breaks', async () => {
  throw new Error('not implemented: no-plan-renders-without-error')
})

test('with an open unit in unit.json but no plan, the unit still shows its branch, base and PR link', async () => {
  throw new Error('not implemented: unit-without-plan-still-shows')
})

test('with no ledger, unit or plan, the pane renders as before', async () => {
  throw new Error('not implemented: no-plan-no-unit-no-ledger')
})
