// The pane's height budget: how its rows share the room the platform gives its body. Pure, no I/O, no node: imports.
import { plural } from "./glance.mjs";
import { PLAN_ROWS } from "./plan-window.mjs";

// The fewest rows the PLAN block keeps before anything else folds no more: a cut row, the focus's tracer and unit, a fact
// or two, the focus task and the cut row under it.
export const PLAN_FLOOR = 7;

const sum = (numbers) => numbers.reduce((total, n) => total + n, 0);

// What fits the room: which of the folding rows (STEPS, TESTS, REVIEW, in the order they fold) fold, and the most rows the
// PLAN block may take. room: the rows the body shows at once, unknown keeps today's layout; fixed: the rows that never fold;
// sections: each folding row's lines, full and folded; plan: the PLAN block's rows at its most.
export function paneBudget({ room, fixed, sections, plan }) {
  const fold = sections.map(() => false);
  if (!(room > 0)) return { fold, planRoom: PLAN_ROWS };
  const need = Math.min(plan, PLAN_FLOOR);
  const used = () => fixed + sum(sections.map((section, i) => (fold[i] ? section.folded : section.full)));
  for (const i of sections.keys()) {
    if (used() + need <= room) break;
    fold[i] = true;
  }
  return { fold, planRoom: Math.min(PLAN_ROWS, Math.max(PLAN_FLOOR, room - used())) };
}

// How many of the pane's `total` rows sit below the room's last row once that row tells them; none while they fit, or while
// the room is not known.
export function hiddenRows(total, room) {
  if (!(room > 0) || total <= room) return 0;
  return total - (room - 1);
}

// The platform draws no "more" hint under a pane, and its body scrolls with the arrows only once it has the keys (ctrl+x tab).
const SCROLL_HOW = { unfocused: "ctrl+x tab, then arrows", focused: "arrows scroll" };

// The count row's words: how many rows are below, and how to reach them.
export const moreRowsLine = (hidden, focused) => `↓ ${plural(hidden, "more row")} · ${focused ? SCROLL_HOW.focused : SCROLL_HOW.unfocused}`;
