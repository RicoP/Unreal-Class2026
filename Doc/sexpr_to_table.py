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
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name)


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
    text = re.sub(r"\"?/Script/[\w.]+'/[\w/]+\.(\w+)'\"?", r"\1", text)
    text = re.sub(r"/Game/[\w/]+\.(\w+)(?::[\w.]+)?", r"\1", text)
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


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+", type=Path, help="asset or actor diff .sexpr files")
    args = parser.parse_args()

    for path in args.files:
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
