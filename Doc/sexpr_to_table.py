"""Turn an asset diff (non-Blueprint assets) exported by BlueprintDiffExport into a Markdown table.

    python Doc/sexpr_to_table.py Doc/graph/transient/Game/Input/Actions/IA_Zoom.sexpr

Writes the table next to the input with the .md extension. A new asset gets a
"Setting | Value" table of everything set after creating it; a changed asset
gets a "Setting | Before | After" table.
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
    """'DefaultKeyMappings Mappings' -> 'Default Key Mappings › Mappings'."""
    return " › ".join(words(part) for part in name.split())


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


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+", type=Path, help="asset diff .sexpr files")
    args = parser.parse_args()

    for path in args.files:
        diff = parse(path.read_text(encoding="utf-8"))
        if not isinstance(diff, list) or diff[0] != "asset-diff":
            print(f"{path}: skipped, not an asset diff (use sexpr_to_mermaid.py for Blueprints)", file=sys.stderr)
            continue
        output = path.with_suffix(".md")
        output.write_text(to_markdown(diff), encoding="utf-8", newline="\n")
        print(f"Wrote {output}")


if __name__ == "__main__":
    main()
