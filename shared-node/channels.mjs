// The two marketplace channels, and the rule that only one is on. Both publish the manifest name `pairingbuddy`, so
// commands read `/pairingbuddy:code` on either; the marketplace entry name is what tells them apart in enabledPlugins.
export const STABLE = "pairingbuddy@pairingbuddy-marketplace";
export const EXPERIMENTAL = "pairingbuddy-experimental@pairingbuddy-marketplace";

// Layers lowest precedence first (user, project, local), merged key by key as Claude Code does.
export function mergeEnabledPlugins(layers) {
  const merged = {};
  for (const settings of layers) {
    const plugins = settings?.enabledPlugins;
    if (plugins && typeof plugins === "object" && !Array.isArray(plugins)) Object.assign(merged, plugins);
  }
  return merged;
}

export function bothChannelsOn(enabled) {
  return enabled[STABLE] === true && enabled[EXPERIMENTAL] === true;
}

export const CHANNEL_CONFLICT = [
  "Pairing Buddy stable and experimental are both on. Only one can be on at a time, so Pairing Buddy refuses every prompt until one is off.",
  "Run one of these in a terminal, then restart Claude Code:",
  `  stay on stable:        claude plugin disable ${EXPERIMENTAL}`,
  `  stay on experimental:  claude plugin disable ${STABLE}`,
].join("\n");
