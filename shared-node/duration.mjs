// Seconds to a run-time clock ("m:ss" or "h:mm:ss"), shared by the pane and the report so they never differ.
// Pure and import-free, so the mod can load it.
export const TIME_UNKNOWN = "time unknown";

export function clock(totalSeconds) {
  const seconds = Math.floor(totalSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return TIME_UNKNOWN;
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
