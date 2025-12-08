"""Tests that agent inline schemas match canonical schema files.

Agents document their input/output schemas inline. These must match the
canonical schemas in contracts/schemas/ - property names and structure
must be consistent to prevent drift.
"""

import json
import re
from pathlib import Path

import pytest
import yaml

PROJECT_ROOT = Path(__file__).parent.parent.parent
AGENTS_DIR = PROJECT_ROOT / "agents"
CONTRACTS_DIR = PROJECT_ROOT / "contracts"
SCHEMAS_DIR = CONTRACTS_DIR / "schemas"


def load_agent_config():
    """Load agent configuration from YAML."""
    config_path = CONTRACTS_DIR / "agent-config.yaml"
    with open(config_path) as f:
        return yaml.safe_load(f)


def extract_json_from_section(content: str, section_name: str) -> dict | None:
    """Extract JSON block from a markdown section."""
    # Find the section
    section_pattern = rf"^## {section_name}\s*$"
    section_match = re.search(section_pattern, content, re.MULTILINE)
    if not section_match:
        return None

    # Find content after section header until next ## heading
    section_start = section_match.end()
    next_section = re.search(r"^## ", content[section_start:], re.MULTILINE)
    if next_section:
        section_content = content[section_start : section_start + next_section.start()]
    else:
        section_content = content[section_start:]

    # Extract ALL JSON from code blocks (agents may document multiple inputs)
    json_pattern = r"```json\s*\n(.*?)\n```"
    json_matches = re.findall(json_pattern, section_content, re.DOTALL)
    if not json_matches:
        return None

    # Parse each JSON block and return list of schemas
    schemas = []
    for json_text in json_matches:
        parsed = parse_simplified_schema(json_text)
        if parsed:
            schemas.append(parsed)

    return schemas if schemas else None


def parse_simplified_schema(json_text: str) -> dict:
    """Parse the simplified schema format used in agents.

    Agent schemas use format like:
    {
      "property": "string (description)",
      "nested": { ... }
    }

    We extract the structure (property names and nesting) for comparison.
    """
    # Replace type annotations with valid JSON strings for parsing
    # "string (description)" -> "string"
    # "integer (description)" -> 0
    # "array of strings" -> []
    cleaned = re.sub(r'"string[^"]*"', '"__string__"', json_text)
    cleaned = re.sub(r'"integer[^"]*"', "0", cleaned)
    cleaned = re.sub(r'"\[array[^"]*\]"', "[]", cleaned)
    # Handle "type | type | type" enum patterns
    cleaned = re.sub(r'"[a-z_]+(\s*\|\s*[a-z_]+)+"', '"__enum__"', cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # If parsing fails, return empty dict
        return {}


def extract_property_names(obj: dict, prefix: str = "") -> set:
    """Recursively extract all property names from a schema structure."""
    names = set()
    if isinstance(obj, dict):
        for key, value in obj.items():
            # Normalize dynamic key patterns (e.g., <runner_id> -> <key>)
            if key.startswith("<") and key.endswith(">"):
                key = "<key>"
            full_name = f"{prefix}.{key}" if prefix else key
            names.add(full_name)
            if isinstance(value, dict):
                names.update(extract_property_names(value, full_name))
            elif isinstance(value, list) and value and isinstance(value[0], dict):
                names.update(extract_property_names(value[0], f"{full_name}[]"))
    return names


def get_canonical_properties(schema_path: Path) -> set:
    """Extract property names from a canonical JSON Schema file."""
    with open(schema_path) as f:
        schema = json.load(f)

    return extract_properties_from_json_schema(schema)


def extract_properties_from_json_schema(schema: dict, prefix: str = "") -> set:
    """Extract property names from JSON Schema format."""
    names = set()

    if "properties" in schema:
        for prop_name, prop_schema in schema["properties"].items():
            full_name = f"{prefix}.{prop_name}" if prefix else prop_name
            names.add(full_name)

            if prop_schema.get("type") == "object":
                # Handle additionalProperties for dynamic keys
                if "additionalProperties" in prop_schema:
                    add_props = prop_schema["additionalProperties"]
                    if isinstance(add_props, dict) and add_props.get("type") == "object":
                        # Use wildcard <key> to represent dynamic keys
                        # Add the <key> level itself, then its nested properties
                        names.add(f"{full_name}.<key>")
                        names.update(
                            extract_properties_from_json_schema(add_props, f"{full_name}.<key>")
                        )
                else:
                    names.update(extract_properties_from_json_schema(prop_schema, full_name))
            elif prop_schema.get("type") == "array" and "items" in prop_schema:
                items = prop_schema["items"]
                if items.get("type") == "object":
                    names.update(extract_properties_from_json_schema(items, f"{full_name}[]"))

    return names


def normalize_dynamic_keys(props: set) -> set:
    """Normalize dynamic key patterns to <key> for comparison.

    Agent docs may use descriptive names like <runner_id> or <config_name>
    which should match the canonical <key> from additionalProperties.
    """
    import re

    normalized = set()
    for prop in props:
        # Replace any <word> pattern with <key>
        normalized.add(re.sub(r"<\w+>", "<key>", prop))
    return normalized


# Get all agents from config
config = load_agent_config()
AGENTS = list(config["agents"].keys())


def get_agent_input_refs():
    """Get list of (agent_name, input_name, schema_name) tuples for parameterization."""
    config = load_agent_config()
    refs = []
    for agent_name, agent_config in config["agents"].items():
        inputs = agent_config.get("inputs", {})
        for input_name, input_def in inputs.items():
            refs.append((agent_name, input_name, input_def["schema"]))
    return refs


@pytest.mark.parametrize("agent_name,input_name,schema_file", get_agent_input_refs())
def test_agent_input_schema_matches_canonical(agent_name, input_name, schema_file):
    """Test that agent's Input section contains properties from canonical schema."""
    # Read agent file
    agent_path = AGENTS_DIR / f"{agent_name}.md"
    if not agent_path.exists():
        pytest.skip(f"Agent file {agent_path} does not exist")

    with open(agent_path) as f:
        agent_content = f.read()

    # Extract properties from agent's Input section (may have multiple JSON blocks)
    agent_schemas = extract_json_from_section(agent_content, "Input")
    if not agent_schemas:
        pytest.fail(f"Could not extract JSON from Input section of {agent_name}")

    # Collect properties from all documented schemas
    agent_props = set()
    for schema in agent_schemas:
        agent_props.update(normalize_dynamic_keys(extract_property_names(schema)))

    # Get properties from canonical schema (already uses <key> for dynamic keys)
    canonical_path = SCHEMAS_DIR / schema_file
    canonical_props = get_canonical_properties(canonical_path)

    # Check that canonical properties are present in agent's documented schema
    missing_in_agent = canonical_props - agent_props
    if missing_in_agent:
        pytest.fail(
            f"Schema drift detected in {agent_name} Input section for {input_name}:\n"
            f"  Missing from agent: {missing_in_agent}\n"
            f"  Canonical schema: {schema_file}"
        )


def get_agent_output_refs():
    """Get list of (agent_name, output_name, schema_name) tuples for parameterization."""
    config = load_agent_config()
    refs = []
    for agent_name, agent_config in config["agents"].items():
        outputs = agent_config.get("outputs", {})
        for output_name, output_def in outputs.items():
            refs.append((agent_name, output_name, output_def["schema"]))
    return refs


@pytest.mark.parametrize("agent_name,output_name,schema_file", get_agent_output_refs())
def test_agent_output_schema_matches_canonical(agent_name, output_name, schema_file):
    """Test that agent's Output section contains properties from canonical schema."""
    # Read agent file
    agent_path = AGENTS_DIR / f"{agent_name}.md"
    if not agent_path.exists():
        pytest.skip(f"Agent file {agent_path} does not exist")

    with open(agent_path) as f:
        agent_content = f.read()

    # Extract properties from agent's Output section (may have multiple JSON blocks)
    agent_schemas = extract_json_from_section(agent_content, "Output")
    if not agent_schemas:
        pytest.fail(f"Could not extract JSON from Output section of {agent_name}")

    # Collect properties from all documented schemas
    agent_props = set()
    for schema in agent_schemas:
        agent_props.update(normalize_dynamic_keys(extract_property_names(schema)))

    # Get properties from canonical schema (already uses <key> for dynamic keys)
    canonical_path = SCHEMAS_DIR / schema_file
    canonical_props = get_canonical_properties(canonical_path)

    # Check that canonical properties are present in agent's documented schema
    missing_in_agent = canonical_props - agent_props
    if missing_in_agent:
        pytest.fail(
            f"Schema drift detected in {agent_name} Output section for {output_name}:\n"
            f"  Missing from agent: {missing_in_agent}\n"
            f"  Canonical schema: {schema_file}"
        )


@pytest.mark.parametrize("agent_name", AGENTS)
def test_agent_has_file_creation_restrictions_section(agent_name):
    """Test that agent has a File Creation Restrictions section."""
    agent_path = AGENTS_DIR / f"{agent_name}.md"
    assert agent_path.exists(), f"Agent file {agent_path} does not exist"

    with open(agent_path) as f:
        agent_content = f.read()

    assert "### File Creation Restrictions" in agent_content, (
        f"Agent {agent_name} is missing '### File Creation Restrictions' section"
    )


@pytest.mark.parametrize("agent_name", AGENTS)
def test_agent_file_creation_restrictions_mentions_output_files(agent_name):
    """Test that File Creation Restrictions mentions all configured output files."""
    agent_config = config["agents"][agent_name]
    outputs = agent_config.get("outputs", {})

    assert outputs, f"Agent {agent_name} must have outputs configured"

    agent_path = AGENTS_DIR / f"{agent_name}.md"
    assert agent_path.exists(), f"Agent file {agent_path} does not exist"

    with open(agent_path) as f:
        agent_content = f.read()

    # Extract the File Creation Restrictions section
    section_pattern = r"### File Creation Restrictions\s*\n(.*?)(?=\n##|\n\*\*Do NOT|\Z)"
    match = re.search(section_pattern, agent_content, re.DOTALL)
    assert match, f"Agent {agent_name} is missing '### File Creation Restrictions' section"

    restrictions_content = match.group(1)

    # Check each output file is mentioned
    for output_name, output_def in outputs.items():
        output_file = output_def["file"]
        assert output_file in restrictions_content, (
            f"Agent {agent_name} File Creation Restrictions does not mention "
            f"configured output file '{output_file}' for output '{output_name}'"
        )
