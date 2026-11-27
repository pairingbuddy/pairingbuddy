// Which tracer bullet the task being built belongs to, for the band and the pane to name before the task.

// The tracer heading of the plan unit that holds a task with this title; null when no unit holds it or the unit has none.
export function tracerOf(plan, title) {
  const unit = (plan?.units ?? []).find(({ tasks }) => tasks.some((task) => task.title === title));
  return unit?.tracer ?? null;
}

// A tracer heading's id ("TB12", "T4b") and the rest of its name; a heading with no id is all name.
const TRACER_ID = /^([A-Za-z]+\s?\d+[a-z]?)\s*:\s*(.+)$/;
const TO_TASK = " › ";
const ID_TO_NAME = " · ";
const CUT = "…";
// A tracer name cut shorter than this says nothing: the id alone leads instead.
const SHORTEST_NAME = 8;

const width = (text) => [...text].length;

// The name cut at a word to at most `room` characters, with no trailing colon or comma.
function nameCut(name, room) {
  const chars = [...name];
  let head = chars.slice(0, room).join("");
  if (chars[room] !== undefined && chars[room] !== " " && head.includes(" ")) head = head.slice(0, head.lastIndexOf(" "));
  return head.replace(/[\s:,;·-]+$/, "");
}

// The goal line: the tracer before the task, "TB12 · <tracer name> › <task>". The task is never cut here (the surface wraps
// or cuts it); short of room the tracer name is cut first, with "…", and below a readable cut only the id leads. A tracer
// heading with no id is cut the same way as a name, and dropped when it cannot be read. No tracer: the task alone.
export function tracerGoal(tracer, goal, room) {
  if (!tracer) return goal;
  const match = TRACER_ID.exec(tracer.trim());
  const [id, name] = match ? [match[1], match[2]] : [null, tracer.trim()];
  const lead = id ? `${id}${ID_TO_NAME}` : "";
  const full = `${lead}${name}${TO_TASK}${goal}`;
  if (!(room > 0) || width(full) <= room) return full;
  const left = room - width(lead) - width(TO_TASK) - width(goal) - width(CUT);
  const cut = left >= SHORTEST_NAME ? nameCut(name, left) : "";
  if (cut) return `${lead}${cut}${CUT}${TO_TASK}${goal}`;
  return id ? `${id}${TO_TASK}${goal}` : goal;
}
