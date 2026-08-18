#!/usr/bin/env python3
"""
Generates MySchedule.xcodeproj from whatever is currently in MySchedule/.

Written as a generator rather than a hand-edited file so that adding a Swift
file is a matter of re-running this, not surgery on a 400-line pbxproj. Object
IDs are derived from a hash of the path, so regenerating produces the same file
and git diffs stay readable.

Targets objectVersion 56 (Xcode 14 and later) deliberately: the newer
file-system-synchronised group format is tidier but only opens in Xcode 16+.

    python3 Tools/generate_xcodeproj.py
"""
import hashlib
import io
import os
import sys

PROJECT_NAME = "MySchedule"
SOURCE_DIR = "MySchedule"
BUNDLE_ID = "com.myschedule.MySchedule"
DEPLOYMENT_TARGET = "17.0"
SWIFT_VERSION = "5.0"
MARKETING_VERSION = "1.0"
XCODE_STAMP = "1600"

RESOURCE_DIRS = {"Assets.xcassets"}


def oid(kind, key):
    """A stable 24-character hex object identifier."""
    digest = hashlib.md5(("%s\x00%s" % (kind, key)).encode("utf-8")).hexdigest()
    return digest[:24].upper()


class Node(object):
    """A directory in the source tree, mirrored as a PBXGroup."""

    def __init__(self, name, relpath):
        self.name = name
        self.relpath = relpath
        self.dirs = []
        self.files = []


def scan(root):
    """Walk the source tree, treating asset catalogues as single leaves."""
    node = Node(os.path.basename(root), root)
    for entry in sorted(os.listdir(root)):
        if entry.startswith("."):
            continue
        full = os.path.join(root, entry)
        if os.path.isdir(full):
            if entry in RESOURCE_DIRS:
                node.files.append((entry, full))
            else:
                node.dirs.append(scan(full))
        elif entry.endswith(".swift"):
            node.files.append((entry, full))
    return node


def file_type(name):
    if name.endswith(".swift"):
        return "sourcecode.swift"
    if name.endswith(".xcassets"):
        return "folder.assetcatalog"
    if name.endswith(".plist"):
        return "text.plist.xml"
    return "text"


def collect(node, sources, resources, groups):
    groups.append(node)
    for name, path in node.files:
        if name.endswith(".swift"):
            sources.append((name, path))
        else:
            resources.append((name, path))
    for child in node.dirs:
        collect(child, sources, resources, groups)


def build():
    tree = scan(SOURCE_DIR)

    sources = []
    resources = []
    groups = []
    collect(tree, sources, resources, groups)

    if not sources:
        sys.exit("no Swift sources found under %s/" % SOURCE_DIR)

    # --- identifiers
    ids = {
        "project": oid("project", PROJECT_NAME),
        "target": oid("target", PROJECT_NAME),
        "product": oid("product", PROJECT_NAME),
        "productGroup": oid("group", "Products"),
        "mainGroup": oid("group", "__root__"),
        "sourcesPhase": oid("phase", "sources"),
        "resourcesPhase": oid("phase", "resources"),
        "frameworksPhase": oid("phase", "frameworks"),
        "projectConfigList": oid("configlist", "project"),
        "targetConfigList": oid("configlist", "target"),
        "projectDebug": oid("config", "project.debug"),
        "projectRelease": oid("config", "project.release"),
        "targetDebug": oid("config", "target.debug"),
        "targetRelease": oid("config", "target.release"),
    }

    out = []
    add = out.append

    add("// !$*UTF8*$!")
    add("{")
    add("\tarchiveVersion = 1;")
    add("\tclasses = {")
    add("\t};")
    add("\tobjectVersion = 56;")
    add("\tobjects = {")
    add("")

    # --- PBXBuildFile
    add("/* Begin PBXBuildFile section */")
    for name, path in sources + resources:
        add(
            "\t\t%s /* %s in %s */ = {isa = PBXBuildFile; fileRef = %s /* %s */; };"
            % (
                oid("buildfile", path),
                name,
                "Sources" if name.endswith(".swift") else "Resources",
                oid("fileref", path),
                name,
            )
        )
    add("/* End PBXBuildFile section */")
    add("")

    # --- PBXFileReference
    add("/* Begin PBXFileReference section */")
    add(
        "\t\t%s /* %s.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; "
        "includeInIndex = 0; path = %s.app; sourceTree = BUILT_PRODUCTS_DIR; };"
        % (ids["product"], PROJECT_NAME, PROJECT_NAME)
    )
    for name, path in sorted(sources + resources, key=lambda pair: pair[1]):
        add(
            "\t\t%s /* %s */ = {isa = PBXFileReference; lastKnownFileType = %s; path = %s; sourceTree = \"<group>\"; };"
            % (oid("fileref", path), name, file_type(name), name)
        )
    add("/* End PBXFileReference section */")
    add("")

    # --- PBXFrameworksBuildPhase
    add("/* Begin PBXFrameworksBuildPhase section */")
    add("\t\t%s /* Frameworks */ = {" % ids["frameworksPhase"])
    add("\t\t\tisa = PBXFrameworksBuildPhase;")
    add("\t\t\tbuildActionMask = 2147483647;")
    add("\t\t\tfiles = (")
    add("\t\t\t);")
    add("\t\t\trunOnlyForDeploymentPostprocessing = 0;")
    add("\t\t};")
    add("/* End PBXFrameworksBuildPhase section */")
    add("")

    # --- PBXGroup
    add("/* Begin PBXGroup section */")

    add("\t\t%s = {" % ids["mainGroup"])
    add("\t\t\tisa = PBXGroup;")
    add("\t\t\tchildren = (")
    add("\t\t\t\t%s /* %s */," % (oid("group", tree.relpath), PROJECT_NAME))
    add("\t\t\t\t%s /* Products */," % ids["productGroup"])
    add("\t\t\t);")
    add("\t\t\tsourceTree = \"<group>\";")
    add("\t\t};")

    add("\t\t%s /* Products */ = {" % ids["productGroup"])
    add("\t\t\tisa = PBXGroup;")
    add("\t\t\tchildren = (")
    add("\t\t\t\t%s /* %s.app */," % (ids["product"], PROJECT_NAME))
    add("\t\t\t);")
    add("\t\t\tname = Products;")
    add("\t\t\tsourceTree = \"<group>\";")
    add("\t\t};")

    for node in groups:
        add("\t\t%s /* %s */ = {" % (oid("group", node.relpath), node.name))
        add("\t\t\tisa = PBXGroup;")
        add("\t\t\tchildren = (")
        for child in node.dirs:
            add("\t\t\t\t%s /* %s */," % (oid("group", child.relpath), child.name))
        for name, path in node.files:
            add("\t\t\t\t%s /* %s */," % (oid("fileref", path), name))
        add("\t\t\t);")
        add("\t\t\tpath = %s;" % node.name)
        add("\t\t\tsourceTree = \"<group>\";")
        add("\t\t};")

    add("/* End PBXGroup section */")
    add("")

    # --- PBXNativeTarget
    add("/* Begin PBXNativeTarget section */")
    add("\t\t%s /* %s */ = {" % (ids["target"], PROJECT_NAME))
    add("\t\t\tisa = PBXNativeTarget;")
    add(
        "\t\t\tbuildConfigurationList = %s /* Build configuration list for PBXNativeTarget \"%s\" */;"
        % (ids["targetConfigList"], PROJECT_NAME)
    )
    add("\t\t\tbuildPhases = (")
    add("\t\t\t\t%s /* Sources */," % ids["sourcesPhase"])
    add("\t\t\t\t%s /* Frameworks */," % ids["frameworksPhase"])
    add("\t\t\t\t%s /* Resources */," % ids["resourcesPhase"])
    add("\t\t\t);")
    add("\t\t\tbuildRules = (")
    add("\t\t\t);")
    add("\t\t\tdependencies = (")
    add("\t\t\t);")
    add("\t\t\tname = %s;" % PROJECT_NAME)
    add("\t\t\tproductName = %s;" % PROJECT_NAME)
    add("\t\t\tproductReference = %s /* %s.app */;" % (ids["product"], PROJECT_NAME))
    add("\t\t\tproductType = \"com.apple.product-type.application\";")
    add("\t\t};")
    add("/* End PBXNativeTarget section */")
    add("")

    # --- PBXProject
    add("/* Begin PBXProject section */")
    add("\t\t%s /* Project object */ = {" % ids["project"])
    add("\t\t\tisa = PBXProject;")
    add("\t\t\tattributes = {")
    add("\t\t\t\tBuildIndependentTargetsInParallel = 1;")
    add("\t\t\t\tLastSwiftUpdateCheck = %s;" % XCODE_STAMP)
    add("\t\t\t\tLastUpgradeCheck = %s;" % XCODE_STAMP)
    add("\t\t\t\tTargetAttributes = {")
    add("\t\t\t\t\t%s = {" % ids["target"])
    add("\t\t\t\t\t\tCreatedOnToolsVersion = 16.0;")
    add("\t\t\t\t\t};")
    add("\t\t\t\t};")
    add("\t\t\t};")
    add(
        "\t\t\tbuildConfigurationList = %s /* Build configuration list for PBXProject \"%s\" */;"
        % (ids["projectConfigList"], PROJECT_NAME)
    )
    add("\t\t\tcompatibilityVersion = \"Xcode 14.0\";")
    add("\t\t\tdevelopmentRegion = en;")
    add("\t\t\thasScannedForEncodings = 0;")
    add("\t\t\tknownRegions = (")
    add("\t\t\t\ten,")
    add("\t\t\t\tBase,")
    add("\t\t\t);")
    add("\t\t\tmainGroup = %s;" % ids["mainGroup"])
    add("\t\t\tproductRefGroup = %s /* Products */;" % ids["productGroup"])
    add("\t\t\tprojectDirPath = \"\";")
    add("\t\t\tprojectRoot = \"\";")
    add("\t\t\ttargets = (")
    add("\t\t\t\t%s /* %s */," % (ids["target"], PROJECT_NAME))
    add("\t\t\t);")
    add("\t\t};")
    add("/* End PBXProject section */")
    add("")

    # --- PBXResourcesBuildPhase
    add("/* Begin PBXResourcesBuildPhase section */")
    add("\t\t%s /* Resources */ = {" % ids["resourcesPhase"])
    add("\t\t\tisa = PBXResourcesBuildPhase;")
    add("\t\t\tbuildActionMask = 2147483647;")
    add("\t\t\tfiles = (")
    for name, path in resources:
        add("\t\t\t\t%s /* %s in Resources */," % (oid("buildfile", path), name))
    add("\t\t\t);")
    add("\t\t\trunOnlyForDeploymentPostprocessing = 0;")
    add("\t\t};")
    add("/* End PBXResourcesBuildPhase section */")
    add("")

    # --- PBXSourcesBuildPhase
    add("/* Begin PBXSourcesBuildPhase section */")
    add("\t\t%s /* Sources */ = {" % ids["sourcesPhase"])
    add("\t\t\tisa = PBXSourcesBuildPhase;")
    add("\t\t\tbuildActionMask = 2147483647;")
    add("\t\t\tfiles = (")
    for name, path in sources:
        add("\t\t\t\t%s /* %s in Sources */," % (oid("buildfile", path), name))
    add("\t\t\t);")
    add("\t\t\trunOnlyForDeploymentPostprocessing = 0;")
    add("\t\t};")
    add("/* End PBXSourcesBuildPhase section */")
    add("")

    # --- XCBuildConfiguration
    add("/* Begin XCBuildConfiguration section */")
    add(project_config(ids["projectDebug"], "Debug"))
    add(project_config(ids["projectRelease"], "Release"))
    add(target_config(ids["targetDebug"], "Debug"))
    add(target_config(ids["targetRelease"], "Release"))
    add("/* End XCBuildConfiguration section */")
    add("")

    # --- XCConfigurationList
    add("/* Begin XCConfigurationList section */")
    add(
        config_list(
            ids["projectConfigList"],
            "PBXProject \\\"%s\\\"" % PROJECT_NAME,
            ids["projectDebug"],
            ids["projectRelease"],
        )
    )
    add(
        config_list(
            ids["targetConfigList"],
            "PBXNativeTarget \\\"%s\\\"" % PROJECT_NAME,
            ids["targetDebug"],
            ids["targetRelease"],
        )
    )
    add("/* End XCConfigurationList section */")
    add("")

    add("\t};")
    add("\trootObject = %s /* Project object */;" % ids["project"])
    add("}")

    return "\n".join(out) + "\n", ids, len(sources), len(resources)


def settings_block(pairs, indent="\t\t\t\t"):
    lines = []
    for key, value in pairs:
        lines.append("%s%s = %s;" % (indent, key, value))
    return lines


def project_config(identifier, name):
    debug = name == "Debug"
    pairs = [
        ("ALWAYS_SEARCH_USER_PATHS", "NO"),
        ("ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOL_FRAMEWORKS", "SwiftUI"),
        ("ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOL_EXTENSIONS", "YES"),
        ("CLANG_ANALYZER_NONNULL", "YES"),
        ("CLANG_ANALYZER_NUMBER_OBJECT_CONVERSION", "YES_AGGRESSIVE"),
        ("CLANG_CXX_LANGUAGE_STANDARD", '"gnu++20"'),
        ("CLANG_ENABLE_MODULES", "YES"),
        ("CLANG_ENABLE_OBJC_ARC", "YES"),
        ("CLANG_ENABLE_OBJC_WEAK", "YES"),
        ("CLANG_WARN_BLOCK_CAPTURE_AUTORELEASING", "YES"),
        ("CLANG_WARN_BOOL_CONVERSION", "YES"),
        ("CLANG_WARN_COMMA", "YES"),
        ("CLANG_WARN_CONSTANT_CONVERSION", "YES"),
        ("CLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS", "YES"),
        ("CLANG_WARN_DIRECT_OBJC_ISA_USAGE", "YES_ERROR"),
        ("CLANG_WARN_DOCUMENTATION_COMMENTS", "YES"),
        ("CLANG_WARN_EMPTY_BODY", "YES"),
        ("CLANG_WARN_ENUM_CONVERSION", "YES"),
        ("CLANG_WARN_INFINITE_RECURSION", "YES"),
        ("CLANG_WARN_INT_CONVERSION", "YES"),
        ("CLANG_WARN_NON_LITERAL_NULL_CONVERSION", "YES"),
        ("CLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF", "YES"),
        ("CLANG_WARN_OBJC_LITERAL_CONVERSION", "YES"),
        ("CLANG_WARN_OBJC_ROOT_CLASS", "YES_ERROR"),
        ("CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER", "YES"),
        ("CLANG_WARN_RANGE_LOOP_ANALYSIS", "YES"),
        ("CLANG_WARN_STRICT_PROTOTYPES", "YES"),
        ("CLANG_WARN_SUSPICIOUS_MOVE", "YES"),
        ("CLANG_WARN_UNGUARDED_AVAILABILITY", "YES_AGGRESSIVE"),
        ("CLANG_WARN_UNREACHABLE_CODE", "YES"),
        ("CLANG_WARN__DUPLICATE_METHOD_MATCH", "YES"),
        ("COPY_PHASE_STRIP", "NO"),
        ("ENABLE_STRICT_OBJC_MSGSEND", "YES"),
        ("ENABLE_USER_SCRIPT_SANDBOXING", "YES"),
        ("GCC_C_LANGUAGE_STANDARD", "gnu17"),
        ("GCC_NO_COMMON_BLOCKS", "YES"),
        ("GCC_WARN_64_TO_32_BIT_CONVERSION", "YES"),
        ("GCC_WARN_ABOUT_RETURN_TYPE", "YES_ERROR"),
        ("GCC_WARN_UNDECLARED_SELECTOR", "YES"),
        ("GCC_WARN_UNINITIALIZED_AUTOS", "YES_AGGRESSIVE"),
        ("GCC_WARN_UNUSED_FUNCTION", "YES"),
        ("GCC_WARN_UNUSED_VARIABLE", "YES"),
        ("IPHONEOS_DEPLOYMENT_TARGET", DEPLOYMENT_TARGET),
        ("LOCALIZATION_PREFERS_STRING_CATALOGS", "YES"),
        ("MTL_FAST_MATH", "YES"),
        ("SDKROOT", "iphoneos"),
        ("SWIFT_STRICT_CONCURRENCY", "minimal"),
    ]

    if debug:
        pairs += [
            ("DEBUG_INFORMATION_FORMAT", "dwarf"),
            ("ENABLE_TESTABILITY", "YES"),
            ("GCC_DYNAMIC_NO_PIC", "NO"),
            ("GCC_OPTIMIZATION_LEVEL", "0"),
            ("GCC_PREPROCESSOR_DEFINITIONS", '(\n\t\t\t\t\t"DEBUG=1",\n\t\t\t\t\t"$(inherited)",\n\t\t\t\t)'),
            ("MTL_ENABLE_DEBUG_INFO", "INCLUDE_SOURCE"),
            ("ONLY_ACTIVE_ARCH", "YES"),
            ("SWIFT_ACTIVE_COMPILATION_CONDITIONS", '"DEBUG $(inherited)"'),
            ("SWIFT_OPTIMIZATION_LEVEL", '"-Onone"'),
        ]
    else:
        pairs += [
            ("DEBUG_INFORMATION_FORMAT", '"dwarf-with-dsym"'),
            ("ENABLE_NS_ASSERTIONS", "NO"),
            ("MTL_ENABLE_DEBUG_INFO", "NO"),
            ("SWIFT_COMPILATION_MODE", "wholemodule"),
            ("VALIDATE_PRODUCT", "YES"),
        ]

    pairs.sort(key=lambda pair: pair[0])

    lines = ["\t\t%s /* %s */ = {" % (identifier, name), "\t\t\tisa = XCBuildConfiguration;", "\t\t\tbuildSettings = {"]
    lines += settings_block(pairs)
    lines += ["\t\t\t};", "\t\t\tname = %s;" % name, "\t\t};"]
    return "\n".join(lines)


def target_config(identifier, name):
    orientations_ipad = (
        '"UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown '
        'UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"'
    )
    pairs = [
        ("ASSETCATALOG_COMPILER_APPICON_NAME", "AppIcon"),
        ("ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME", "AccentColor"),
        ("CODE_SIGN_STYLE", "Automatic"),
        ("CURRENT_PROJECT_VERSION", "1"),
        ("ENABLE_PREVIEWS", "YES"),
        ("GENERATE_INFOPLIST_FILE", "YES"),
        ("INFOPLIST_KEY_UIApplicationSceneManifest_Generation", "YES"),
        ("INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents", "YES"),
        ("INFOPLIST_KEY_UILaunchScreen_Generation", "YES"),
        ("INFOPLIST_KEY_UIStatusBarStyle", "UIStatusBarStyleDefault"),
        ("INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad", orientations_ipad),
        ("INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone", '"UIInterfaceOrientationPortrait"'),
        ("INFOPLIST_KEY_CFBundleDisplayName", "MySchedule"),
        ("IPHONEOS_DEPLOYMENT_TARGET", DEPLOYMENT_TARGET),
        (
            "LD_RUNPATH_SEARCH_PATHS",
            '(\n\t\t\t\t\t"$(inherited)",\n\t\t\t\t\t"@executable_path/Frameworks",\n\t\t\t\t)',
        ),
        ("MARKETING_VERSION", MARKETING_VERSION),
        ("PRODUCT_BUNDLE_IDENTIFIER", BUNDLE_ID),
        ("PRODUCT_NAME", '"$(TARGET_NAME)"'),
        ("SWIFT_EMIT_LOC_STRINGS", "YES"),
        ("SWIFT_VERSION", SWIFT_VERSION),
        ("TARGETED_DEVICE_FAMILY", '"1,2"'),
    ]
    pairs.sort(key=lambda pair: pair[0])

    lines = ["\t\t%s /* %s */ = {" % (identifier, name), "\t\t\tisa = XCBuildConfiguration;", "\t\t\tbuildSettings = {"]
    lines += settings_block(pairs)
    lines += ["\t\t\t};", "\t\t\tname = %s;" % name, "\t\t};"]
    return "\n".join(lines)


def config_list(identifier, label, debug_id, release_id):
    lines = [
        "\t\t%s /* Build configuration list for %s */ = {" % (identifier, label),
        "\t\t\tisa = XCConfigurationList;",
        "\t\t\tbuildConfigurations = (",
        "\t\t\t\t%s /* Debug */," % debug_id,
        "\t\t\t\t%s /* Release */," % release_id,
        "\t\t\t);",
        "\t\t\tdefaultConfigurationIsVisible = 0;",
        "\t\t\tdefaultConfigurationName = Release;",
        "\t\t};",
    ]
    return "\n".join(lines)


SCHEME = """<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "{stamp}"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "{target}"
               BuildableName = "{name}.app"
               BlueprintName = "{name}"
               ReferencedContainer = "container:{name}.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES"
      shouldAutocreateTestPlan = "YES">
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "{target}"
            BuildableName = "{name}.app"
            BlueprintName = "{name}"
            ReferencedContainer = "container:{name}.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "{target}"
            BuildableName = "{name}.app"
            BlueprintName = "{name}"
            ReferencedContainer = "container:{name}.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
"""

WORKSPACE = """<?xml version="1.0" encoding="UTF-8"?>
<Workspace
   version = "1.0">
   <FileRef
      location = "self:">
   </FileRef>
</Workspace>
"""

CHECKS = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>IDEDidComputeMac32BitWarning</key>
\t<true/>
</dict>
</plist>
"""


def write(path, contents):
    directory = os.path.dirname(path)
    if directory and not os.path.isdir(directory):
        os.makedirs(directory)
    with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(contents)


def main():
    pbxproj, ids, source_count, resource_count = build()
    root = "%s.xcodeproj" % PROJECT_NAME

    write(os.path.join(root, "project.pbxproj"), pbxproj)
    write(os.path.join(root, "project.xcworkspace", "contents.xcworkspacedata"), WORKSPACE)
    write(
        os.path.join(root, "project.xcworkspace", "xcshareddata", "IDEWorkspaceChecks.plist"),
        CHECKS,
    )
    write(
        os.path.join(root, "xcshareddata", "xcschemes", "%s.xcscheme" % PROJECT_NAME),
        SCHEME.format(stamp=XCODE_STAMP, target=ids["target"], name=PROJECT_NAME),
    )

    print(
        "generated %s: %d source file(s), %d resource(s)"
        % (root, source_count, resource_count)
    )


if __name__ == "__main__":
    main()
