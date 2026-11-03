import { expect, test } from 'claude-code/testing'
import { BAND } from './testing/band'

test('registers with the kit and loads without error under claude plugin test', async ($) => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  const drawn = await ui.find({ type: 'Text' })
  expect(drawn, 'the mod draws its band once registered').toBeDefined()
  await ui.unmount()
})
