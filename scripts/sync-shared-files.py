#!/usr/bin/env python3
"""Sync shared files from skills/_shared/ to skill directories.

This script:
1. Loads the skill-manifest.yaml
2. For each skill with bundles: deletes its _shared/ subdir entirely
3. Copies fresh files from skills/_shared/ to skills/{name}/_shared/

The _shared/ subdirectory convention ensures we only touch files we own,
never skill-specific files in reference/ or modules/.
"""

import shutil
from pathlib import Path

import yaml

# Paths relative to this script
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
SKILLS_DIR = PROJECT_ROOT / "skills"
SHARED_SOURCE = SKILLS_DIR / "_shared"
MANIFEST_PATH = PROJECT_ROOT / "tests" / "skill-manifest.yaml"


def load_manifest() -> dict:
    """Load the skill-manifest.yaml."""
    with open(MANIFEST_PATH) as f:
        return yaml.safe_load(f)


def get_all_bundle_files(manifest: dict) -> set[str]:
    """Get all unique file paths from all bundles."""
    files = set()
    for bundle_files in manifest.get("bundles", {}).values():
        files.update(bundle_files)
    return files


def get_skill_files(skill_name: str, manifest: dict) -> list[str]:
    """Get list of files a skill should receive based on its bundles."""
    skill_bundles = manifest.get("skill_files", {}).get(skill_name, [])
    bundles = manifest.get("bundles", {})

    files = []
    for bundle_name in skill_bundles:
        bundle_files = bundles.get(bundle_name, [])
        files.extend(bundle_files)

    return files


def sync_skill(skill_name: str, files: list[str]) -> tuple[int, int]:
    """Sync shared files to a skill directory.

    Returns (files_copied, files_skipped) count.
    """
    skill_dir = SKILLS_DIR / skill_name
    skill_shared_dir = skill_dir / "_shared"

    # Delete existing _shared/ directory (safe - we own it entirely)
    if skill_shared_dir.exists():
        shutil.rmtree(skill_shared_dir)
        print(f"  Cleaned: {skill_name}/_shared/")

    copied = 0
    skipped = 0

    for file_path in files:
        # file_path is like "_shared/reference/code-patterns.md"
        # Source is skills/_shared/reference/code-patterns.md
        # Target is skills/{skill_name}/_shared/reference/code-patterns.md

        # Strip _shared/ prefix to get source path
        if file_path.startswith("_shared/"):
            source_subpath = file_path[len("_shared/") :]
        else:
            source_subpath = file_path

        source = SHARED_SOURCE / source_subpath
        target = skill_dir / file_path

        if not source.exists():
            print(f"  WARNING: Source missing: {source}")
            skipped += 1
            continue

        # Create target directory if needed
        target.parent.mkdir(parents=True, exist_ok=True)

        # Copy file
        shutil.copy2(source, target)
        copied += 1

    return copied, skipped


def main():
    """Main entry point."""
    print(f"Loading manifest: {MANIFEST_PATH}")
    manifest = load_manifest()

    skills_with_files = manifest.get("skill_files", {})
    print(f"Found {len(skills_with_files)} skills with shared files\n")

    total_copied = 0
    total_skipped = 0

    for skill_name in skills_with_files:
        files = get_skill_files(skill_name, manifest)
        if not files:
            continue

        print(f"Syncing {skill_name} ({len(files)} files)...")
        copied, skipped = sync_skill(skill_name, files)
        total_copied += copied
        total_skipped += skipped
        print(f"  Copied: {copied}, Skipped: {skipped}")

    print(f"\nDone. Total: {total_copied} copied, {total_skipped} skipped")

    if total_skipped > 0:
        print("\nWARNING: Some source files were missing!")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
