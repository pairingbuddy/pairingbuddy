import json
import pathlib

HOOKS_JSON = pathlib.Path(__file__).parent.parent / "hooks" / "hooks.json"


def test_registered_in_hooks_json():
    """hooks.json contains a PostToolUse entry that invokes solo-progress.mjs"""
    hooks_data = json.loads(HOOKS_JSON.read_text())

    post_tool_use_hooks = []
    for entry in hooks_data["hooks"]["PostToolUse"]:
        post_tool_use_hooks.extend(entry["hooks"])

    solo_progress_hooks = [
        hook for hook in post_tool_use_hooks if "solo-progress.mjs" in hook["command"]
    ]
    assert len(solo_progress_hooks) >= 1, (
        "PostToolUse hooks must contain an entry for solo-progress.mjs"
    )

    for hook in solo_progress_hooks:
        assert hook["type"] == "command", (
            f"solo-progress.mjs entry must have type 'command', got {hook['type']!r}"
        )


def test_tap_registered_in_hooks_json():
    """hooks.json contains a PostToolUse entry that invokes tap.mjs for its recorded tools"""
    hooks_data = json.loads(HOOKS_JSON.read_text())

    entries = [
        entry
        for entry in hooks_data["hooks"]["PostToolUse"]
        if any("tap.mjs" in hook["command"] for hook in entry["hooks"])
    ]

    assert sorted(entry["matcher"] for entry in entries) == [
        "AskUserQuestion",
        "StructuredOutput|Workflow",
    ], "PostToolUse must route exactly these tools to tap.mjs"
    for entry in entries:
        for hook in entry["hooks"]:
            assert hook["type"] == "command"


def test_gate_registered_in_hooks_json():
    """hooks.json contains one PreToolUse entry that invokes gate-boot.mjs for its gated tools"""
    hooks_data = json.loads(HOOKS_JSON.read_text())

    entries = [
        entry
        for entry in hooks_data["hooks"]["PreToolUse"]
        if any("gate-boot.mjs" in hook["command"] for hook in entry["hooks"])
    ]

    assert len(entries) == 1, "PreToolUse must contain one entry for gate-boot.mjs"
    assert entries[0]["matcher"] == "Workflow|Agent|Write|Edit|NotebookEdit|Bash|AskUserQuestion"
    for hook in entries[0]["hooks"]:
        assert hook["type"] == "command"
