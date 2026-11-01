// Fixture hook: logs every payload, then applies the probe's rules.json.
// PROBE_DIR is set by the harness. Rules:
//   deny: [{event, tool, match, unless, reason}]
//   stop: [{if, unless, reason}]    paths are relative to the payload cwd
//   tap:  {sleepMs}                 PostToolUse StructuredOutput capture by pb_key
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.env.PROBE_DIR
const input = JSON.parse(readFileSync(0, 'utf8'))
appendFileSync(join(dir, 'hooks.jsonl'), JSON.stringify({ _t: Date.now(), ...input }) + '\n')

const rules = JSON.parse(readFileSync(join(dir, 'rules.json'), 'utf8'))
const here = p => existsSync(join(input.cwd, p))
const event = input.hook_event_name

if (event === 'PreToolUse') {
  const text = JSON.stringify(input.tool_input ?? {})
  for (const r of rules.deny ?? []) {
    if (r.tool !== input.tool_name || !text.includes(r.match)) continue
    if (r.unless && here(r.unless)) continue
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.reason },
    }))
    process.exit(0)
  }
}

if (event === 'Stop') {
  for (const r of rules.stop ?? []) {
    if ((r.if && !here(r.if)) || (r.unless && here(r.unless))) continue
    appendFileSync(join(dir, 'stop-decisions.jsonl'), JSON.stringify({ _t: Date.now(), reason: r.reason }) + '\n')
    console.log(JSON.stringify({ decision: 'block', reason: r.reason }))
    process.exit(0)
  }
}

if (event === 'PostToolUse' && input.tool_name === 'StructuredOutput' && rules.tap && input.tool_input?.pb_key) {
  const start = Date.now()
  await new Promise(done => setTimeout(done, rules.tap.sleepMs ?? 0))
  const out = join(input.cwd, '.probe', 'artifacts')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, `${input.tool_input.pb_key}.json`), JSON.stringify({
    start, end: Date.now(), agent_id: input.agent_id, agent_type: input.agent_type, value: input.tool_input,
  }))
}
