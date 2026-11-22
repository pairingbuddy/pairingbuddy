// The marker hooks/gate-watch.mjs leaves at run/gate-off.json while gate-boot.mjs cannot load, so nothing checks the run's
// tool calls. Pure, no node: imports, so the mod can import it. The views read a standing marker as a stop.
import { shellWord } from "./shell-word.mjs";
import { GATE_OFF } from "./stop-codes.mjs";

// The one line that restores the plugin's hooks, typed in a separate terminal or at the prompt after a `!`.
export const gateOffFix = (plugin) => `git -C ${shellWord(plugin)} checkout -- hooks`;

const isMarker = (marker) =>
  marker !== null && typeof marker === "object" && typeof marker.plugin === "string" && marker.plugin !== "" && Number.isFinite(marker.mtimeMs);

// The marker stands while gate-boot.mjs is as it was when the marker was written. stat: that file's time and size now, or null
// when it does not stat (gone, or out of the reader's reach), which leaves the marker standing.
export function standingGateOff(marker, stat) {
  if (!isMarker(marker)) return null;
  if (stat && (stat.mtimeMs !== marker.mtimeMs || stat.size !== marker.size)) return null;
  return marker;
}

// The ledger as the views read it: a standing marker is a stop, ahead of any other, since nothing checks the run. Its seq is the
// broken file's time, so the alert fires once for one break and again for the next.
export function withGateOff(ledger, marker) {
  if (!ledger || !marker) return ledger;
  return { ...ledger, stop: { code: GATE_OFF, reason: `gate-boot.mjs cannot load: ${marker.failure ?? "unknown"}`, seq: marker.mtimeMs, fix: `fix: ${gateOffFix(marker.plugin)}` } };
}
