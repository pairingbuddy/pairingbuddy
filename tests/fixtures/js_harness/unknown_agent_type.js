export const meta = {
  name: "unknown-agent-type",
  description: "Fixture that calls an agent whose agentType is not in agent-config.yaml",
};

await agent("prompt", { agentType: "no-such-agent" });

return "unreachable";
