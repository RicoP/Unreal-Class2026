"""Turn a Blueprint diff exported by the BlueprintDiffExport plugin into a Mermaid diagram.

    python Doc/sexpr_to_mermaid.py Doc/graph/transient/Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.sexpr

Writes the diagram next to the input with the .mmd extension, following the
style rules in AGENTS.md. Added nodes are drawn in full; wires to nodes that
already existed go to a dashed placeholder. Other changes (removed nodes, moved
nodes, changed values) are listed on stderr instead of drawn.
"""

import argparse
import re
import sys
from pathlib import Path

# --- Palette (single place for all colours) ---------------------------------

BODY = "#151515"
EVENT_BORDER = "#b3261e"
SETTER_BORDER = "#2b5d8f"
NEUTRAL_BORDER = "#3a3a3a"
CONTEXT_BORDER = "#555555"

# Blueprint editor defaults for pin types, see AGENTS.md.
PIN_COLOURS = {
    "exec": "#ffffff",
    "boolean": "#950000",
    "byte": "#006f65",
    "integer": "#1fe3af",
    "integer64": "#ace3af",
    "float": "#38d500",
    "name": "#cd82ff",
    "string": "#ff00d4",
    "text": "#e77caa",
    "vector": "#ffca23",
    "rotator": "#a0b4ff",
    "transform": "#ff7300",
    "object": "#00aaf5",
    "other": "#777777",
}

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
        self.context = context
        self.role = "context" if context else node_role(name, title)
        self.pins = {}  # pin name -> (direction, type)

    @property
    def title(self):
        if self.context:
            return f"{self.raw_title} (existing)"
        return node_title(self.role, self.raw_title)


def read_graph(graph, warnings):
    """Return the added nodes and the wires between pins of a graph diff."""
    nodes = {}
    wires = {}  # (source, target) -> pin type; both ends list the same wire

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
            links = first(pin, "links")
            for link in links[1:] if links else []:
                here, there = (node.name, pin_name), (link[1], link[2])
                if direction == "out":
                    wires[(here, there)] = pin_type  # the output side decides the type
                else:
                    wires.setdefault((there, here), pin_type)
    return nodes, {(source, target, pin_type) for (source, target), pin_type in wires.items()}


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


def add_context_nodes(nodes, wires):
    """Create placeholders for nodes that existed before the change."""
    for source, target, pin_type in sorted(wires):
        for (node_name, pin_name), direction in ((source, "out"), (target, "in")):
            if node_name not in nodes:
                nodes[node_name] = Node(node_name, node_name, 10**9, 0, context=True)
            node = nodes[node_name]
            if node.context:
                node.pins.setdefault(pin_name, (direction, pin_type))


# --- Mermaid output ---------------------------------------------------------


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
        pins = [(p, *node.pins[p]) for p in node.pins if p in connected.get(node.name, ())]
        inputs = [p for p in pins if p[1] == "in"]
        outputs = [p for p in pins if p[1] == "out"]
        kinds = {pin_kind(p[2]) for p in pins}

        collapsed = (node.role == "getter" and len(outputs) == 1 and len(inputs) <= 1) or node.role == "operator"

        lines.append(f"{pad}subgraph {node_id}[{label(node.title)}]")
        for pin_name, direction, pin_type in [] if collapsed else inputs + outputs:
            pin_id = ident(node_id, pin_name)
            endpoint[(node.name, pin_name)] = pin_id
            kind = pin_kind(pin_type)
            marker = "▶" if kind == "exec" else "●"
            name = "" if pin_name in ("execute", "then") else display_name(pin_name)
            text = f"{marker} {name}" if direction == "in" else f"{name} {marker}"
            shape = (">", "]") if kind == "exec" else ("[", "]")
            lines.append(f"{pad}    {pin_id}{shape[0]}{label(text.strip())}{shape[1]}")
            classes.setdefault(kind, []).append(pin_id)
        lines.append(f"{pad}end")
        if collapsed:
            for pin_name, _, _ in pins:
                endpoint[(node.name, pin_name)] = node_id
        elif inputs and outputs:
            invisible.append((ident(node_id, inputs[0][0]), ident(node_id, outputs[0][0])))

        if node.role == "event":
            styles.append(f"style {node_id} fill:{BODY},stroke:{EVENT_BORDER},stroke-width:3px,color:#ffffff")
        elif node.role == "setter":
            styles.append(f"style {node_id} fill:{BODY},stroke:{SETTER_BORDER},stroke-width:3px,color:#ffffff")
        elif node.role == "getter":
            colour = PIN_COLOURS[pin_kind(outputs[0][2])] if outputs else NEUTRAL_BORDER
            styles.append(f"style {node_id} fill:{BODY},stroke:{colour},stroke-width:2px,color:{colour},rx:16px,ry:16px")
        elif node.role == "operator":
            colour = PIN_COLOURS[kinds.pop()] if len(kinds) == 1 else NEUTRAL_BORDER
            title = colour if colour != NEUTRAL_BORDER else "#ffffff"
            styles.append(f"style {node_id} fill:{BODY},stroke:{colour},stroke-width:2px,color:{title}")
        elif node.role == "context":
            styles.append(f"style {node_id} fill:{BODY},stroke:{CONTEXT_BORDER},stroke-width:2px,stroke-dasharray:5 5,color:#999999")
        else:
            styles.append(f"style {node_id} fill:{BODY},stroke:{NEUTRAL_BORDER},stroke-width:2px,color:#ffffff")

    rank = {node.name: i for i, node in enumerate(order)}
    drawn = set()
    for source, target, pin_type in sorted(wires, key=lambda w: (rank[w[0][0]], w[0][1], rank[w[1][0]], w[1][1])):
        # Collapsed nodes can map several pins to one box; draw each connection once.
        pair = (endpoint[source], endpoint[target])
        if pair not in drawn:
            drawn.add(pair)
            edges.append((*pair, pin_kind(pin_type)))
    return invisible


def to_mermaid(diff, warnings):
    graphs = lists(diff, "graph")
    lines, styles, classes, edges, invisible = [], [], {}, [], []

    nested = len(graphs) > 1
    for graph in graphs:
        graph_name = graph[1]
        nodes, wires = read_graph(graph, warnings)
        wires = remove_reroutes(nodes, wires)
        add_context_nodes(nodes, wires)
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
    for source, target, kind in edges:
        arrow = "==>" if kind == "exec" else "-->"
        out.append(f"    {source} {arrow} {target}")
    if invisible:
        out += ["", "    %% Keep inputs left of outputs inside each node"]
        out += [f"    {a} ~~~ {b}" for a, b in invisible]
    out += ["", "    %% Nodes"]
    out += [f"    {s}" for s in styles]
    out += ["", "    %% Pins"]
    for kind in sorted(classes):
        out.append(f"    classDef pin_{kind} fill:{BODY},stroke:{BODY},color:{PIN_COLOURS[kind]}")
    for kind in sorted(classes):
        out.append(f"    class {','.join(classes[kind])} pin_{kind}")
    if edges:
        out += ["", "    %% Wire colours"]
        by_kind = {}
        for index, (_, _, kind) in enumerate(edges):
            by_kind.setdefault(kind, []).append(str(index))
        for kind in sorted(by_kind):
            width = 3 if kind == "exec" else 2
            out.append(f"    linkStyle {','.join(by_kind[kind])} stroke:{PIN_COLOURS[kind]},stroke-width:{width}px")
    return "\n".join(out) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+", type=Path, help="Blueprint diff .sexpr files")
    args = parser.parse_args()

    for path in args.files:
        diff = parse(path.read_text(encoding="utf-8"))
        if not isinstance(diff, list) or diff[0] != "blueprint-diff":
            sys.exit(f"{path}: not a blueprint-diff file")
        warnings = []
        output = path.with_suffix(".mmd")
        output.write_text(to_mermaid(diff, warnings), encoding="utf-8", newline="\n")
        for warning in warnings:
            print(f"{path.name}: {warning}", file=sys.stderr)
        print(f"Wrote {output}")


if __name__ == "__main__":
    main()
