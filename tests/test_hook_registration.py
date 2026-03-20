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
