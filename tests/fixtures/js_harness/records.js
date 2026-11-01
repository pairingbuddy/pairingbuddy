export const meta = {
  name: "records",
  description: "Fixture that calls phase, log and agent so the harness can record them",
};

phase("Plan");
log("planning started");
const first = await agent("first prompt", { agentType: "pairingbuddy:curate-guidance" });
phase("Build");
log("building " + first);
const second = await agent("second prompt", { agentType: "pairingbuddy:curate-guidance" });

return { first, second };
