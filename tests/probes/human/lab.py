#!/usr/bin/env python3
"""Set up and read back a human probe lab.

    uv run python tests/probes/human/lab.py setup P3
    uv run python tests/probes/human/lab.py show P3

`setup` builds a temp repo and a private copy of the fixtures, writes start.sh and
prints the line to paste. `show` prints what the latest lab recorded, scrubbed, ready
to paste back. Nothing here changes this worktree, the installed plugin or user
settings. P12 installs into a throwaway CLAUDE_CONFIG_DIR inside the lab.
"""

import argparse
import json
import os
import shlex
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from harness import Context, recordings_root, scrub  # noqa: E402

BASE = "--model haiku --setting-sources project,local --strict-mcp-config"
DENY_WORKFLOW = {"tool": "Workflow", "match": "gated", "reason": "PROBE-DENY stage order"}
DENY_BASH = {"tool": "Bash", "match": "pb-deny-me", "reason": "PROBE-DENY bash"}
PROBES = {
    "P3": {"flags": "--permission-mode auto"},
    "P4": {
        "flags": "--permission-mode auto",
        "rules": {"deny": [{"tool": "Bash", "match": "pb-bang", "reason": "PROBE-DENY bash"}]},
    },
    "P6": {"flags": "--permission-mode default"},
    "P12": {"market": True},
    "P13A": {"flags": "--permission-mode default"},
    "P13B": {
        "flags": "--dangerously-skip-permissions",
        "rules": {"deny": [DENY_WORKFLOW, DENY_BASH]},
    },
    "P18": {
        "flags": "--permission-mode default",
        "rules": {"allow": [{"tool": "Bash", "match": "pb-runner-cmd"}]},
    },
    "P19": {"builder": True},
    "P20": {"mod": True, "flags": "--permission-mode auto"},
}


def latest(probe: str) -> Path:
    labs = sorted((recordings_root() / "human" / probe).glob("*"))
    if not labs:
        raise SystemExit(f"No lab for {probe}. Run setup first.")
    return labs[-1]


def copy_fixture(name: str, target: Path, lab: Path) -> None:
    shutil.copytree(HERE / "fixtures" / name, target)
    for path in target.rglob("register.ts*"):
        path.write_text(path.read_text().replace("__LAB__", str(lab)))


def start_script(lab: Path, body: str) -> None:
    script = lab / "start.sh"
    script.write_text(
        "#!/bin/sh\n"
        "# Clears session and policy variables, so a run inside any shell starts clean.\n"
        "for v in $(env | cut -d= -f1 | grep -E '^(CLAUDE|PAIRINGBUDDY|ANTHROPIC_)'); do\n"
        '  unset "$v"\ndone\n'
        f"export PROBE_DIR={shlex.quote(str(lab))}\n"
        f"cd {shlex.quote(str(lab / 'repo'))} || exit 1\n"
        f"{body}\n"
    )
    script.chmod(0o755)


def build_market(lab: Path) -> str:
    market = lab / "market"
    (market / ".claude-plugin").mkdir(parents=True)
    shutil.copy(HERE / "fixtures/marketplace.json", market / ".claude-plugin/marketplace.json")
    shutil.copytree(lab / "plugin", market / "pbprobe")
    copy_fixture("hookonly-plugin", market / "pbhookonly", lab)
    config = shlex.quote(str(lab / "config"))
    return (
        f"export CLAUDE_CONFIG_DIR={config}\n"
        f"claude plugin marketplace add {shlex.quote(str(market))}\n"
        "claude plugin install pbprobe@pbprobe-local\n"
        "claude plugin install pbhookonly@pbprobe-local\n"
        "exec claude --model haiku --permission-mode auto"
    )


def build_builder(b_old: str) -> str:
    root = shlex.quote(str(Path(b_old).expanduser().resolve()))
    return (
        f'claude -p "Reply ok." --plugin-dir {root} --model haiku --max-budget-usd 0.25 '
        '--output-format stream-json --verbose < /dev/null > "$PROBE_DIR/init.stream"\n'
        'echo "Recorded. Now run lab.py show P19."'
    )


def setup(probe: str, b_old: str | None) -> None:
    spec = PROBES[probe]
    if spec.get("builder") and not b_old:
        raise SystemExit("P19 needs the B-old checkout: lab.py setup P19 --b-old <path>")
    lab = recordings_root() / "human" / probe / time.strftime("%Y%m%d-%H%M%S")
    Context(probe, lab).setup(spec.get("rules"))
    if spec.get("market"):
        body = build_market(lab)
    elif spec.get("builder"):
        body = build_builder(b_old)
    elif spec.get("mod"):
        copy_fixture("mod-plugin", lab / "mod-plugin", lab)
        body = f'exec claude --plugin-dir "$PROBE_DIR/mod-plugin" {BASE} {spec["flags"]}'
    else:
        body = f'exec claude --plugin-dir "$PROBE_DIR/plugin" {BASE} {spec["flags"]}'
    start_script(lab, body)
    print(f"sh {shlex.quote(str(lab / 'start.sh'))}")


def head(value: object, width: int) -> str:
    return json.dumps(value, ensure_ascii=False)[:width]


def show_hooks(lab: Path) -> None:
    path = lab / "hooks.jsonl"
    rows = [json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []
    print(f"-- {len(rows)} hook payloads")
    for row in rows:
        event, tool = row.get("hook_event_name"), row.get("tool_name", "")
        wide = 900 if tool == "AskUserQuestion" else 110
        response = head(row["tool_response"], wide) if "tool_response" in row else ""
        print(
            f"{event} {tool} mode={row.get('permission_mode')} "
            f"agent={row.get('agent_type', '-')} in={head(row.get('tool_input'), 110)} {response}"
        )


def show_builder(lab: Path) -> None:
    path = lab / "init.stream"
    if not path.exists():
        print("-- no init.stream")
        return
    events = []
    for line in path.read_text().splitlines():
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    init = next((e for e in events if e.get("subtype") == "init"), {})
    print("-- plugins named pairingbuddy in the session")
    for plugin in init.get("plugins", []):
        if plugin["name"] == "pairingbuddy":
            print(
                f"{plugin.get('source')} version={plugin.get('version')} path={plugin.get('path')}"
            )
    hooks = [e.get("hook_name") for e in events if e.get("subtype") == "hook_started"]
    print(f"-- hooks started: {hooks}")
    print(f"-- errors: {[e.get('result') for e in events if e.get('is_error')]}")


def show(probe: str) -> None:
    lab = latest(probe)
    print(f"lab {scrub(str(lab))}")
    show_hooks(lab)
    show_builder(lab) if PROBES[probe].get("builder") else None
    for name in ("mod.jsonl", "mod.log", "hookonly-mod.log", "hookonly-shell.jsonl"):
        path = lab / name
        if path.exists():
            lines = path.read_text().splitlines()
            print(f"-- {name}: {len(lines)} lines")
            print("\n".join(line[:160] for line in lines[:12]))
    done = [p.name for p in (lab / "repo/.probe").glob("*")]
    print(f"-- .probe markers: {sorted(done)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["setup", "show"])
    parser.add_argument("probe", choices=sorted(PROBES))
    parser.add_argument("--b-old", default=os.environ.get("PB_B_OLD"))
    args = parser.parse_args()
    if args.action == "setup":
        setup(args.probe, args.b_old)
    else:
        original = sys.stdout.write
        sys.stdout.write = lambda text: original(scrub(text))
        show(args.probe)


if __name__ == "__main__":
    main()
