// P20 fixture. lab.py replaces __LAB__ when it copies the plugin.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { LABEL } from '../shared-node/label.mjs'

const WATCHED = '__LAB__/state.txt'
const EVIDENCE = '__LAB__/mod.log'
const PANE = 'pbmod-status'
const state = atom({ plugin: 'pbmod', key: 'state' } as const, 'waiting')
const lines: string[] = []

async function note($: any, text: string) {
  lines.push(text)
  await $.fs.write(EVIDENCE, lines.join('\n') + '\n')
}

async function poll($: any) {
  let last = ''
  for (;;) {
    const now = (await $.fs.exists(WATCHED)) ? String(await $.fs.read(WATCHED)).trim() : ''
    if (now && now !== last) {
      last = now
      await update($, state, () => now)
      await note($, `poll saw: ${now}`)
      if (now === 'stop') {
        $.ui.toast('pbmod: run stopped')
        await note($, 'toast sent')
        await $.audio.play({ asset: 'sounds/ding.wav' })
        await note($, 'audio.play resolved')
      }
    }
    await $.clock.sleep(1000)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await note($, `import: ${LABEL}`)
    void $.ui.open({ id: PANE, title: 'pbmod' })
    void poll($).catch(err => note($, `poll error: ${err}`))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const value = await read($, state)
    return (
      <Box flexDirection="column">
        <Text>{LABEL}</Text>
        <Text>state: {value}</Text>
      </Box>
    )
  })
}
