import ledger from './ledger'
import spawns from './spawns'
import timing from './timing'

// One recording of a run: the test imports this and hands it to replay().
export default { ledger, spawns, timing }
