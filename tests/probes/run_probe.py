#!/usr/bin/env python3
"""Run a named T0 probe and append its result row.

    PROBE_RECORDINGS=<dir> python3 tests/probes/run_probe.py P1
    python3 tests/probes/run_probe.py --list
    python3 tests/probes/run_probe.py P1 --judge <recording dir>   (no model calls)
    python3 tests/probes/run_probe.py P1 --no-row                  (print the verdict only)

A crash in a probe raises and writes no row: that is a harness bug, not a result.
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cases import CASES  # noqa: E402
from harness import Context, record_row, recordings_root, spend_so_far  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("probe", nargs="?")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--judge", type=Path, help="re-judge an existing recording")
    parser.add_argument("--no-row", action="store_true")
    args = parser.parse_args()
    if args.list or not args.probe:
        print("\n".join(CASES))
        return 0
    case = CASES[args.probe.upper()]
    recordings_root().mkdir(parents=True, exist_ok=True)
    run_dir = args.judge or recordings_root() / case.name / time.strftime("%Y%m%d-%H%M%S")
    ctx = Context(case.name, run_dir.resolve())
    if args.judge:
        ctx.load()
    else:
        case.run(ctx)
    verdict = case.judge(ctx)
    print(f"{case.name}: {verdict.result}: {verdict.evidence}")
    print(f"recording: {run_dir}\nspend so far: ${spend_so_far():.4f}")
    if not args.no_row:
        record_row(case.name, verdict.result, verdict.evidence, verdict.change, run_dir.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
