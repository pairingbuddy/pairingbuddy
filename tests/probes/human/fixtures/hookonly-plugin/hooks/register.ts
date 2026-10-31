// P19 fixture. lab.py replaces __LAB__ when it copies the plugin.
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.fs.write('__LAB__/hookonly-mod.log', 'mod loaded\n')
    return next(e)
  })
}
