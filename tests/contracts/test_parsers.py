"""Tests for the parsers module."""

from tests.contracts.parsers import (
    extract_file_references,
    extract_markdown_links,
    extract_skill_references,
    find_bare_references,
    remove_code_blocks,
)


class TestRemoveCodeBlocks:
    """Tests for remove_code_blocks function."""

    def test_removes_fenced_code_blocks(self):
        content = """
Some text before.

```python
code inside
```

Some text after.
"""
        result = remove_code_blocks(content)
        assert "code inside" not in result
        assert "Some text before" in result
        assert "Some text after" in result

    def test_removes_indented_code_blocks(self):
        content = """
Some text.

    indented code block
    more indented code

Back to normal.
"""
        result = remove_code_blocks(content)
        assert "indented code block" not in result
        assert "Some text" in result
        assert "Back to normal" in result

    def test_preserves_non_code_content(self):
        content = "Just regular text with no code blocks."
        result = remove_code_blocks(content)
        assert result == content


class TestExtractMarkdownLinks:
    """Tests for extract_markdown_links function."""

    def test_extracts_simple_link(self):
        content = "See [foo](path/to/foo.md) for details."
        links = extract_markdown_links(content)
        assert ("foo", "path/to/foo.md") in links

    def test_extracts_multiple_links(self):
        content = "Read [a](a.md) and [b](b.md)."
        links = extract_markdown_links(content)
        assert len(links) == 2
        assert ("a", "a.md") in links
        assert ("b", "b.md") in links

    def test_extracts_url_links(self):
        content = "Visit [example](https://example.com)."
        links = extract_markdown_links(content)
        assert ("example", "https://example.com") in links

    def test_handles_empty_text(self):
        content = "Link with [](empty.md) empty text."
        links = extract_markdown_links(content)
        assert ("", "empty.md") in links


class TestExtractFileReferences:
    """Tests for extract_file_references function."""

    def test_extracts_local_file_paths(self):
        content = "Read [phase-red](modules/phase-red.md)."
        refs = extract_file_references(content)
        assert "modules/phase-red.md" in refs

    def test_excludes_urls(self):
        content = "See [docs](https://example.com/docs)."
        refs = extract_file_references(content)
        assert len(refs) == 0

    def test_excludes_anchor_links(self):
        content = "Jump to [section](#my-section)."
        refs = extract_file_references(content)
        assert len(refs) == 0

    def test_excludes_absolute_paths(self):
        content = "See [root](/absolute/path.md)."
        refs = extract_file_references(content)
        assert len(refs) == 0

    def test_returns_sorted_unique_paths(self):
        content = """
[z](z.md)
[a](a.md)
[z](z.md)
"""
        refs = extract_file_references(content)
        assert refs == ["a.md", "z.md"]


class TestFindBareReferences:
    """Tests for find_bare_references function."""

    def test_finds_bare_backtick_paths(self):
        content = "Check `modules/foo.md` for details."
        refs = find_bare_references(content)
        assert "`modules/foo.md`" in refs

    def test_finds_bare_urls(self):
        content = "See https://example.com for info."
        refs = find_bare_references(content)
        assert "https://example.com" in refs

    def test_finds_read_without_link(self):
        content = "Read modules/phase-red.md for details."
        refs = find_bare_references(content)
        assert "Read modules/phase-red.md" in refs

    def test_ignores_backtick_paths_without_directory(self):
        content = "Use `filename.md` directly."
        refs = find_bare_references(content)
        assert len(refs) == 0

    def test_ignores_content_in_code_blocks(self):
        content = """
```
Read modules/in-code-block.md
`modules/also-in-code.md`
```
"""
        refs = find_bare_references(content)
        assert len(refs) == 0

    def test_ignores_urls_in_markdown_links(self):
        content = "Visit [example](https://example.com)."
        refs = find_bare_references(content)
        assert len(refs) == 0

    def test_ignores_paths_in_markdown_links(self):
        content = "Read [phase-red](modules/phase-red.md)."
        refs = find_bare_references(content)
        # Should not flag the path inside the markdown link
        assert "`modules/phase-red.md`" not in refs

    def test_read_with_markdown_link_is_valid(self):
        content = "Read [phase-red](modules/phase-red.md) for details."
        refs = find_bare_references(content)
        assert len(refs) == 0


class TestExtractSkillReferences:
    """Tests for extract_skill_references function."""

    def test_extracts_skill_reference(self):
        content = "Use @pairingbuddy:build-new-feature for this."
        refs = extract_skill_references(content)
        assert ("pairingbuddy", "build-new-feature") in refs

    def test_extracts_multiple_references(self):
        content = """
Follow @pairingbuddy:test-driven-development.
Then use @superpowers:committing-changes.
"""
        refs = extract_skill_references(content)
        assert len(refs) == 2
        assert ("pairingbuddy", "test-driven-development") in refs
        assert ("superpowers", "committing-changes") in refs

    def test_extracts_reference_with_hyphens(self):
        content = "Use @my-plugin:my-skill-name for details."
        refs = extract_skill_references(content)
        assert ("my-plugin", "my-skill-name") in refs

    def test_ignores_email_addresses(self):
        content = "Contact user@example.com for help."
        refs = extract_skill_references(content)
        # email doesn't match @plugin:skill pattern
        assert len(refs) == 0

    def test_returns_empty_for_no_references(self):
        content = "No skill references here."
        refs = extract_skill_references(content)
        assert len(refs) == 0
