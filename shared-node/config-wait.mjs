// A test-config.json the human changed after the run pinned it. It is a wait on the human, never a failing step: the CLI
// ends the stage's attempt and records this wait in needsHuman, and pb human accept answers it. No imports, so the mod
// can load it too.
export const CONFIG_GATE = "config-changed";
export const CONFIG_WAIT_LINE = "the test settings changed: check and accept them";

// The answers the question offers. Only the tap records one, from what the human chose (hooks/tap.mjs).
export const ACCEPT_CONFIG = "Accept";
export const STOP_AT_CONFIG = "Stop";

// The question the session asks with AskUserQuestion, stored in needsHuman so the hooks take only this question, exactly.
export const configQuestion = () => ({
  question: "The test settings in .pairingbuddy/test-config.json changed since the run opened, so no test runs until you check them. Accept the file as it is now?",
  header: "Test config",
  options: [
    { label: ACCEPT_CONFIG, description: "Pin the file as it is now; the stage starts again where it left off" },
    { label: STOP_AT_CONFIG, description: "Stop the run here" },
  ],
  multiSelect: false,
});
