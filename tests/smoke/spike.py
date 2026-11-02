"""T1c spike: which minimal sample task a cheap model finishes reliably within the cap.

Each round runs every task once, in parallel, up to ROUNDS, and stops early on a clear winner.
Total spend stays under SPEND_LIMIT_USD: each run's cap is its share of what is left below
STOP_AT_USD, and a run whose cost is unknown is charged at its cap. Outside pytest, because it
spends money:

    uv run python -m tests.smoke.spike --record-dir DIR [--tasks flag value add-key]
"""

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from tests.smoke.runner import BUDGET_USD, Budget
from tests.smoke.s1 import TASKS, run_s1

ROUNDS = 5
EARLY_ROUND = 3
OUT_AFTER_FAILURES = 2
SPEND_LIMIT_USD = 5.0
STOP_AT_USD = 4.5
MIN_RUN_CAP_USD = 0.25


def passes(runs: list[dict]) -> int:
    return sum(run["passed"] for run in runs)


def mean_cost(runs: list[dict]) -> float:
    return sum(run["cost_usd"] for run in runs) / len(runs)


def clear_winner(tally: dict[str, list[dict]]) -> str | None:
    """A flawless task with every rival out from round 3, or the best after the last round."""
    played = min(len(runs) for runs in tally.values())
    if played < EARLY_ROUND:
        return None
    if played >= ROUNDS:
        return min(tally, key=lambda name: (-passes(tally[name]), mean_cost(tally[name])))
    flawless = [name for name, runs in tally.items() if passes(runs) == len(runs)]
    failures = {name: len(runs) - passes(runs) for name, runs in tally.items()}
    rivals_out = all(failures[name] >= OUT_AFTER_FAILURES for name in tally if name not in flawless)
    return flawless[0] if len(flawless) == 1 and rivals_out else None


def charged(result: dict, run_cap: float) -> float:
    return result["cost_usd"] if result["cost_known"] else run_cap


def run_round(tasks: list[str], number: int, run_cap: float, record: Path) -> list[dict]:
    def one(task: str) -> dict:
        path = record / task / f"run-{number}"
        return run_s1(task, path, Budget(run_cap)).__dict__ | {"round": number}

    with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        return list(pool.map(one, tasks))


def spike(tasks: list[str], record: Path) -> tuple[str | None, float]:
    tally: dict[str, list[dict]] = {task: [] for task in tasks}
    spent = 0.0
    log = record / "results.jsonl"
    for number in range(1, ROUNDS + 1):
        run_cap = min(BUDGET_USD, (STOP_AT_USD - spent) / len(tasks))
        if run_cap < MIN_RUN_CAP_USD:
            print(f"stopped on spend at ${spent:.4f} before round {number}")
            return None, spent
        for result in run_round(tasks, number, run_cap, record):
            tally[result["task"]].append(result)
            spent += charged(result, run_cap)
            with log.open("a") as f:
                f.write(json.dumps(result) + "\n")
            print(json.dumps(result), flush=True)
        winner = clear_winner(tally)
        if winner is not None:
            return winner, spent
    return None, spent


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record-dir", type=Path, required=True)
    parser.add_argument("--tasks", nargs="+", choices=sorted(TASKS), default=sorted(TASKS))
    options = parser.parse_args()
    options.record_dir.mkdir(parents=True, exist_ok=True)
    winner, spent = spike(options.tasks, options.record_dir)
    print(f"winner: {winner}, spent ${spent:.4f} of the ${SPEND_LIMIT_USD} limit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
