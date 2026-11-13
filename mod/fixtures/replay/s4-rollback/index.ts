import calls from './calls'
import ledger from './ledger'
import spawns from './spawns'
import timing from './timing'

// One S4 bug_fix run with a rolled-back fix: the test imports this and hands it to replay().
export default { ledger, spawns, timing, calls }
