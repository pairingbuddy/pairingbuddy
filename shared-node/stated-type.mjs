// The task type a task states for itself: a plan task's "Type: <type>" line, which the planner wrote and the human approved
// with the plan. Only a type among `types` counts; anything else, or no such line, gives null.
const TYPE_LINE = /^[\s>*-]*\**Type\**\s*:\s*\**\s*`?([a-z_]+)`?/im;

export function statedType(task, types) {
  const match = TYPE_LINE.exec(String(task ?? ""));
  return match !== null && types.includes(match[1]) ? match[1] : null;
}
