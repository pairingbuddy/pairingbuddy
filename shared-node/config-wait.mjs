// A test-config.json the human changed after the run pinned it. It is a wait on the human, never a failing step: the CLI
// ends the stage's attempt and records this wait in needsHuman, and pb human accept answers it. No imports, so the mod
// can load it too.
export const CONFIG_GATE = "config-changed";
export const CONFIG_WAIT_LINE = "the test settings changed: check and accept them";
