"""Contract tests for skill file structure."""

from pathlib import Path

import yaml

from tests.contracts.parsers import (
    extract_file_references,
    extract_skill_references,
    find_bare_references,
)

SKILLS_DIR = Path(__file__).parent.parent / "skills"
TESTS_DIR = Path(__file__).parent


def load_shared_files_manifest():
    """Load the shared files manifest."""
    with open(TESTS_DIR / "skill-manifest.yaml") as f:
        return yaml.safe_load(f)


def get_skill_expected_files(skill_name: str, manifest: dict) -> list[str]:
    """Get list of files a skill should have based on its bundles."""
    skill_bundles = manifest.get("skill_files", {}).get(skill_name, [])
    bundles = manifest.get("bundles", {})

    files = []
    for bundle_name in skill_bundles:
        bundle_files = bundles.get(bundle_name, [])
        files.extend(bundle_files)

    return files


def test_shared_files_exist(skill_name):
    """Verify each skill has all shared files it should receive."""
    skill_dir = SKILLS_DIR / skill_name

    manifest = load_shared_files_manifest()
    expected_files = get_skill_expected_files(skill_name, manifest)

    for file_path in expected_files:
        full_path = skill_dir / file_path
        assert full_path.exists(), f"Skill '{skill_name}' missing shared file '{file_path}'"


def get_all_source_files(manifest: dict) -> set[str]:
    """Get all unique source file paths from all bundles.

    Bundle paths are like '_shared/reference/foo.md'.
    Source files are in 'skills/_shared/reference/foo.md'.
    Returns paths relative to skills/_shared/ (e.g., 'reference/foo.md').
    """
    files = set()
    for bundle_files in manifest.get("bundles", {}).values():
        for file_path in bundle_files:
            # Strip _shared/ prefix to get source path
            if file_path.startswith("_shared/"):
                source_path = file_path[len("_shared/") :]
            else:
                source_path = file_path
            files.add(source_path)
    return files


def test_shared_source_files_exist():
    """Verify all source files referenced in bundles exist in skills/_shared/."""
    shared_source_dir = SKILLS_DIR / "_shared"
    manifest = load_shared_files_manifest()
    source_files = get_all_source_files(manifest)

    for source_path in sorted(source_files):
        full_path = shared_source_dir / source_path
        assert full_path.exists(), (
            f"Shared source file '{source_path}' missing from skills/_shared/"
        )


def test_file_references_use_markdown_links(skill_name):
    """Verify all file/URL references use markdown link syntax [text](path).

    Bare references like `path/file.md` or bare URLs are not allowed.
    Code blocks are excluded from this check.
    """
    skill_md = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_md.exists():
        return  # Other tests will catch missing SKILL.md

    content = skill_md.read_text()
    bare_refs = find_bare_references(content)

    assert not bare_refs, (
        f"Skill '{skill_name}': Non-markdown-link references found - use [text](path) syntax:\n"
        + "\n".join(f"  - {ref}" for ref in bare_refs)
    )


def test_file_references_exist(skill_name):
    """Verify all files referenced via markdown links exist."""
    skill_dir = SKILLS_DIR / skill_name
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return  # Other tests will catch missing SKILL.md

    content = skill_md.read_text()
    file_refs = extract_file_references(content)

    for file_path in file_refs:
        full_path = skill_dir / file_path
        assert full_path.exists(), (
            f"Skill '{skill_name}': References non-existent file '{file_path}'"
        )


def test_skill_references_valid(skill_name):
    """Verify all skill references are valid (local or declared external)."""
    skill_dir = SKILLS_DIR / skill_name
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return  # Other tests will catch missing SKILL.md

    content = skill_md.read_text()
    skill_refs = extract_skill_references(content)

    if not skill_refs:
        return  # No skill references to validate

    manifest = load_shared_files_manifest()
    plugin_name = manifest.get("plugin_name", "pairingbuddy")
    local_skills = set(manifest.get("skills", []))
    external_skills = manifest.get("external_skills", {})

    for ref_plugin, ref_skill in skill_refs:
        if ref_plugin == plugin_name:
            # Internal reference - skill must exist locally
            assert ref_skill in local_skills, (
                f"Skill '{skill_name}': References unknown local skill "
                f"'@{ref_plugin}:{ref_skill}' - not found in skills list"
            )
        else:
            # External reference - must be declared in external_skills
            declared_external = external_skills.get(ref_plugin, [])
            assert ref_skill in declared_external, (
                f"Skill '{skill_name}': References external skill "
                f"'@{ref_plugin}:{ref_skill}' - not declared in external_skills"
            )


def test_subagent_templates_reference_skills(skill_name):
    """Verify subagent templates contain valid skill references.

    Subagent templates describe how to spawn atomic skills. Each template
    MUST contain at least one @plugin:skill reference to the skill it spawns.
    """
    skill_dir = SKILLS_DIR / skill_name
    templates_dir = skill_dir / "subagent-templates"

    if not templates_dir.exists():
        return  # Skill doesn't have subagent templates

    template_files = list(templates_dir.glob("*.md"))
    if not template_files:
        return  # No templates to validate

    manifest = load_shared_files_manifest()
    plugin_name = manifest.get("plugin_name", "pairingbuddy")
    local_skills = set(manifest.get("skills", []))
    external_skills = manifest.get("external_skills", {})

    for template_file in template_files:
        template_name = template_file.stem
        content = template_file.read_text()
        skill_refs = extract_skill_references(content)

        # Each template MUST reference at least one skill
        assert skill_refs, (
            f"Template '{template_name}' in skill '{skill_name}': "
            f"Missing skill reference - templates must contain @plugin:skill-name"
        )

        # All referenced skills must be valid
        for ref_plugin, ref_skill in skill_refs:
            if ref_plugin == plugin_name:
                assert ref_skill in local_skills, (
                    f"Template '{template_name}' in skill '{skill_name}': "
                    f"References unknown local skill '@{ref_plugin}:{ref_skill}'"
                )
            else:
                declared_external = external_skills.get(ref_plugin, [])
                assert ref_skill in declared_external, (
                    f"Template '{template_name}' in skill '{skill_name}': "
                    f"References external skill '@{ref_plugin}:{ref_skill}' "
                    f"- not declared in external_skills"
                )
