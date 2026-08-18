#!/usr/bin/env python3
"""
Parses every Swift file with the tree-sitter Swift grammar and reports any
ERROR or MISSING node.

This is a real parser, not a brace counter, so it catches genuine syntax
errors — malformed generics, a stray closure, a mis-nested declaration.
It does not type-check; see calls.py for that side of it.

    python3 -m pip install tree-sitter tree-sitter-language-pack
    python3 Tools/parsecheck.py MySchedule
"""
import io
import os
import sys

from tree_sitter_language_pack import get_parser


def walk(node):
    stack = [node]
    while stack:
        current = stack.pop()
        yield current
        stack.extend(reversed(current.children))


def main(root):
    parser = get_parser("swift")

    files = []
    for dirpath, _dirs, names in os.walk(root):
        for name in sorted(names):
            if name.endswith(".swift"):
                files.append(os.path.join(dirpath, name))

    total = 0
    for path in sorted(files):
        source = io.open(path, "rb").read()
        tree = parser.parse(source)
        if not tree.root_node.has_error:
            continue

        problems = []
        for node in walk(tree.root_node):
            if node.type == "ERROR" or node.is_missing:
                line = node.start_point[0] + 1
                snippet = source[node.start_byte:node.end_byte][:110].decode("utf-8", "replace")
                snippet = " ".join(snippet.split())
                kind = "MISSING" if node.is_missing else "ERROR"
                problems.append((line, kind, snippet))

        # An ERROR node often contains more ERROR nodes; the outermost is enough.
        seen_lines = set()
        trimmed = []
        for line, kind, snippet in sorted(problems):
            if line in seen_lines:
                continue
            seen_lines.add(line)
            trimmed.append((line, kind, snippet))

        print(path)
        for line, kind, snippet in trimmed[:15]:
            print("  line %d: %s  %s" % (line, kind, snippet))
        total += len(trimmed)

    print("parsed %d file(s); %d syntax problem(s)" % (len(files), total))
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "MySchedule"))
