"""Turn a Blueprint diff exported by the BlueprintDiffExport plugin into a Mermaid diagram.

    python Doc/sexpr_to_mermaid.py Doc/graph/transient/Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.sexpr

Writes the diagram next to the input with the .mmd extension, following the
style rules in AGENTS.md. The diff is merged with the matching reference file
(Doc/graph/reference/...), the full current Blueprint: every node connected to
the change is drawn, and nodes that aren't part of the diff are muted. Changes
that can't be drawn (such as removed nodes) are listed on stderr.
"""

import argparse
import json
import re
import sys
from pathlib import Path

# --- Palette ----------------------------------------------------------------
# Colours come from the default palette in Doc/palette.json, the one place to change them.
# export_svg.mjs turns them into CSS variables so other palettes can be applied.

_PALETTE = json.loads(Path(__file__).with_name("palette.json").read_text(encoding="utf-8"))
_COLOURS = _PALETTE["palettes"]["default"]["colors"]
DIM_AMOUNT = _PALETTE["dim"]["amount"]


def dim(colour):
    """A colour mixed with the node body, for parts of a diagram that aren't part of the change.
    export_svg.mjs computes the same values (same rounding) to map them back to --<name>-dim."""
    body = _COLOURS["node-body"]
    channels = []
    for i in (1, 3, 5):
        c, b = int(colour[i:i + 2], 16), int(body[i:i + 2], 16)
        channels.append(int(c * DIM_AMOUNT + b * (1 - DIM_AMOUNT) + 0.5))
    return "#" + "".join(f"{v:02x}" for v in channels)

BODY = _COLOURS["node-body"]
TEXT = _COLOURS["text"]
MUTED = _COLOURS["text-muted"]
EVENT_BORDER = _COLOURS["border-event"]
SETTER_BORDER = _COLOURS["border-setter"]
NEUTRAL_BORDER = _COLOURS["border-function"]  # function calls and mixed-type operators
CONTEXT_BORDER = _COLOURS["border-context"]

# Blueprint editor pin type colours, keyed by pin kind ("float" -> "pin-float").
PIN_COLOURS = {name[len("pin-"):]: value for name, value in _COLOURS.items() if name.startswith("pin-")}

HEADER = """---
config:
  flowchart:
    curve: step
    nodeSpacing: 20
    rankSpacing: 60
    subGraphTitleMargin:
      top: 4
      bottom: 4
---
flowchart LR"""

EVENT_CLASSES = (
    "K2Node_Event",
    "K2Node_CustomEvent",
    "K2Node_EnhancedInputAction",
    "K2Node_InputAction",
    "K2Node_InputKey",
    "K2Node_ComponentBoundEvent",
)
OPERATOR_CLASSES = (
    "K2Node_PromotableOperator",
    "K2Node_CommutativeAssociativeBinaryOperator",
)
OPERATOR_TITLE = re.compile(r"^\w+ [-+*/%<>=!&|^]+ \w+$")


# --- S-expression parsing ---------------------------------------------------


class Symbol(str):
    """An unquoted atom, as opposed to a quoted string."""


def tokenize(text):
    i = 0
    while i < len(text):
        char = text[i]
        if char.isspace():
            i += 1
        elif char in "()":
            yield char
            i += 1
        elif char == '"':
            i += 1
            value = []
            while text[i] != '"':
                if text[i] == "\\":
                    i += 1
                    value.append("\n" if text[i] == "n" else text[i])
                else:
                    value.append(text[i])
                i += 1
            i += 1
            yield "".join(value)
        else:
            start = i
            while i < len(text) and not text[i].isspace() and text[i] not in "()":
                i += 1
            yield Symbol(text[start:i])


def parse(text):
    stack = [[]]
    for token in tokenize(text):
        if token == "(":
            stack.append([])
        elif token == ")":
            done = stack.pop()
            stack[-1].append(done)
        else:
            stack[-1].append(token)
    return stack[0][0]


def lists(expr, head):
    return [item for item in expr if isinstance(item, list) and item and item[0] == head]


def first(expr, head):
    found = lists(expr, head)
    return found[0] if found else None


# --- Model ------------------------------------------------------------------


def pin_kind(type_text):
    text = type_text.lower()
    if text == "exec":
        return "exec"
    if "object reference" in text:
        return "object"
    if text.startswith("float"):
        return "float"
    if text.startswith("integer64"):
        return "integer64"
    for kind in ("boolean", "byte", "integer", "name", "string", "text", "vector", "rotator", "transform"):
        if text.startswith(kind):
            return kind
    return "other"


def display_name(name):
    if name == "self":
        return "Target"
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name).replace("_", " ")


def node_role(name, title):
    if name.startswith("K2Node_Knot"):
        return "reroute"
    if name.startswith(EVENT_CLASSES):
        return "event"
    if name.startswith("K2Node_VariableGet"):
        return "getter"
    if name.startswith("K2Node_VariableSet"):
        return "setter"
    if name.startswith(OPERATOR_CLASSES) or OPERATOR_TITLE.match(title):
        return "operator"
    return "other"


def node_title(role, title):
    if role == "event":
        return "◆ " + title
    if role in ("getter", "setter"):
        prefix = "GET " if role == "getter" else "SET "
        rest = re.sub(r"^(Get|Set)\s+", "", title)
        return prefix + display_name(rest)
    return title


class Node:
    def __init__(self, name, title, x, y, context=False):
        self.name = name
        self.raw_title = title
        self.x = x
        self.y = y
        self.context = context  # not part of the diff, only connected to it
        self.role = node_role(name, title)
        self.pins = {}  # pin name -> (direction, type)
        self.defaults = {}  # pin name -> value typed into the pin

    @property
    def title(self):
        return node_title(self.role, self.raw_title)


def read_graph(graph, warnings):
    """Return the added nodes and the wires between pins of a graph diff."""
    nodes = {}
    wires = {}  # (source, target) -> pin type; both ends list the same wire
    known = {}  # node name -> (title, x, y), from any entry that names the node

    for entry in graph[2:]:
        if not isinstance(entry, list):
            continue
        for holder in [entry] + lists(entry, "old") + lists(entry, "new"):
            for info in lists(holder, "node"):
                pos = first(info, "pos")
                if len(info) >= 3 and pos:
                    known.setdefault(info[1], (info[2], int(pos[1]), int(pos[2])))

    for entry in graph[2:]:
        if not isinstance(entry, list):
            continue
        kind = entry[0]
        if kind != "node-added":
            text = first(entry, "text")
            warnings.append(f"{graph[1]}: not drawn: {kind} {text[1] if text else ''}")
            continue
        info = first(entry, "node")
        pos = first(info, "pos")
        node = Node(info[1], info[2], int(pos[1]), int(pos[2]))
        nodes[node.name] = node
        for pin in lists(entry, "pin"):
            direction, pin_name, pin_type = pin[1], pin[2], pin[3]
            node.pins[pin_name] = (direction, pin_type)
            default = first(pin, "default")
            if default and len(default) > 1:
                node.defaults[pin_name] = default[1]
            links = first(pin, "links")
            for link in links[1:] if links else []:
                here, there = (node.name, pin_name), (link[1], link[2])
                if direction == "out":
                    wires[(here, there)] = pin_type  # the output side decides the type
                else:
                    wires.setdefault((there, here), pin_type)
    wire_set = {(source, target, pin_type) for (source, target), pin_type in wires.items()}
    return nodes, wire_set, known


def remove_reroutes(nodes, wires):
    """Replace wires through reroute nodes with direct wires."""
    reroutes = {name for name, node in nodes.items() if node.role == "reroute"}
    into = {name: [] for name in reroutes}
    out_of = {name: [] for name in reroutes}
    for source, target, pin_type in wires:
        if target[0] in reroutes:
            into[target[0]].append((source, pin_type))
        if source[0] in reroutes:
            out_of[source[0]].append(target)

    def sources(name, seen=()):
        for source, pin_type in into[name]:
            if source[0] in reroutes and source[0] not in seen:
                yield from sources(source[0], seen + (name,))
            elif source[0] not in reroutes:
                yield source, pin_type

    def targets(name, seen=()):
        for target in out_of[name]:
            if target[0] in reroutes and target[0] not in seen:
                yield from targets(target[0], seen + (name,))
            elif target[0] not in reroutes:
                yield target

    result = {w for w in wires if w[0][0] not in reroutes and w[1][0] not in reroutes}
    for name in reroutes:
        for source, pin_type in sources(name):
            for target in targets(name):
                result.add((source, target, pin_type))
    for name in reroutes:
        del nodes[name]
    return result


WIRE_CHANGES = (
    "pin-links-added",
    "pin-links-removed",
    "pin-relinked-node",
    "pin-relinked-pin",
    "pin-type-category",
    "pin-type-subcategory",
    "pin-type-subcategory-object",
    "pin-type-is-array",
    "pin-type-is-ref",
)


def diff_changes(graph, warnings):
    """
    Nodes that are part of the diff, and the nodes the change touches (start points for
    finding everything connected). Rewiring changes the wire, not the nodes at its ends.
    """
    changed, touched = set(), set()

    def pin_owner(entry, side):
        holder = first(entry, side)
        pin = first(holder, "pin") if holder else None
        return (pin[1], pin[2]) if pin and len(pin) > 2 else None

    def pin_links(entry, side):
        holder = first(entry, side)
        links = first(holder, "links") if holder else None
        return [link[1] for link in links[1:]] if links else []

    for entry in graph[2:]:
        if not isinstance(entry, list):
            continue
        kind = entry[0]
        if kind == "node-added":
            changed.add(first(entry, "node")[1])
        elif kind in ("node-pin-count", "node-property"):
            node = first(first(entry, "new") or first(entry, "old") or [], "node")
            if node:
                changed.add(node[1])
        elif kind == "pin-default-value":
            old, new = pin_owner(entry, "old-pin"), pin_owner(entry, "new-pin")
            # The engine sometimes pairs different pins; only the same pin with a new value counts.
            if old and new and old == new:
                changed.add(new[0])
        elif kind in WIRE_CHANGES:
            for side in ("old-pin", "new-pin"):
                owner = pin_owner(entry, side)
                if owner:
                    touched.add(owner[0])
                touched.update(pin_links(entry, side))
        elif kind not in ("node-moved", "node-comment"):
            text = first(entry, "text")
            warnings.append(f"{graph[1]}: not drawn: {kind} {text[1] if text else ''}")
    return changed, touched | changed


def reference_graph(reference, graph_name):
    """All nodes and wires of one graph in a reference file (the full current Blueprint)."""
    graph = next((g for g in lists(reference, "graph") if g[1] == graph_name), None)
    nodes, wires = {}, {}
    for info in lists(graph or [], "node"):
        pos = first(info, "pos")
        node = Node(info[1], info[2], int(pos[1]), int(pos[2]))
        nodes[node.name] = node
        for pin in lists(info, "pin"):
            direction, pin_name, pin_type = pin[1], pin[2], pin[3]
            node.pins[pin_name] = (direction, pin_type)
            default = first(pin, "default")
            if default and len(default) > 1:
                node.defaults[pin_name] = default[1]
            links = first(pin, "links")
            for link in links[1:] if links else []:
                here, there = (node.name, pin_name), (link[1], link[2])
                if direction == "out":
                    wires[(here, there)] = pin_type
                else:
                    wires.setdefault((there, here), pin_type)
    return nodes, {(source, target, pin_type) for (source, target), pin_type in wires.items()}


def connected_part(nodes, wires, start):
    """The nodes reachable from the start nodes over wires in either direction, and their wires."""
    neighbours = {}
    for source, target, _ in wires:
        neighbours.setdefault(source[0], set()).add(target[0])
        neighbours.setdefault(target[0], set()).add(source[0])
    seen, queue = set(), [name for name in start if name in nodes]
    while queue:
        name = queue.pop()
        if name not in seen:
            seen.add(name)
            queue.extend(neighbours.get(name, ()))
    part = {name: nodes[name] for name in seen}
    return part, {w for w in wires if w[0][0] in seen and w[1][0] in seen}


def add_context_nodes(nodes, wires, known):
    """Create placeholders for nodes that existed before the change, titled from the diff if possible."""
    for source, target, pin_type in sorted(wires):
        for (node_name, pin_name), direction in ((source, "out"), (target, "in")):
            if node_name not in nodes:
                title, x, y = known.get(node_name, (node_name, 10**9, 0))
                nodes[node_name] = Node(node_name, title, x, y, context=True)
            node = nodes[node_name]
            if node.context:
                node.pins.setdefault(pin_name, (direction, pin_type))


# --- Mermaid output ---------------------------------------------------------


NUMBER = re.compile(r"-?\d+\.\d+")


def is_explicit(value):
    """Whether a pin value looks deliberately set: not empty, zero, false or None."""
    text = str(value).strip()
    if not text or text.lower() in ("false", "none", "()"):
        return False
    numbers = re.findall(r"-?\d+(?:\.\d+)?", text)
    if numbers and all(float(n) == 0 for n in numbers) and not re.search(r"[A-Za-z]{2,}", re.sub(r"\b[XYZWRGBAPitchYawRol]+=", "", text)):
        return False
    return True


def format_value(value):
    """'50.000000' -> '50', '0.500000' -> '0.5', also inside structs like '(X=1.000000,...)'."""
    return NUMBER.sub(lambda m: m.group(0).rstrip("0").rstrip("."), str(value))


def value_box(value):
    """A pin value in a small frame; currentColor gives the frame the pin's colour."""
    text = format_value(value).replace("&", "#amp;").replace("<", "#lt;").replace(">", "#gt;")
    return f"<span style='border:1px solid currentColor;border-radius:3px;padding:0 5px'>{text}</span>"


def ident(*parts):
    return "_".join(re.sub(r"\W", "_", part) for part in parts)


def label(text):
    return '"' + text.replace('"', "#quot;") + '"'


def render_graph(graph_name, nodes, wires, lines, styles, classes, edges, indent):
    pad = "    " * indent
    connected = {}
    for source, target, _ in wires:
        connected.setdefault(source[0], set()).add(source[1])
        connected.setdefault(target[0], set()).add(target[1])

    endpoint = {}
    invisible = []
    order = sorted(nodes.values(), key=lambda n: (n.x, n.y, n.name))

    for node in order:
        node_id = ident("N", graph_name, node.name)
        linked = connected.get(node.name, set())
        # Unconnected input pins with a value typed in are shown with that value in a box.
        values = {
            pin_name: node.defaults[pin_name]
            for pin_name, (direction, pin_type) in node.pins.items()
            if direction == "in"
            and pin_name not in linked
            and pin_kind(pin_type) != "exec"
            and is_explicit(node.defaults.get(pin_name, ""))
        }
        pins = [(p, *node.pins[p]) for p in node.pins if p in linked or p in values]
        inputs = [p for p in pins if p[1] == "in"]
        outputs = [p for p in pins if p[1] == "out"]
        kinds = {pin_kind(p[2]) for p in pins}

        # Nodes with typed-in values keep their pin rows, otherwise the values would be hidden.
        collapsible = (node.role == "getter" and len(outputs) == 1 and len(inputs) <= 1) or node.role == "operator"
        collapsed = collapsible and not values

        lines.append(f"{pad}subgraph {node_id}[{label(node.title)}]")
        for pin_name, direction, pin_type in [] if collapsed else inputs + outputs:
            pin_id = ident(node_id, pin_name)
            endpoint[(node.name, pin_name)] = pin_id
            kind = pin_kind(pin_type)
            marker = "▶" if kind == "exec" else "●"
            name = "" if pin_name in ("execute", "then") else display_name(pin_name)
            if pin_name in values:
                text = f"{value_box(values[pin_name])} {name}"
            else:
                text = f"{marker} {name}" if direction == "in" else f"{name} {marker}"
            shape = (">", "]") if kind == "exec" else ("[", "]")
            lines.append(f"{pad}    {pin_id}{shape[0]}{label(text.strip())}{shape[1]}")
            classes.setdefault(f"{kind}_dim" if node.context else kind, []).append(pin_id)
        lines.append(f"{pad}end")
        if collapsed:
            for pin_name, _, _ in pins:
                endpoint[(node.name, pin_name)] = node_id
        elif inputs and outputs:
            # Keep every input left of the outputs.
            for pin_name, _, _ in inputs:
                invisible.append((ident(node_id, pin_name), ident(node_id, outputs[0][0])))

        # Border and title colours by role.
        extra = ""
        if node.role == "event":
            stroke, width, title = EVENT_BORDER, "3px", TEXT
        elif node.role == "setter":
            stroke, width, title = SETTER_BORDER, "3px", TEXT
        elif node.role == "getter":
            stroke = PIN_COLOURS[pin_kind(outputs[0][2])] if outputs else NEUTRAL_BORDER
            width, title, extra = "2px", stroke, ",rx:16px,ry:16px"
        elif node.role == "operator":
            stroke = PIN_COLOURS[kinds.pop()] if len(kinds) == 1 else NEUTRAL_BORDER
            width, title = "2px", stroke if stroke != NEUTRAL_BORDER else TEXT
        else:
            stroke, width, title = NEUTRAL_BORDER, "2px", TEXT
        if node.context:
            # Not part of the change: the same colours, dimmed, with a dashed outline.
            stroke, title = dim(stroke), dim(title)
            extra = ",stroke-dasharray:5 5" + extra
        styles.append(f"style {node_id} fill:{BODY},stroke:{stroke},stroke-width:{width},color:{title}{extra}")

    rank = {node.name: i for i, node in enumerate(order)}
    drawn = set()
    for source, target, pin_type in sorted(wires, key=lambda w: (rank[w[0][0]], w[0][1], rank[w[1][0]], w[1][1])):
        # Collapsed nodes can map several pins to one box; draw each connection once.
        pair = (endpoint[source], endpoint[target])
        if pair not in drawn:
            drawn.add(pair)
            # A wire between two nodes that aren't part of the change is dimmed and dashed.
            old = nodes[source[0]].context and nodes[target[0]].context
            edges.append((*pair, pin_kind(pin_type), old))
    return invisible


def to_mermaid(diff, warnings, reference=None):
    graphs = lists(diff, "graph")
    lines, styles, classes, edges, invisible = [], [], {}, [], []

    nested = len(graphs) > 1
    for graph in graphs:
        graph_name = graph[1]
        if reference is not None:
            # Draw everything connected to the change in the current graph; mute what didn't change.
            changed, start = diff_changes(graph, warnings)
            all_nodes, all_wires = reference_graph(reference, graph_name)
            nodes, wires = connected_part(all_nodes, all_wires, start)
            for node in nodes.values():
                node.context = node.name not in changed
            wires = remove_reroutes(nodes, wires)
        else:
            nodes, wires, known = read_graph(graph, warnings)
            wires = remove_reroutes(nodes, wires)
            add_context_nodes(nodes, wires, known)
        if not nodes:
            continue
        if nested:
            lines.append(f"    subgraph {ident('G', graph_name)}[{label(graph_name)}]")
        invisible += render_graph(graph_name, nodes, wires, lines, styles, classes, edges, 2 if nested else 1)
        if nested:
            lines.append("    end")
        lines.append("")

    out = [HEADER, ""]
    out += lines
    out += ["    %% Wires"]
    for source, target, kind, _ in edges:
        arrow = "==>" if kind == "exec" else "-->"
        out.append(f"    {source} {arrow} {target}")
    if invisible:
        out += ["", "    %% Keep inputs left of outputs inside each node"]
        out += [f"    {a} ~~~ {b}" for a, b in invisible]
    out += ["", "    %% Nodes"]
    out += [f"    {s}" for s in styles]
    out += ["", "    %% Pins"]
    for kind in sorted(classes):
        base = kind.removesuffix("_dim")
        colour = dim(PIN_COLOURS[base]) if kind.endswith("_dim") else PIN_COLOURS[base]
        out.append(f"    classDef pin_{kind} fill:{BODY},stroke:{BODY},color:{colour}")
    for kind in sorted(classes):
        out.append(f"    class {','.join(classes[kind])} pin_{kind}")
    if edges:
        out += ["", "    %% Wire colours (dimmed and dashed between two nodes that aren't part of the change)"]
        groups = {}
        for index, (_, _, kind, old) in enumerate(edges):
            groups.setdefault((kind, old), []).append(str(index))
        for (kind, old), indices in sorted(groups.items()):
            width = 3 if kind == "exec" else 2
            colour = dim(PIN_COLOURS[kind]) if old else PIN_COLOURS[kind]
            dashes = ",stroke-dasharray:6 4" if old else ""
            out.append(f"    linkStyle {','.join(indices)} stroke:{colour},stroke-width:{width}px{dashes}")
    return "\n".join(out) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+", type=Path, help="Blueprint diff .sexpr files")
    args = parser.parse_args()

    for path in args.files:
        diff = parse(path.read_text(encoding="utf-8"))
        if isinstance(diff, list) and diff[0] == "asset-diff":
            print(f"{path}: skipped, asset diffs have no graph (use sexpr_to_table.py)", file=sys.stderr)
            continue
        if not isinstance(diff, list) or diff[0] != "blueprint-diff":
            sys.exit(f"{path}: not a blueprint-diff file")
        warnings = []
        # The matching reference file holds the full current Blueprint.
        parts = list(path.parts)
        reference = None
        if "transient" in parts:
            parts[len(parts) - 1 - parts[::-1].index("transient")] = "reference"
            reference_path = Path(*parts)
            if reference_path.exists():
                reference = parse(reference_path.read_text(encoding="utf-8"))
        if reference is None:
            warnings.append("no reference file; only added nodes and their direct neighbours are drawn")
        output = path.with_suffix(".mmd")
        output.write_text(to_mermaid(diff, warnings, reference), encoding="utf-8", newline="\n")
        for warning in warnings:
            print(f"{path.name}: {warning}", file=sys.stderr)
        print(f"Wrote {output}")


if __name__ == "__main__":
    main()
