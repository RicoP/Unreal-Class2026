"""Turn an asset diff (non-Blueprint assets) or an actor diff exported by BlueprintDiffExport
into a Markdown table.

    python Doc/sexpr_to_table.py Doc/graph/transient/Game/Input/Actions/IA_Zoom.sexpr

Writes the table next to the input with the .md extension. A new asset gets a
"Setting | Value" table of everything set after creating it; a changed asset
gets a "Setting | Before | After" table. Actors placed in a level get the same
two kinds of table ("Place ... in the level", "Select ... and change"), with
their transform first.
"""

import argparse
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
from sexpr_to_mermaid import first, lists, parse  # noqa: E402


def words(name):
    """'AnimSequence' -> 'Anim Sequence'; 'Texture2D' and runs of capitals stay together."""
    return re.sub(r"(?<=[a-z])(?=[A-Z])|(?<=[A-Z0-9])(?=[A-Z][a-z])", " ", name)


def setting_name(name):
    """'DefaultKeyMappings Mappings' -> 'Default Key Mappings › Mappings'; booleans lose their
    code prefix like in the editor ('bOrientRotationToMovement' -> 'Orient Rotation To Movement')."""
    return " › ".join(words(re.sub(r"^b(?=[A-Z])", "", part)) for part in name.split())


# Older properties that the engine keeps next to their replacement, with the same value.
# Only the replacement is shown, as in the editor.
SUPERSEDED = {"SkeletalMesh": "SkeletalMeshAsset"}


def shorten(text):
    """Replace Unreal object paths and localised text with readable values."""
    # Localised text such as NSLOCTEXT("[ns]", "key", "Zoom"): keep the text itself.
    text = re.sub(r'(?:NS)?LOCTEXT\((?:"[^"]*",\s*)*"((?:[^"\\]|\\.)*)"\)', r"\1", text)
    text = re.sub(r'INVTEXT\("((?:[^"\\]|\\.)*)"\)', r"\1", text)
    # Instanced sub-objects such as modifiers: show their class, e.g. "Negate".
    text = re.sub(
        r"\"?/Script/\w+\.(?:InputModifier|InputTrigger)?(\w+)'[^']*:[^']*'\"?",
        lambda m: m.group(1),
        text,
    )
    # References to assets: show the asset name, e.g. "IA_Zoom".
    # Asset names may contain hyphens (character-female-a).
    text = re.sub(r"\"?/Script/[\w.]+'/[\w/-]+\.([\w-]+)(?::[\w.]+)?'\"?", r"\1", text)
    text = re.sub(r"/Game/[\w/-]+\.([\w-]+)(?::[\w.]+)?", r"\1", text)
    return text


def split_top_level(text):
    """Split 'a,(b,c),"d,e"' at commas that aren't nested or quoted."""
    parts, depth, quoted, start = [], 0, False, 0
    for i, char in enumerate(text):
        if char == '"':
            quoted = not quoted
        elif not quoted and char == "(":
            depth += 1
        elif not quoted and char == ")":
            depth -= 1
        elif not quoted and depth == 0 and char == ",":
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    return [part.strip() for part in parts if part.strip()]


def list_items(value):
    """Elements of an exported Unreal array, e.g. '((A=1),(A=2))' or '("x","y")', or None."""
    if not isinstance(value, str) or not value.startswith("(") or not value.endswith(")"):
        return None
    if not value.startswith("((") and "=" in split_top_level(value[1:-1])[0]:
        return None  # a single struct such as '(X=1,Y=2)', not a list
    return split_top_level(value[1:-1])


def describe(item):
    """A list element: a struct gets 'Field: value' pairs, anything else its short name."""
    return describe_item(item) if item.startswith("(") else shorten(item).strip('"')


def describe_item(item):
    """'(Action=...,Key=W)' -> 'Action: IA_Move, Key: W'."""
    fields = []
    for field in split_top_level(item[1:-1]):
        key, _, value = field.partition("=")
        value = shorten(value)
        if value.startswith("(") and value.endswith(")"):
            value = " + ".join(split_top_level(value[1:-1]))
        fields.append(f"{words(key)}: {value}")
    return ", ".join(fields)


def cell(value):
    """Shorten object paths and escape Markdown table syntax."""
    if value is None or value == "none":
        return "—"
    text = shorten(str(value)).strip('"')
    return (text or "(empty)").replace("|", "\\|").replace("\n", " ")


def change_rows(name, old, new):
    """Table rows for one changed setting; lists of structs are compared item by item."""
    old_items, new_items = list_items(old), list_items(new)
    # An empty array is exported as "", so treat it as an empty list next to a real one.
    if old_items is None and old in ("", None) and new_items is not None:
        old_items = []
    if new_items is None and new in ("", None) and old_items is not None:
        new_items = []
    if old_items is None or new_items is None:
        return [f"| {setting_name(name)} | {cell(old)} | {cell(new)} |"]
    rows = []
    remaining = list(new_items)
    for item in old_items:
        if item in remaining:
            remaining.remove(item)
        else:
            rows.append(f"| {setting_name(name)}: remove | {cell(describe(item))} | — |")
    for item in remaining:
        rows.append(f"| {setting_name(name)}: add | — | {cell(describe(item))} |")
    return rows


def to_markdown(diff):
    package = diff[1]
    name = package.rsplit("/", 1)[-1]
    asset_class = words(first(diff, "class")[1])
    is_new = first(diff, "baseline") is not None
    properties = first(diff, "properties")[1:]

    lines = [f"### {name} ({asset_class})", ""]
    if not properties:
        lines.append("No changes.")
        return "\n".join(lines) + "\n"

    if is_new:
        lines += [
            f"Create a new {asset_class} named `{name}` in `{package.rsplit('/', 1)[0]}`, then set:",
            "",
            "| Setting | Value |",
            "|---|---|",
        ]
        for entry in properties:
            new = first(entry, "new")[1]
            items = list_items(new)
            if items is None:
                lines.append(f"| {setting_name(entry[1])} | {cell(new)} |")
            else:
                lines += [f"| {setting_name(entry[1])}: add | {cell(describe(item))} |" for item in items]
    else:
        lines += [
            f"Open `{name}` in `{package.rsplit('/', 1)[0]}` and change:",
            "",
            "| Setting | Before | After |",
            "|---|---|---|",
        ]
        for entry in properties:
            old, new = first(entry, "old"), first(entry, "new")
            lines += change_rows(entry[1], old[1] if old else None, new[1] if new else None)
    return "\n".join(lines) + "\n"


def number(text):
    """'90.0' -> '90', '-36.523' -> '-36.523'."""
    value = float(text)
    return str(int(value)) if value == int(value) else f"{value:g}"


def transform_rows(expr):
    """{'Location': '90, -160, 0', ...} from (transform (location x y z) (rotation p y r) (scale x y z))."""
    if expr is None or len(expr) < 2 or expr[1] == "none":
        return {}
    rows = {}
    for name, label in (("location", "Location"), ("rotation", "Rotation (pitch, yaw, roll)"), ("scale", "Scale")):
        part = first(expr, name)
        if part:
            rows[label] = ", ".join(number(v) for v in part[1:])
    return rows


# A property that only points at one of the actor's own sub-objects (its components, a volume's
# brush builder) isn't something to set by hand: the editor creates those with the actor.
OWN_SUBOBJECT = re.compile(r":PersistentLevel\.[^.'\"]+\.|Default__")


def actor_properties(diff):
    """Property entries of an actor diff, without references to the actor's own sub-objects."""
    entries = first(diff, "properties")[1:]
    kept = []
    for entry in entries:
        values = [str(part[1]) for part in entry[2:] if isinstance(part, list) and len(part) > 1]
        if any(OWN_SUBOBJECT.search(value) for value in values):
            continue
        kept.append(entry)
    return kept


def actor_to_markdown(diff):
    level = diff[1].rsplit("/", 1)[-1]
    label = first(diff, "label")[1]
    actor_class = words(first(diff, "class")[1].removesuffix("_C"))
    folder = first(diff, "folder")
    is_new = first(diff, "baseline") is not None
    properties = actor_properties(diff)
    new_transform = transform_rows(first(diff, "transform"))

    lines = [f"### {label} ({actor_class})", ""]
    if is_new:
        place = f"Place a **{actor_class}** in the level `{level}`"
        if label != first(diff, "class")[1] and label != actor_class.replace(" ", ""):
            place += f" and name it `{label}`"
        if folder:
            place += f" in the Outliner folder `{folder[1]}`"
        lines += [place + ", then set:", "", "| Setting | Value |", "|---|---|"]
        for name, value in new_transform.items():
            if name.startswith("Rotation") and value == "0, 0, 0":
                continue  # unrotated: nothing to do
            lines.append(f"| {name} | {value} |")
        for entry in properties:
            lines.append(f"| {setting_name(entry[1])} | {cell(first(entry, 'new')[1])} |")
        return "\n".join(lines) + "\n"

    old_transform = transform_rows(first(diff, "old-transform"))
    rows = [
        f"| {name} | {old_transform.get(name, '—')} | {value} |"
        for name, value in new_transform.items()
        if old_transform.get(name) != value
    ]
    for entry in properties:
        old, new = first(entry, "old"), first(entry, "new")
        rows += change_rows(entry[1], old[1] if old else None, new[1] if new else None)
    if not rows:
        lines.append("No changes.")
        return "\n".join(lines) + "\n"
    lines += [
        f"Select `{label}` in the level `{level}` and change:",
        "",
        "| Setting | Before | After |",
        "|---|---|---|",
        *rows,
    ]
    return "\n".join(lines) + "\n"


def trim_numbers(text):
    """'(Pitch=0.000000,Yaw=-90.000000)' -> '(Pitch=0,Yaw=-90)'."""
    return re.sub(r"(-?\d+)\.(\d*?)0+(?![\d])", lambda m: m.group(1) + ("." + m.group(2) if m.group(2) else ""), text)


def value_cell(value):
    """A property value for a table: struct fields as 'Pitch: 0, Yaw: -90', numbers trimmed."""
    if isinstance(value, str) and value.startswith("(") and value.endswith(")") and list_items(value) is None:
        value = describe_item(value)
    # Enum values such as PlacedInWorldOrSpawned read as words, like in the editor. Only plain
    # CamelCase words: asset names (TutorialTPP, SM_Cube) stay as they are.
    if isinstance(value, str) and re.fullmatch(r"(?:[A-Z][a-z]+){2,}", value):
        value = words(value)
    return trim_numbers(cell(value))


def blueprint_settings_markdown(diff):
    """Class defaults and components of a Blueprint diff, or None if it has neither and isn't new."""
    package = diff[1]
    name = package.rsplit("/", 1)[-1]
    is_new = first(diff, "old") == ["old", "none"]
    defaults = (first(diff, "defaults") or ["defaults"])[1:]
    defaults = [entry for entry in defaults if isinstance(entry, list) and entry[0] != "baseline"]
    components = (first(diff, "components") or ["components"])[1:]
    if not (is_new or defaults or components):
        return None

    rows = []  # (setting, old, new)
    if is_new:
        parent = (first(diff, "parent") or ["parent", ""])[1].rsplit(".", 1)[-1].removesuffix("_C") or "Actor"
        rows.append(("Parent Class", None, parent))
    for entry in defaults:
        old = first(entry, "old")
        rows.append((f"Class Defaults › {setting_name(entry[1])}", old[1] if old else None, first(entry, "new")[1]))
    for component in components:
        if component[0] == "component-removed":
            rows.append((f"Component {component[1]}", component[1], "remove"))
            continue
        label = words(component[1])
        if first(component, "new"):
            kind = words(first(component, "class")[1].removesuffix("Component")) + " Component"
            attach = first(component, "attach-to")
            rows.append(("Add Component", None, f"{label} ({kind}" + (f", attached to {words(attach[1])})" if attach else ")")))
        entries = (first(component, "properties") or ["properties"])[1:]
        names = {entry[1] for entry in entries}
        for entry in entries:
            if SUPERSEDED.get(entry[1]) in names:
                continue
            old = first(entry, "old")
            rows.append((f"{label} › {setting_name(entry[1])}", old[1] if old else None, first(entry, "new")[1]))

    lines = [f"### {name} (Blueprint Class)", ""]
    if is_new:
        lines += [
            f"Create a new Blueprint Class named `{name}` in `{package.rsplit('/', 1)[0]}`, then set:",
            "",
            "| Setting | Value |",
            "|---|---|",
        ]
        lines += [f"| {setting} | {value_cell(new)} |" for setting, _, new in rows]
    else:
        lines += [
            f"Open `{name}` and change its class defaults and components:",
            "",
            "| Setting | Before | After |",
            "|---|---|---|",
        ]
        lines += [f"| {setting} | {value_cell(old)} | {value_cell(new)} |" for setting, old, new in rows]
    return "\n".join(lines) + "\n"


# Assets an import creates next to a skeletal mesh, named after it.
IMPORT_COMPANIONS = ("_Skeleton", "_PhysicsAsset")

# Import options as Unreal's default import preset sets them. The plugin lists options that
# differ from the pipeline class defaults, which includes these; only real changes are shown.
IMPORT_PRESET = {
    "PipelineDisplayName": "Default FBX OBJ Assets Pipeline",
    "bAssetTypeSubFolders": "True",
    "CommonMeshesProperties bComputeWeightedNormals": "True",
    "MeshPipeline ThresholdUV": "0.000977",
    "MeshPipeline bImportGeometryCaches": "False",
    "AnimationPipeline bRemoveCurveRedundantKeys": "True",
    "AnimationPipeline bDoNotImportCurveWithZero": "True",
    "MaterialPipeline MaterialImport": "ImportAsMaterialInstances",
    "MaterialPipeline bCreateMaterialInstanceForParent": "True",
    "MaterialPipeline TexturePipeline bAllowNonPowerOfTwo": "True",
    "MaterialPipeline SparseVolumeTexturePipeline bImportSparseVolumeTextures": "False",
    "MaterialPipeline SparseVolumeTexturePipeline bImportAnimatedSparseVolumeTextures": "False",
}

# Folders an import with "Asset Type Sub Folders" creates below the folder imported into.
TYPE_SUBFOLDERS = {"SkeletalMeshes", "StaticMeshes", "Materials", "Textures", "Animations", "Skeletons", "PhysicsAssets"}

IMAGE_SOURCES = (".png", ".jpg", ".jpeg", ".tga", ".bmp", ".exr", ".hdr", ".tif", ".tiff", ".psd")


def import_options(diff):
    """The import options that differ from the preset, without duplicates, in their order."""
    options = {}
    for entry in (first(diff, "import-options") or ["import-options"])[1:]:
        name, value = entry[1], entry[2]
        if IMPORT_PRESET.get(name) != value:
            options.setdefault(name, value)
    return tuple(options.items())


def import_source(path, diff):
    """The source file an asset diff was imported from, also for the Skeleton and Physics Asset
    an import creates next to a mesh (taken from the mesh's diff); None for other assets."""
    source = first(diff, "imported-from")
    if source:
        return source[1]
    for suffix in IMPORT_COMPANIONS:
        if path.stem.endswith(suffix):
            mesh = path.with_name(path.stem.removesuffix(suffix) + ".sexpr")
            if mesh.exists():
                mesh_source = first(parse(mesh.read_text(encoding="utf-8")), "imported-from")
                if mesh_source:
                    return mesh_source[1]
    return None


def import_tables(paths):
    """
    One table per import step instead of one per imported asset. Source files imported into the
    same folder with the same options are one step. Writes <folder>/<first file>.import.md;
    returns the diffs it covers.
    """
    units = {}  # source file -> {"options", "assets": [(class, name, file path, package folder)]}
    covered = set()
    for path in paths:
        diff = parse(path.read_text(encoding="utf-8"))
        if not (isinstance(diff, list) and diff[0] == "asset-diff"):
            continue
        source = import_source(path, diff)
        if not source:
            continue
        covered.add(path)
        unit = units.setdefault(source, {"options": None, "assets": []})
        unit["assets"].append((words(first(diff, "class")[1]), diff[1].rsplit("/", 1)[-1], path, diff[1].rsplit("/", 1)[0]))
        if first(diff, "imported-from") and unit["options"] is None:
            unit["options"] = import_options(diff)

    # A texture the FBX brought along (colormap.png) belongs to that import step, not its own.
    for source in [s for s in units if s.lower().endswith(IMAGE_SOURCES)]:
        owner = next((s for s, u in units.items() if not s.lower().endswith(IMAGE_SOURCES)
                      and u["options"] == units[source]["options"]), None)
        if owner:
            units[owner]["assets"] += units.pop(source)["assets"]

    def destination(unit):
        """Where the files were imported to: the mesh's folder, or the folder above the type
        subfolders (SkeletalMeshes, Materials, ...) the import created."""
        meshes = [a for a in unit["assets"] if a[0].endswith("Mesh")] or unit["assets"]
        folder, package_folder = meshes[0][2].parent, meshes[0][3]
        if folder.name in TYPE_SUBFOLDERS:
            folder, package_folder = folder.parent, package_folder.rsplit("/", 1)[0]
        return folder, package_folder

    steps = {}
    for source, unit in sorted(units.items()):
        folder, package_folder = destination(unit)
        steps.setdefault((folder, package_folder, unit["options"] or ()), []).append((source, unit))

    for (folder, package_folder, options), members in steps.items():
        sources = [Path(source).name for source, _ in members]
        output = folder / (Path(sources[0]).stem + ".import.md")
        newest = max(asset[2].stat().st_mtime for _, unit in members for asset in unit["assets"])
        if output.exists() and output.stat().st_mtime >= newest:
            continue  # up to date (and possibly edited by hand)
        title = f"Import {sources[0]}" if len(sources) == 1 else f"Import {len(sources)} files"
        def short_list(names):
            """'a, b, c' or, for long lists, '18 in all: a, b, …, z' so the table stays narrow."""
            return ", ".join(names) if len(names) <= 3 else f"{len(names)} in all: {names[0]}, {names[1]}, …, {names[-1]}"

        rows = [("Files", short_list(sources))]
        rows += [(setting_name(name), value_cell(value)) for name, value in options]
        created = {}
        for _, unit in members:
            for asset_class, name, _, _ in unit["assets"]:
                created.setdefault(asset_class, []).append(name)
        for asset_class, names in sorted(created.items()):
            rows.append((f"Creates {asset_class}", short_list(names)))
        lines = [
            f"<!-- import: folder=\"{package_folder}\" files=\"{', '.join(sources)}\" -->",
            f"### {title}",
            "",
            f"Import {', '.join(f'`{s}`' for s in sources)} into `{package_folder}` with these options:",
            "",
            "| Setting | Value |",
            "|---|---|",
            *[f"| {setting} | {value} |" for setting, value in rows],
        ]
        output.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        print(f"Wrote {output}")
    return covered


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", type=Path, help="asset or actor diff .sexpr files")
    parser.add_argument("--all-in", type=Path, default=None,
                        help="folder with every diff of the documentation, for grouping imported assets into "
                             "import steps (default: only the files above)")
    args = parser.parse_args()

    # Imported assets are documented per import step, not one by one.
    everything = sorted(args.all_in.rglob("*.sexpr")) if args.all_in else args.files
    imported = import_tables([path.resolve() for path in everything])
    args.files = [path.resolve() for path in args.files]
    for path in imported:
        path.with_suffix(".md").unlink(missing_ok=True)

    for path in args.files:
        if path in imported:
            continue
        diff = parse(path.read_text(encoding="utf-8"))
        if isinstance(diff, list) and diff[0] == "blueprint-diff":
            # The graph is a diagram (sexpr_to_mermaid.py); class defaults and components go into
            # a table next to it, <name>.settings.md.
            output = path.with_suffix(".settings.md")
            markdown = blueprint_settings_markdown(diff)
            if markdown is None:
                output.unlink(missing_ok=True)
                print(f"{path}: no class default or component changes, no table")
            else:
                output.write_text(markdown, encoding="utf-8", newline="\n")
                print(f"Wrote {output}")
            continue
        if isinstance(diff, list) and diff[0] == "actor-diff":
            markdown = actor_to_markdown(diff)
        elif isinstance(diff, list) and diff[0] == "asset-diff":
            markdown = to_markdown(diff)
        else:
            print(f"{path}: skipped, not an asset or actor diff (use sexpr_to_mermaid.py for Blueprints)", file=sys.stderr)
            continue
        output = path.with_suffix(".md")
        output.write_text(markdown, encoding="utf-8", newline="\n")
        print(f"Wrote {output}")


if __name__ == "__main__":
    main()
