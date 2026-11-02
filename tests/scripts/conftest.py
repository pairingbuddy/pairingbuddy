import shutil

import pytest

from tests.scripts.bundler_helpers import FIXTURE_ROOT


@pytest.fixture
def fixture_tree(tmp_path):
    """Copy of the fixture source tree, safe to extend or break per test."""
    root = tmp_path / "root"
    shutil.copytree(FIXTURE_ROOT, root)
    return root
