"""Markdown parsing utilities using tree-sitter."""

import tree_sitter_markdown as tsmd
from tree_sitter import Language, Parser

_parser = Parser(Language(tsmd.language()))


def extract_headings(content: str) -> list[dict]:
    """Extract all headings from markdown content in document order.

    Returns:
        List of dicts with 'level' (int), 'text' (str), and 'line' (int) keys.
        Example: [{'level': 2, 'text': 'Workflow Rules', 'line': 5}, ...]
    """
    tree = _parser.parse(content.encode())
    headings = []

    def visit(node):
        if node.type == "atx_heading":
            level = None
            text = None
            for child in node.children:
                if child.type.startswith("atx_h") and child.type.endswith("_marker"):
                    level = len(child.text)  # count the # characters
                elif child.type == "inline":
                    text = child.text.decode().strip()
            if level and text:
                headings.append(
                    {
                        "level": level,
                        "text": text,
                        "line": node.start_point[0] + 1,  # 1-indexed line number
                    }
                )
        for child in node.children:
            visit(child)

    visit(tree.root_node)
    return headings
