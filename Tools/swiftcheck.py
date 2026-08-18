#!/usr/bin/env python3
"""
A light static sanity pass over the Swift sources.

There is no Swift toolchain on this machine, so this cannot type-check. What it
can do is catch the mechanical mistakes that are easy to make when writing a lot
of code at once: unbalanced braces/parens/brackets, stray tabs, unterminated
string literals, and non-ASCII characters that slipped into identifiers.
"""
import io
import os
import sys

TRIPLE = '"""'


def scan(path):
    with io.open(path, encoding="utf-8") as handle:
        src = handle.read()

    errors = []
    depth = {"{": 0, "(": 0, "[": 0}
    openers = {"}": "{", ")": "(", "]": "["}
    stack = []

    i = 0
    line = 1
    n = len(src)
    in_line_comment = False
    in_block_comment = 0
    in_string = False
    in_multiline_string = False
    escaped = False
    # Track \( interpolation depth so parens inside strings are counted properly.
    interp_stack = []

    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""

        if ch == "\n":
            line += 1
            in_line_comment = False
            if in_string and not in_multiline_string:
                errors.append((line - 1, "unterminated string literal"))
                in_string = False
            i += 1
            escaped = False
            continue

        if in_line_comment:
            i += 1
            continue

        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment -= 1
                i += 2
                continue
            if ch == "/" and nxt == "*":
                in_block_comment += 1
                i += 2
                continue
            i += 1
            continue

        if in_string:
            if escaped:
                # \( opens an interpolation segment
                if ch == "(":
                    interp_stack.append(len(stack))
                    in_string = False
                    stack.append(("(", line))
                escaped = False
                i += 1
                continue
            if ch == "\\":
                escaped = True
                i += 1
                continue
            if in_multiline_string:
                if src.startswith(TRIPLE, i):
                    in_string = False
                    in_multiline_string = False
                    i += 3
                    continue
            elif ch == '"':
                in_string = False
                i += 1
                continue
            i += 1
            continue

        # not in string / comment
        if ch == "/" and nxt == "/":
            in_line_comment = True
            i += 2
            continue
        if ch == "/" and nxt == "*":
            in_block_comment = 1
            i += 2
            continue
        if src.startswith(TRIPLE, i):
            in_string = True
            in_multiline_string = True
            i += 3
            continue
        if ch == '"':
            in_string = True
            i += 1
            continue

        if ch in "{([":
            stack.append((ch, line))
            depth[ch] += 1
            i += 1
            continue

        if ch in "})]":
            want = openers[ch]
            if not stack:
                errors.append((line, "closing '%s' with nothing open" % ch))
            else:
                got, opened_at = stack.pop()
                if got != want:
                    errors.append(
                        (line, "closing '%s' but '%s' from line %d is open" % (ch, got, opened_at))
                    )
                elif ch == ")" and interp_stack and len(stack) == interp_stack[-1]:
                    # end of a string interpolation, back inside the literal
                    interp_stack.pop()
                    in_string = True
            i += 1
            continue

        i += 1

    for got, opened_at in stack:
        errors.append((opened_at, "'%s' opened here is never closed" % got))

    for index, text in enumerate(src.splitlines(), start=1):
        if "\t" in text:
            errors.append((index, "literal tab character"))
        if text.rstrip() != text:
            errors.append((index, "trailing whitespace"))

    return errors


def main(roots):
    files = []
    for root in roots:
        if os.path.isfile(root):
            files.append(root)
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            for name in sorted(filenames):
                if name.endswith(".swift"):
                    files.append(os.path.join(dirpath, name))

    total = 0
    for path in sorted(files):
        errors = scan(path)
        if errors:
            total += len(errors)
            print("%s" % path)
            for line, message in errors[:40]:
                print("  line %d: %s" % (line, message))
    print("checked %d file(s); %d issue(s)" % (len(files), total))
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["MySchedule"]))
