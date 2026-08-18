#!/usr/bin/env python3
"""
Validates the generated pbxproj without Xcode.

Checks: balanced braces/parens, that every object referenced by ID is also
defined as an object, that no object is defined twice, and that the file
declares the sections Xcode requires to open a project.
"""
import io
import re
import sys

REQUIRED = [
    "PBXBuildFile", "PBXFileReference", "PBXFrameworksBuildPhase", "PBXGroup",
    "PBXNativeTarget", "PBXProject", "PBXResourcesBuildPhase",
    "PBXSourcesBuildPhase", "XCBuildConfiguration", "XCConfigurationList",
]

ID_RE = re.compile(r"\b([0-9A-F]{24})\b")
DEF_RE = re.compile(r"^\t\t([0-9A-F]{24})\b[^=]*= \{", re.M)


def main(path):
    src = io.open(path, encoding="utf-8").read()
    problems = []

    for char, closer in (("{", "}"), ("(", ")")):
        if src.count(char) != src.count(closer):
            problems.append(
                "unbalanced %s%s: %d open, %d close"
                % (char, closer, src.count(char), src.count(closer))
            )

    defined = DEF_RE.findall(src)
    seen = set()
    for identifier in defined:
        if identifier in seen:
            problems.append("object %s defined more than once" % identifier)
        seen.add(identifier)

    referenced = set(ID_RE.findall(src))
    for identifier in sorted(referenced - seen):
        problems.append("object %s is referenced but never defined" % identifier)

    for section in REQUIRED:
        if "/* Begin %s section */" % section not in src:
            problems.append("missing section: %s" % section)
        if "/* End %s section */" % section not in src:
            problems.append("missing end marker: %s" % section)

    if not src.startswith("// !$*UTF8*$!"):
        problems.append("missing the UTF8 header comment Xcode expects")
    if "rootObject = " not in src:
        problems.append("no rootObject")

    for problem in problems:
        print(problem)
    print("%d object(s) defined, %d referenced; %d problem(s)"
          % (len(seen), len(referenced), len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "MySchedule.xcodeproj/project.pbxproj"))
