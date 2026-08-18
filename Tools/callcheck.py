#!/usr/bin/env python3
"""
A small type-checker for this project's own symbols, built on the tree-sitter
Swift grammar.

It cannot check SwiftUI or Foundation — but those are not where mistakes hide.
Mistakes hide in *our* call sites: an argument label that drifted, a parameter
that moved, a member that was renamed. That is exactly what this checks.

  1. Every `OurType(...)` call is matched against that type's initialisers —
     explicit ones if it declares any, otherwise the synthesised memberwise
     one, modelling default values, optionals, property wrappers and trailing
     closures the way the compiler does.
  2. Every `OurType.member` reference is checked against that type's members,
     including nested types and enum cases.
  3. Every SwiftUI container is checked against ViewBuilder's ten-child limit,
     which is a compile error and easy to cross in a long view body.

    python3 Tools/callcheck.py MySchedule
"""
import io
import os
import sys

from tree_sitter_language_pack import get_parser

# Wrappers that supply their own storage, so the property never appears as a
# memberwise-init parameter.
SELF_SUPPLYING_WRAPPERS = {
    "State", "StateObject", "ObservedObject", "EnvironmentObject", "Environment",
    "FocusState", "GestureState", "Namespace", "AppStorage", "SceneStorage",
    "Published", "UIApplicationDelegateAdaptor", "FetchRequest", "ScaledMetric",
}

# Members every type gets for free from the protocols used here.
FREE_MEMBERS = {
    "init", "self", "Type", "allCases", "rawValue", "id", "hashValue",
    "description", "debugDescription", "count", "first", "last", "isEmpty",
    "shared", "default",
}

MAX_REPORT = 60

# Containers whose contents go through a ViewBuilder, which accepts at most ten
# direct children.
BUILDER_CONTAINERS = {
    "VStack", "HStack", "ZStack", "Group", "List", "Form", "Section",
    "LazyVStack", "LazyHStack", "LazyVGrid", "LazyHGrid", "ScrollView",
    "NavigationStack", "TabView", "GeometryReader", "Menu", "Picker",
    "ToolbarItem", "ChipFlow", "FlowLayout",
}
BUILDER_LIMIT = 10

# Statement kinds that are not views and so do not count against the limit.
NON_VIEW_STATEMENTS = {"property_declaration", "comment", "multiline_comment", "directive"}


def walk(node):
    stack = [node]
    while stack:
        current = stack.pop()
        yield current
        stack.extend(reversed(current.children))


def text(source, node):
    return source[node.start_byte:node.end_byte].decode("utf-8", "replace")


def child_of_type(node, kind):
    for child in node.children:
        if child.type == kind:
            return child
    return None


class Param(object):
    def __init__(self, label, has_default, origin):
        self.label = label            # None means the call site omits it ("_")
        self.has_default = has_default
        self.origin = origin          # "memberwise" or "init"

    def __repr__(self):
        return "%s%s" % (self.label or "_", "=" if self.has_default else "")


class TypeInfo(object):
    def __init__(self, name, kind, path, line):
        self.name = name
        self.kind = kind              # struct / enum / class / protocol
        self.path = path
        self.line = line
        self.stored = []              # [Param] in declaration order
        self.body_inits = []          # [[Param]] declared inside the body
        self.ext_inits = []           # [[Param]] declared in an extension
        self.members = set()
        self.generic = False

    @property
    def signatures(self):
        """What the compiler would offer, in the order it would offer it."""
        out = []
        if self.body_inits:
            out.extend(self.body_inits)
        elif self.kind in ("struct",):
            out.append(self.stored)
        out.extend(self.ext_inits)
        return out


# --------------------------------------------------------------------------
# Declaration collection
# --------------------------------------------------------------------------


def parse_parameters(source, node):
    """Read a `parameter` list, noting which entries carry a default value."""
    params = []
    children = list(node.children)
    for index, child in enumerate(children):
        if child.type != "parameter":
            continue
        pieces = [c for c in child.children if c.type == "simple_identifier"]
        if not pieces:
            continue
        label = text(source, pieces[0])
        if label == "_":
            label = None
        # A default shows up as `=` immediately after the parameter node.
        has_default = index + 1 < len(children) and children[index + 1].type == "="
        # An optional type without an explicit default is still required in an
        # explicit initialiser, unlike a memberwise one.
        params.append(Param(label, has_default, "init"))
    return params


def property_param(source, node):
    """Turn a property_declaration into a memberwise parameter, or None."""
    body = text(source, node)
    stripped = body.strip()

    if stripped.startswith("static ") or " static " in stripped.split("\n")[0][:40]:
        return None
    if child_of_type(node, "computed_property") is not None:
        return None

    binding = child_of_type(node, "value_binding_pattern")
    if binding is None:
        return None
    is_let = text(source, binding).strip().startswith("let")

    pattern = child_of_type(node, "pattern")
    if pattern is None:
        return None
    name = text(source, pattern).strip()

    modifiers = child_of_type(node, "modifiers")
    wrappers = set()
    if modifiers is not None:
        for attribute in walk(modifiers):
            if attribute.type == "attribute":
                wrappers.add(text(source, attribute).strip().lstrip("@").split("(")[0])
        if "static" in text(source, modifiers):
            return None

    has_assignment = any(c.type == "=" for c in node.children)

    if wrappers & SELF_SUPPLYING_WRAPPERS:
        return None
    if is_let and has_assignment:
        return None

    annotation = child_of_type(node, "type_annotation")
    optional = annotation is not None and text(source, annotation).rstrip().endswith("?")

    has_default = has_assignment or (optional and not is_let)
    return Param(name, has_default, "memberwise")


def collect(root_dir):
    parser = get_parser("swift")
    types = {}
    files = []

    for dirpath, _dirs, names in os.walk(root_dir):
        for name in sorted(names):
            if name.endswith(".swift"):
                files.append(os.path.join(dirpath, name))

    sources = {}
    trees = {}
    for path in sorted(files):
        source = io.open(path, "rb").read()
        sources[path] = source
        trees[path] = parser.parse(source)

    # Pass 1: type declarations
    for path in sorted(files):
        source = sources[path]
        for node in walk(trees[path].root_node):
            if node.type != "class_declaration":
                continue
            keyword = node.children[0].type if node.children else ""
            name_node = child_of_type(node, "type_identifier")
            if name_node is None:
                continue
            name = text(source, name_node)

            info = types.get(name)
            if info is None:
                info = TypeInfo(name, keyword, path, node.start_point[0] + 1)
                types[name] = info

            info.generic = child_of_type(node, "type_parameters") is not None

            body = child_of_type(node, "class_body") or child_of_type(node, "enum_class_body")
            if body is None:
                continue

            for member in body.children:
                if member.type == "property_declaration":
                    pattern = child_of_type(source and member, "pattern")
                    if pattern is not None:
                        info.members.add(text(source, pattern).strip())
                    param = property_param(source, member)
                    if param is not None:
                        info.stored.append(param)
                elif member.type == "function_declaration":
                    ident = child_of_type(member, "simple_identifier")
                    if ident is not None:
                        info.members.add(text(source, ident))
                elif member.type == "init_declaration":
                    info.body_inits.append(parse_parameters(source, member))
                elif member.type == "enum_entry":
                    for ident in member.children:
                        if ident.type == "simple_identifier":
                            info.members.add(text(source, ident))
                elif member.type == "class_declaration":
                    nested = child_of_type(member, "type_identifier")
                    if nested is not None:
                        info.members.add(text(source, nested))
                elif member.type == "typealias_declaration":
                    ident = child_of_type(member, "type_identifier")
                    if ident is not None:
                        info.members.add(text(source, ident))

    # Pass 2: extensions
    for path in sorted(files):
        source = sources[path]
        for node in walk(trees[path].root_node):
            if node.type != "class_declaration":
                continue
            if not node.children or node.children[0].type != "extension":
                continue
            name_node = child_of_type(node, "user_type") or child_of_type(node, "type_identifier")
            if name_node is None:
                continue
            name = text(source, name_node).split("<")[0].split(".")[0].strip()
            info = types.get(name)
            if info is None:
                continue
            body = child_of_type(node, "class_body") or child_of_type(node, "enum_class_body")
            if body is None:
                continue
            for member in body.children:
                if member.type == "init_declaration":
                    info.ext_inits.append(parse_parameters(source, member))
                elif member.type == "property_declaration":
                    pattern = child_of_type(member, "pattern")
                    if pattern is not None:
                        info.members.add(text(source, pattern).strip())
                elif member.type == "function_declaration":
                    ident = child_of_type(member, "simple_identifier")
                    if ident is not None:
                        info.members.add(text(source, ident))
                elif member.type == "enum_entry":
                    for ident in member.children:
                        if ident.type == "simple_identifier":
                            info.members.add(text(source, ident))

    return types, sources, trees, files


# --------------------------------------------------------------------------
# Call-site checking
# --------------------------------------------------------------------------


def call_arguments(source, call):
    """Argument labels in order, plus whether a trailing closure is present."""
    suffix = child_of_type(call, "call_suffix")
    if suffix is None:
        return None, False

    labels = []
    args = child_of_type(suffix, "value_arguments")
    if args is not None:
        for child in args.children:
            if child.type != "value_argument":
                continue
            label_node = child_of_type(child, "value_argument_label")
            labels.append(text(source, label_node).strip() if label_node is not None else None)

    trailing = any(c.type == "lambda_literal" for c in suffix.children)
    return labels, trailing


def match(params, labels, trailing):
    """Mimic the compiler's argument matching. Returns an error string or None."""
    params = list(params)

    if trailing:
        if not params:
            return "extra trailing closure: this type takes no arguments"
        # A single trailing closure fills the final parameter.
        params = params[:-1]

    index = 0
    for label in labels:
        placed = False
        while index < len(params):
            param = params[index]
            if param.label == label or (label is None and param.label is None):
                index += 1
                placed = True
                break
            if param.has_default:
                index += 1
                continue
            return "argument '%s' cannot be matched; parameter '%s' is required and comes first" % (
                label or "_", param.label or "_",
            )
        if not placed:
            return "unexpected argument '%s'" % (label or "_")

    for param in params[index:]:
        if not param.has_default:
            return "missing argument for required parameter '%s'" % (param.label or "_")

    return None


def check_calls(types, sources, trees, files):
    problems = []

    for path in sorted(files):
        source = sources[path]
        for node in walk(trees[path].root_node):
            if node.type != "call_expression":
                continue
            callee = node.children[0] if node.children else None
            if callee is None or callee.type != "simple_identifier":
                continue
            name = text(source, callee)
            info = types.get(name)
            if info is None:
                continue
            if info.kind == "protocol":
                continue
            if info.kind == "enum" and not info.body_inits and not info.ext_inits:
                continue  # enums without explicit inits are not constructed this way
            if info.kind == "class" and not info.body_inits and not info.ext_inits:
                continue

            labels, trailing = call_arguments(source, node)
            if labels is None:
                continue

            signatures = info.signatures
            if not signatures:
                continue

            errors = [match(sig, labels, trailing) for sig in signatures]
            if any(error is None for error in errors):
                continue

            call_text = " ".join(text(source, node)[:90].split())
            problems.append(
                "%s:%d: %s(...) — %s\n      call: %s\n      init: %s"
                % (
                    os.path.basename(path),
                    node.start_point[0] + 1,
                    name,
                    errors[0],
                    call_text,
                    " | ".join(
                        "(" + ", ".join(repr(p) for p in sig) + ")" for sig in signatures
                    ),
                )
            )

    return problems


def check_members(types, sources, trees, files):
    problems = []
    known = set(types)

    for path in sorted(files):
        source = sources[path]
        for node in walk(trees[path].root_node):
            if node.type != "navigation_expression":
                continue
            base = node.children[0] if node.children else None
            if base is None or base.type != "simple_identifier":
                continue
            base_name = text(source, base)
            if base_name not in known:
                continue
            info = types[base_name]

            suffix = child_of_type(node, "navigation_suffix")
            if suffix is None:
                continue
            ident = child_of_type(suffix, "simple_identifier")
            if ident is None:
                continue
            member = text(source, ident)

            if member in info.members or member in FREE_MEMBERS:
                continue

            problems.append(
                "%s:%d: %s.%s is not a member of %s (%s)"
                % (
                    os.path.basename(path),
                    node.start_point[0] + 1,
                    base_name,
                    member,
                    base_name,
                    info.kind,
                )
            )

    return problems


def check_builder_arity(sources, trees, files):
    problems = []

    for path in sorted(files):
        source = sources[path]
        for node in walk(trees[path].root_node):
            if node.type != "call_expression" or not node.children:
                continue
            callee = node.children[0]
            if callee.type != "simple_identifier":
                continue
            name = text(source, callee)
            if name not in BUILDER_CONTAINERS:
                continue

            suffix = child_of_type(node, "call_suffix")
            if suffix is None:
                continue

            for lam in suffix.children:
                if lam.type != "lambda_literal":
                    continue
                for block in lam.children:
                    if block.type != "statements":
                        continue
                    children = [
                        child for child in block.children
                        if child.type not in NON_VIEW_STATEMENTS
                    ]
                    if len(children) > BUILDER_LIMIT:
                        problems.append(
                            "%s:%d: %s has %d direct children; ViewBuilder accepts %d"
                            % (
                                os.path.basename(path),
                                node.start_point[0] + 1,
                                name,
                                len(children),
                                BUILDER_LIMIT,
                            )
                        )

    return problems


def main(root):
    types, sources, trees, files = collect(root)

    problems = check_calls(types, sources, trees, files)
    problems += check_members(types, sources, trees, files)
    problems += check_builder_arity(sources, trees, files)

    for problem in problems[:MAX_REPORT]:
        print(problem)
    if len(problems) > MAX_REPORT:
        print("... and %d more" % (len(problems) - MAX_REPORT))

    print(
        "checked %d file(s), %d project type(s); %d problem(s)"
        % (len(files), len(types), len(problems))
    )
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "MySchedule"))
