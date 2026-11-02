export const meta = {
  name: "known-agent-types",
  description: "Fixture that calls agents by plugin-namespaced name and with no agentType",
};

await agent("namespaced prompt", { agentType: "pairingbuddy:curate-guidance" });
await agent("untyped prompt");

return "done";
