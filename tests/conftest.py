# Shared pytest fixtures for mimer-code tests
from pathlib import Path

import yaml


def load_manifest():
    """Load the shared-files.yaml manifest."""
    yaml_path = Path(__file__).parent / "shared-files.yaml"
    with open(yaml_path) as f:
        return yaml.safe_load(f)


def pytest_generate_tests(metafunc):
    """Generate parametrized tests for skill names."""
    if "skill_name" in metafunc.fixturenames:
        config = load_manifest()
        metafunc.parametrize("skill_name", config["skills"])
