"""Parsers for extracting references from skill markdown files."""

import re


def remove_code_blocks(content: str) -> str:
    """Remove fenced and indented code blocks from markdown content.

    This prevents false positives when checking for bare references
    in code examples.
    """
    # Remove fenced code blocks (``` ... ```)
    content = re.sub(r"```[\s\S]*?```", "", content)

    # Remove indented code blocks (4 spaces or 1 tab at line start)
    # Only remove if preceded by blank line (standard markdown)
    lines = content.split("\n")
    result = []
    in_indented_block = False
    prev_blank = True

    for line in lines:
        is_indented = line.startswith("    ") or line.startswith("\t")
        is_blank = line.strip() == ""

        if is_indented and prev_blank:
            in_indented_block = True
        elif not is_indented and not is_blank:
            in_indented_block = False

        if not in_indented_block:
            result.append(line)

        prev_blank = is_blank

    return "\n".join(result)


def extract_markdown_links(content: str) -> list[tuple[str, str]]:
    """Extract markdown links from content.

    Returns list of (text, path) tuples from [text](path) patterns.
    """
    link_pattern = r"\[([^\]]*)\]\(([^)]+)\)"
    return re.findall(link_pattern, content)


def extract_file_references(content: str) -> list[str]:
    """Extract file path references from markdown links.

    Returns list of unique local file paths (not URLs).
    """
    references = set()

    for _text, path in extract_markdown_links(content):
        if _is_local_file_reference(path):
            references.add(path)

    return sorted(references)


def _is_local_file_reference(path: str) -> bool:
    """Check if a path is a local file reference (not URL or anchor)."""
    # Skip URLs
    if path.startswith(("http://", "https://", "mailto://", "//")):
        return False

    # Skip anchor-only links
    if path.startswith("#"):
        return False

    # Skip absolute paths
    return not path.startswith("/")


def find_bare_references(content: str) -> list[str]:
    """Find file/URL references that don't use markdown link syntax.

    These should be flagged as errors - all references should use [text](path).

    Returns list of bare references found.
    """
    # Remove code blocks first to avoid false positives
    content_no_code = remove_code_blocks(content)

    bare_refs = []

    # Pattern 1: Bare backtick paths with file extensions
    # Matches: `modules/foo.md`, `reference/bar.yaml`
    # But not if inside a markdown link (already handled)
    for match in re.finditer(r"`([a-zA-Z0-9_\-./]+\.[a-zA-Z]+)`", content_no_code):
        path = match.group(1)
        # Check this isn't part of a markdown link by looking at context
        start = match.start()
        # If preceded by ]( it's part of a link
        if start >= 2 and content_no_code[start - 2 : start] == "](":
            continue
        # Must have a directory separator to be a path reference
        if "/" in path:
            bare_refs.append(f"`{path}`")

    # Pattern 2: Bare URLs not in markdown links
    # Find all URLs, then exclude those inside markdown links
    url_pattern = r"https?://[^\s\)\]<>]+"
    markdown_link_urls = {path for _, path in extract_markdown_links(content_no_code)}

    for match in re.finditer(url_pattern, content_no_code):
        url = match.group(0)
        if url not in markdown_link_urls:
            # Check it's not inside a markdown link by looking at preceding chars
            start = match.start()
            if (
                start >= 2
                and content_no_code[start - 1] == "("
                and content_no_code[start - 2] == "]"
            ):
                continue
            bare_refs.append(url)

    # Pattern 3: "Read path/to/file" without markdown link
    # Matches: Read modules/foo.md, read reference/bar.md
    # But not: Read [foo](modules/foo.md)
    read_pattern = r"\b[Rr]ead\s+(?!\[)([a-zA-Z0-9_\-./]+\.[a-zA-Z]+)"
    for match in re.finditer(read_pattern, content_no_code):
        path = match.group(1)
        bare_refs.append(f"Read {path}")

    return bare_refs


def extract_skill_references(content: str) -> list[tuple[str, str]]:
    """Extract skill references from SKILL.md content.

    Finds @plugin:skill-name patterns.

    Returns list of (plugin_name, skill_name) tuples.
    """
    references = []

    # Pattern: @plugin-name:skill-name
    # Matches: @pairingbuddy:build-new-feature, @superpowers:committing-changes
    at_pattern = r"@([\w-]+):([\w-]+)"
    for match in re.finditer(at_pattern, content):
        plugin_name = match.group(1)
        skill_name = match.group(2)
        references.append((plugin_name, skill_name))

    return references
