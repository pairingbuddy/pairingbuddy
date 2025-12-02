"""Parameterized tests for JSON state schemas in contracts/schemas/.

Tests derive the schema list from agent-config.yaml - single source of truth.
"""

import json
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft7Validator

PROJECT_ROOT = Path(__file__).parent.parent.parent
SCHEMAS_DIR = PROJECT_ROOT / "contracts" / "schemas"
AGENT_CONFIG = PROJECT_ROOT / "contracts" / "agent-config.yaml"


def load_agent_config():
    """Load agent configuration from YAML."""
    with open(AGENT_CONFIG) as f:
        return yaml.safe_load(f)


def get_schema_names():
    """Get list of schema names from config."""
    config = load_agent_config()
    return config["schemas"]


def get_expected_schema_version():
    """Get expected $schema version from config."""
    config = load_agent_config()
    return config["schema_version"]


def load_schema(schema_name: str) -> dict:
    """Load a schema file by name."""
    schema_path = SCHEMAS_DIR / schema_name
    with open(schema_path) as f:
        return json.load(f)


# =============================================================================
# Schema Existence and Validity Tests
# =============================================================================


@pytest.mark.parametrize("schema_name", get_schema_names())
def test_schema_file_exists(schema_name):
    """Schema file must exist in contracts/schemas/."""
    schema_path = SCHEMAS_DIR / schema_name
    assert schema_path.exists(), f"Schema file not found: {schema_path}"


@pytest.mark.parametrize("schema_name", get_schema_names())
def test_schema_declares_expected_version(schema_name):
    """Schema must declare the expected $schema version."""
    schema_path = SCHEMAS_DIR / schema_name
    if not schema_path.exists():
        pytest.skip(f"Schema file not found: {schema_path}")

    schema = load_schema(schema_name)
    expected_version = get_expected_schema_version()

    assert "$schema" in schema, f"Schema missing $schema declaration: {schema_name}"
    assert schema["$schema"] == expected_version, (
        f"Schema version mismatch in {schema_name}: "
        f"expected '{expected_version}', got '{schema['$schema']}'"
    )


@pytest.mark.parametrize("schema_name", get_schema_names())
def test_schema_is_valid_json_schema(schema_name):
    """Schema file must be a valid JSON Schema."""
    schema_path = SCHEMAS_DIR / schema_name
    if not schema_path.exists():
        pytest.skip(f"Schema file not found: {schema_path}")

    schema = load_schema(schema_name)
    # Draft7Validator matches our pinned schema_version
    Draft7Validator.check_schema(schema)


# =============================================================================
# Agent Schema Reference Tests
# =============================================================================


def get_agent_schema_refs():
    """Get list of (agent_name, schema_type, schema_name) tuples."""
    config = load_agent_config()
    refs = []
    for agent_name, agent_config in config["agents"].items():
        refs.append((agent_name, "input_schema", agent_config["input_schema"]))
        refs.append((agent_name, "output_schema", agent_config["output_schema"]))
    return refs


@pytest.mark.parametrize("agent_name,schema_type,schema_name", get_agent_schema_refs())
def test_agent_schema_reference_exists(agent_name, schema_type, schema_name):
    """Agent schema references must point to existing schema files."""
    schema_path = SCHEMAS_DIR / schema_name
    assert schema_path.exists(), (
        f"Agent '{agent_name}' references non-existent {schema_type}: {schema_name}"
    )
