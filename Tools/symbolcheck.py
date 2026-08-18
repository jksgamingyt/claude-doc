#!/usr/bin/env python3
"""
Cross-references the Swift sources without a compiler.

Checks three things a type-checker would normally catch, and which are easy to
get wrong when writing a lot of code in one pass:

  1. Two top-level types with the same name.
  2. A struct conforming to View that also declares a stored property `body`.
  3. A reference to Namespace.member where Namespace is one of ours and the
     member was never declared on it.
"""
import io
import os
import re
import sys

# Namespaces whose members we can enumerate reliably (enums / caseless enums
# and simple structs declared in this project).
TRACKED = [
    "Palette", "TypeScale", "Metrics", "Motion", "Haptics", "Chrome",
    "TimeFormatting", "RelativeFormatting", "DurationFormatting",
    "CalendarRange", "Persistence", "NotificationPlanner",
]

DECL_RE = re.compile(
    r"^(?:public\s+|internal\s+|private\s+|final\s+)*"
    r"(struct|enum|class|actor|protocol)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.M,
)

MEMBER_RE = re.compile(
    r"^\s*(?:@\w+(?:\([^)]*\))?\s+)*"
    r"(?:public\s+|internal\s+|private\s+|fileprivate\s+|static\s+|class\s+|final\s+|lazy\s+|override\s+|discardableResult\s+)*"
    r"(?:static\s+)?(?:let|var|func|case)\s+`?([A-Za-z_][A-Za-z0-9_]*)`?",
    re.M,
)


def read(path):
    with io.open(path, encoding="utf-8") as handle:
        return handle.read()


def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"//[^\n]*", "", src)
    return src


def block_for(src, kind_and_name):
    """Return the source of a top-level declaration body, brace-matched."""
    match = re.search(
        r"^(?:public\s+|internal\s+|private\s+|final\s+)*%s\s+%s\b[^\n{]*\{"
        % kind_and_name,
        src,
        re.M,
    )
    if not match:
        return ""
    start = match.end() - 1
    depth = 0
    for index in range(start, len(src)):
        if src[index] == "{":
            depth += 1
        elif src[index] == "}":
            depth -= 1
            if depth == 0:
                return src[start + 1:index]
    return ""


def main(root):
    files = []
    for dirpath, _dirs, names in os.walk(root):
        for name in sorted(names):
            if name.endswith(".swift"):
                files.append(os.path.join(dirpath, name))

    problems = []

    # --- 1. duplicate type names
    declared = {}
    sources = {}
    for path in files:
        raw = read(path)
        sources[path] = raw
        clean = strip_comments(raw)
        for kind, name in DECL_RE.findall(clean):
            declared.setdefault(name, []).append((path, kind))

    for name, places in sorted(declared.items()):
        if len(places) > 1:
            where = ", ".join("%s (%s)" % (os.path.basename(p), k) for p, k in places)
            problems.append("duplicate type name '%s': %s" % (name, where))

    # --- 2. View structs with a stored `body`
    for path in files:
        clean = strip_comments(sources[path])
        for match in re.finditer(r"^(struct|class)\s+(\w+)[^\n{]*\bView\b[^\n{]*\{", clean, re.M):
            name = match.group(2)
            block = block_for(clean, (match.group(1), name))
            stored = re.search(r"^\s*(?:let|var)\s+body\s*:\s*([A-Za-z_][A-Za-z0-9_]*)", block, re.M)
            if stored and stored.group(1) != "some":
                problems.append(
                    "%s: '%s' conforms to View but declares a stored property named 'body'"
                    % (os.path.basename(path), name)
                )

    # --- 3. Namespace.member references
    members = {}
    for namespace in TRACKED:
        collected = set()
        for path in files:
            clean = strip_comments(sources[path])
            for kind in ("enum", "struct", "final class", "class"):
                block = block_for(clean, (kind.replace("final class", "class"), namespace))
                if block:
                    for name in MEMBER_RE.findall(block):
                        collected.add(name)
            # extensions add members too
            for match in re.finditer(r"^extension\s+%s\b[^\n{]*\{" % namespace, clean, re.M):
                start = match.end() - 1
                depth = 0
                for index in range(start, len(clean)):
                    if clean[index] == "{":
                        depth += 1
                    elif clean[index] == "}":
                        depth -= 1
                        if depth == 0:
                            for name in MEMBER_RE.findall(clean[start + 1:index]):
                                collected.add(name)
                            break
        members[namespace] = collected

    for path in files:
        clean = strip_comments(sources[path])
        for lineno, line in enumerate(clean.splitlines(), start=1):
            for namespace in TRACKED:
                for match in re.finditer(r"\b%s\.([A-Za-z_][A-Za-z0-9_]*)" % namespace, line):
                    member = match.group(1)
                    known = members.get(namespace, set())
                    if not known:
                        continue
                    if member in known or member in ("self", "Type", "init"):
                        continue
                    problems.append(
                        "%s:%d: %s.%s is not declared on %s"
                        % (os.path.basename(path), lineno, namespace, member, namespace)
                    )

    if os.environ.get("SYMBOLCHECK_VERBOSE"):
        for namespace in TRACKED:
            print("%s -> %d member(s)" % (namespace, len(members.get(namespace, set()))))

    for problem in problems:
        print(problem)
    print("checked %d file(s); %d problem(s)" % (len(files), len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "MySchedule"))
