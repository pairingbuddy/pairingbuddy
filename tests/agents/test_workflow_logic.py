"""Tests for workflow logic in the orchestrator skill.

Tests that function calls in the workflow pseudocode resolve to registered agents.
"""

import ast
import re
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).parent.parent.parent
ORCHESTRATOR_SKILL = PROJECT_ROOT / "skills" / "coding" / "SKILL.md"
AGENT_CONFIG = PROJECT_ROOT / "contracts" / "agent-config.yaml"


def load_agent_config():
    """Load agent configuration from YAML."""
    with open(AGENT_CONFIG) as f:
        return yaml.safe_load(f)


def get_registered_agent_names() -> set[str]:
    """Get set of agent names from config."""
    config = load_agent_config()
    return set(config["agents"].keys())


def extract_workflow_code() -> str | None:
    """Extract Python code block from the Workflow section."""
    content = ORCHESTRATOR_SKILL.read_text()

    # Find the Workflow section
    pattern = r"## Workflow\s*(.*?)(?=\n## |\Z)"
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        return None

    section_content = match.group(1)

    # Extract python code block
    code_pattern = r"```python\s*(.*?)```"
    code_match = re.search(code_pattern, section_content, re.DOTALL)
    if not code_match:
        return None

    return code_match.group(1).strip()


def extract_function_calls(code: str) -> list[str]:
    """Extract all function call names from Python code using AST."""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []

    calls = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                calls.append(node.func.id)
            elif isinstance(node.func, ast.Attribute):
                calls.append(node.func.attr)
    return calls


def python_name_to_agent_name(func_name: str) -> str:
    """Convert Python function name to agent name (underscores to hyphens)."""
    return func_name.replace("_", "-")


def test_workflow_references_resolve_to_agents():
    """Function calls in workflow that look like agent names must be registered."""
    code = extract_workflow_code()
    assert code is not None, "Could not extract workflow code from orchestrator skill"

    function_calls = extract_function_calls(code)
    registered_agents = get_registered_agent_names()

    # All function calls must resolve to registered agents
    # Exception: _ prefixed functions are orchestrator logic, not agents
    unresolved = []
    for func_name in function_calls:
        if func_name.startswith("_"):
            continue  # orchestrator-only functions use _ prefix
        agent_name = python_name_to_agent_name(func_name)
        if agent_name not in registered_agents:
            unresolved.append(f"{func_name} -> {agent_name}")

    assert not unresolved, (
        f"Workflow calls functions that don't resolve to registered agents: {unresolved}"
    )
