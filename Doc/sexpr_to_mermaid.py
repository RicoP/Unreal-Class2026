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
NEUTRAL_BORDER = _COLOURS["border-function"]  # mixed-type operators and other nodes
CALL_BORDER = _COLOURS["border-call"]  # function calls

# Node classes the editor shows as function calls (blue header): regular, parent and array
# function calls, and async/latent call nodes such as AI MoveTo, Create Widget, Spawn Actor.
CALL_CLASSES = (
    "K2Node_Call",
    "K2Node_AIMoveTo",
    "K2Node_AsyncAction",
    "K2Node_BaseAsyncTask",
    "K2Node_LatentGameplayTaskCall",
    "K2Node_CreateWidget",
    "K2Node_SpawnActor",
)
CONTEXT_BORDER = _COLOURS["border-context"]

# Blueprint editor pin type colours, keyed by pin kind ("float" -> "pin-float").
PIN_COLOURS = {name[len("pin-"):]: value for name, value in _COLOURS.items() if name.startswith("pin-")}

HEADER = """---
config:
  look: classic
  themeCSS: "g.node *, g.cluster * { filter: none !important; }"
  flowchart:
    curve: monotoneX
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
    if "delegate" in text:
        return "delegate"
    if text.startswith("integer64"):
        return "integer64"
    for kind in ("boolean", "byte", "integer", "name", "string", "text", "vector", "rotator", "transform"):
        if text.startswith(kind):
            return kind
    return "other"


def display_name(name):
    if name == "self":
        return "Target"
    # Boolean names carry a "b" prefix in code ("bLooping") that the editor hides.
    name = re.sub(r"^b(?=[A-Z])", "", name)
    # Split before a capital that starts a word ("ActionValue", "XAxis"), but keep
    # runs of capitals together ("iOS" stays "iOS").
    name = re.sub(r"(?<=[a-z0-9])(?=[A-Z][a-z])|(?<=[A-Z])(?=[A-Z][a-z])", " ", name)
    return name.replace("_", " ")


def node_role(name, title):
    if name.startswith("K2Node_Knot"):
        return "reroute"
    if name.startswith(EVENT_CLASSES):
        return "event"
    if name.startswith("K2Node_VariableGet"):
        return "getter"
    if name.startswith("K2Node_Self"):
        return "self"
    if name.startswith("K2Node_VariableSet"):
        return "setter"
    if name.startswith(OPERATOR_CLASSES) or OPERATOR_TITLE.match(title):
        return "operator"
    return "other"


def node_title(role, title):
    if role == "event":
        return "◆ " + title
    if role in ("getter", "setter"):
        # A name that already says what it does ("Get Camera Boom", "Is Jumping",
        # "Set Target Arm Length") gets no second GET or SET.
        name = display_name(title)
        if role == "getter":
            return name if re.match(r"(Get|Is)\b", name) else "GET " + name
        return name if re.match(r"Set\b", name) else "SET " + name
    if role == "self":
        return "Self"
    # Function names come without spaces ("GetPlayerCharacter"); the editor shows "Get Player Character".
    if re.fullmatch(r"[A-Z][A-Za-z0-9]*", title):
        return display_name(title)
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
        self.event_links = {}  # pin name -> "Connect to Event <name>", replacing a delegate wire

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
    """
    '50.000000' -> '50', '0.500000' -> '0.5', also inside structs like '(X=1.000000,...)'.
    Asset and class paths become names: '/Game/Input/IMC_Default.IMC_Default' -> 'IMC_Default'.
    """
    text = str(value)
    text = re.sub(r"/Script/[\w.]+'(/[\w/]+)\.(\w+)'", r"\2", text)  # /Script/Class'/Game/Path.Name'
    text = re.sub(r"/(?:Game|Script)/[\w/]*\.(\w+)(?::[\w.]+)?", r"\1", text)
    return NUMBER.sub(lambda m: m.group(0).rstrip("0").rstrip("."), text)


PIN_COLUMN_WIDTH = 150  # px; every pin label is at least this wide, so nodes line up in width


def pin_label(text, direction):
    """A pin label with a minimum width: inputs aligned left, outputs right, like in the editor."""
    align = "left" if direction == "in" else "right"
    return f"<span style='display:inline-block;min-width:{PIN_COLUMN_WIDTH}px;text-align:{align}'>{text}</span>"


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
        # A node with at most one exec input has no row for it; wires connect to the node itself.
        # The same goes for exec outputs. Counted over all exec pins the node has, so an Enhanced
        # Input event (Triggered, Started, ...) or a Branch keeps showing which pin is used.
        exec_pins = {d: [p for p, (dd, t) in node.pins.items() if dd == d and pin_kind(t) == "exec"] for d in ("in", "out")}
        node_level_exec = {p for d, names in exec_pins.items() if len(names) <= 1 for p in names}
        pins = [
            (p, *node.pins[p])
            for p in node.pins
            if (p in linked or p in values or p in node.event_links) and p not in node_level_exec
        ]
        # Exec pins come first (on top), then data pins, each in the editor's order.
        exec_first = lambda p: pin_kind(p[2]) != "exec"  # noqa: E731 - sort key, False sorts first
        inputs = sorted((p for p in pins if p[1] == "in"), key=exec_first)
        outputs = sorted((p for p in pins if p[1] == "out"), key=exec_first)
        kinds = {pin_kind(p[2]) for p in pins}

        # Nodes with typed-in values keep their pin rows, otherwise the values would be hidden.
        # Pure nodes (no exec pins, e.g. Get Player Character or Get Enhanced Input Local Player
        # Subsystem) count as pure getters when they have one output and at most one input; they
        # keep their editor title. Events, function entries and result nodes are never pure getters.
        pure_function = (
            node.role not in ("event", "reroute")
            and not node.name.startswith(("K2Node_FunctionEntry", "K2Node_FunctionResult"))
            and not any(pin_kind(pin_type) == "exec" for _, pin_type in node.pins.values())
        )
        getter_like = (node.role in ("getter", "self") or pure_function) and len(outputs) == 1 and len(inputs) <= 1
        collapsible = getter_like or node.role == "operator"
        collapsed = collapsible and not values and not node.event_links

        lines.append(f"{pad}subgraph {node_id}[{label(node.title)}]")
        # Invisible anchor rows: Mermaid attaches a wire to a node box to an arbitrary row of it,
        # so the layout could put an event right of the node it triggers, or spread the node's
        # rows sideways. Instead, wires of omitted exec pins go to an anchor in the input column
        # (anchor_in) or come from one in the output column (anchor_out). A node with rows on one
        # side only also gets an anchor on the other side, so those rows stay in one column.
        # export_svg.mjs removes the anchors and draws these wires to the box border.
        rows = [] if collapsed else inputs + outputs
        wired = lambda d: any(  # noqa: E731
            p in linked and node.pins[p][0] == d for p in node_level_exec
        )
        anchor_in = ident(node_id, "anchor_in") if rows and (wired("in") or not inputs) else None
        anchor_out = ident(node_id, "anchor_out") if rows and (wired("out") or not outputs) else None
        for anchor in (anchor_in, anchor_out):
            if anchor:
                lines.append(f'{pad}    {anchor}[" "]')
                classes.setdefault("anchor", []).append(anchor)
        for pin_name, direction, pin_type in [] if collapsed else inputs + outputs:
            pin_id = ident(node_id, pin_name)
            endpoint[(node.name, pin_name)] = pin_id
            kind = pin_kind(pin_type)
            marker = "▶" if kind == "exec" else "●"
            if kind == "exec" and node.name.startswith("K2Node_IfThenElse") and pin_name in ("then", "else"):
                # Branch: the editor shows "True" and "False" for its "then" and "else" pins.
                name = "True" if pin_name == "then" else "False"
            elif kind == "exec":
                # An exec pin shown as a row always gets a name, so it's clear which one to use.
                name = display_name(pin_name)
                name = name[:1].upper() + name[1:]  # "then 0" -> "Then 0", like the editor
            elif pin_name == "self" and direction == "out":
                name = "Self"  # only an input "self" pin is the editor's "Target"
            else:
                name = display_name(pin_name)
            if pin_name in node.event_links:
                text = f"{marker} {node.event_links[pin_name]}"
            elif pin_name in values:
                text = f"{value_box(values[pin_name])} {name}"
            else:
                text = f"{marker} {name}" if direction == "in" else f"{name} {marker}"
            shape = (">", "]") if kind == "exec" else ("[", "]")
            lines.append(f"{pad}    {pin_id}{shape[0]}{label(pin_label(text.strip(), direction))}{shape[1]}")
            classes.setdefault(f"{kind}_dim" if node.context else kind, []).append(pin_id)

        # The layout may stack exec output rows in any order (it sorts rows to reduce crossings);
        # export_svg.mjs puts the rows listed here back in this order, top to bottom.
        exec_rows = [ident(node_id, p) for p, _, t in outputs if pin_kind(t) == "exec"]
        if not collapsed and len(exec_rows) >= 2:
            lines.append(f"{pad}    %% pin-order {' '.join(exec_rows)}")
        lines.append(f"{pad}end")
        # Exec wires of omitted exec pins connect to the node box itself.
        for pin_name in node_level_exec:
            anchor = anchor_in if node.pins[pin_name][0] == "in" else anchor_out
            endpoint[(node.name, pin_name)] = anchor or node_id
        if collapsed:
            for pin_name, _, _ in pins:
                endpoint[(node.name, pin_name)] = node_id
        else:
            # Keep every input left of every output.
            left = [ident(node_id, p) for p, _, _ in inputs] + ([anchor_in] if anchor_in else [])
            right = [ident(node_id, p) for p, _, _ in outputs] + ([anchor_out] if anchor_out else [])
            invisible.extend((a, b) for a in left for b in right)

        # Border and title colours by role.
        extra = ""
        if node.role == "event":
            stroke, width, title = EVENT_BORDER, "3px", TEXT
        elif node.role == "setter":
            stroke, width, title = SETTER_BORDER, "3px", TEXT
        elif node.role in ("getter", "self") or getter_like:
            stroke = PIN_COLOURS[pin_kind(outputs[0][2])] if outputs else NEUTRAL_BORDER
            width, title, extra = "2px", stroke, ",rx:16px,ry:16px"
        elif node.role == "operator":
            stroke = PIN_COLOURS[kinds.pop()] if len(kinds) == 1 else NEUTRAL_BORDER
            width, title = "2px", stroke if stroke != NEUTRAL_BORDER else TEXT
        elif node.name.startswith(CALL_CLASSES):
            stroke, width, title = CALL_BORDER, "2px", TEXT
        else:
            stroke, width, title = NEUTRAL_BORDER, "2px", TEXT
        if node.context:
            # Not part of the change: the same colours, dimmed, with a dashed outline.
            stroke, title = dim(stroke), dim(title)
            extra = ",stroke-dasharray:5 5" + extra
        styles.append(f"style {node_id} fill:{BODY},stroke:{stroke},stroke-width:{width},color:{title}{extra}")

    loops = loop_wires(order, wires)
    rank = {node.name: i for i, node in enumerate(order)}
    drawn = set()
    for source, target, pin_type in sorted(wires, key=lambda w: (rank[w[0][0]], w[0][1], rank[w[1][0]], w[1][1])):
        # Collapsed nodes can map several pins to one box; draw each connection once.
        pair = (endpoint[source], endpoint[target])
        if pair not in drawn:
            drawn.add(pair)
            # A wire between two nodes that aren't part of the change is dimmed and dashed.
            old = nodes[source[0]].context and nodes[target[0]].context
            edges.append((*pair, pin_kind(pin_type), old, (source, target) in loops))
    return invisible


def loop_wires(order, wires):
    """
    Wires that lead back to an earlier node and close a loop (e.g. On Fail -> Delay).
    Found by following wires from the leftmost nodes in the editor; a wire to a node
    that is still on the current path closes a loop.
    """
    outgoing = {}
    for source, target, _ in wires:
        outgoing.setdefault(source[0], []).append((source, target))
    position = {node.name: index for index, node in enumerate(order)}
    for edges in outgoing.values():
        edges.sort(key=lambda e: (position.get(e[1][0], 0), e[1][1]))

    loops, done, on_path = set(), set(), set()
    for start in (node.name for node in order):
        if start in done:
            continue
        stack = [(start, iter(outgoing.get(start, [])))]
        on_path.add(start)
        while stack:
            name, edges = stack[-1]
            edge = next(edges, None)
            if edge is None:
                stack.pop()
                on_path.discard(name)
                done.add(name)
                continue
            target = edge[1][0]
            if target in on_path:
                loops.add(edge)
            elif target not in done:
                on_path.add(target)
                stack.append((target, iter(outgoing.get(target, []))))
    return loops


def is_entry(node):
    """Event nodes and function entry nodes, which start execution."""
    return node.role == "event" or node.name.startswith("K2Node_FunctionEntry")


def to_mermaid(diff, warnings, reference=None):
    graphs = lists(diff, "graph")
    lines, styles, classes, edges, invisible = [], [], {}, [], []

    drawable = []  # (graph name, nodes, wires) for graphs with something left to draw
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
        # Wires from an event's delegate pin aren't drawn; the pin they lead to says
        # "Connect to Event <name>" instead.
        for wire in list(wires):
            source, target, pin_type = wire
            event = nodes.get(source[0])
            if pin_kind(pin_type) == "delegate" and event and event.role == "event" and target[0] in nodes:
                wires.discard(wire)
                nodes[target[0]].event_links[target[1]] = f"Connect to Event {event.raw_title}"
        # An event or function entry that only calls its parent (the default events of a child
        # Blueprint: Event Tick -> Parent: Tick) isn't drawn, and neither is that Parent call.
        for name, node in list(nodes.items()):
            if not is_entry(node):
                continue
            own = {w for w in wires if name in (w[0][0], w[1][0])}
            partners = {end[0] for w in own for end in (w[0], w[1])} - {name}
            if len(partners) != 1:
                continue
            parent = partners.pop()
            if not parent.startswith("K2Node_CallParentFunction") or parent not in nodes:
                continue
            if any(parent in (w[0][0], w[1][0]) and name not in (w[0][0], w[1][0]) for w in wires):
                continue  # the Parent call is wired to something else too
            wires -= own
            del nodes[name], nodes[parent]
        # Event and function entry nodes with nothing connected (such as the default
        # BeginPlay, Tick or Construction Script of a new Blueprint) aren't drawn.
        wired = {end[0] for source, target, _ in wires for end in (source, target)}
        for name in [n for n, node in nodes.items() if is_entry(node) and n not in wired]:
            del nodes[name]
        if nodes:
            drawable.append((graph_name, nodes, wires))

    if not drawable:
        return None

    nested = len(drawable) > 1
    for graph_name, nodes, wires in drawable:
        if nested:
            group_id = ident("G", graph_name)
            lines.append(f"    subgraph {group_id}[{label(graph_name)}]")
            # A graph box only linked inside itself uses its own direction, which defaults to top-down.
            lines.append("        direction LR")
            # A box around each graph when several graphs changed: transparent, subtle border.
            styles.append(f"style {group_id} fill:none,stroke:{_COLOURS['border-neutral']},stroke-width:1px,color:{TEXT}")
        invisible += render_graph(graph_name, nodes, wires, lines, styles, classes, edges, 2 if nested else 1)
        if nested:
            lines.append("    end")
        lines.append("")

    out = [HEADER, ""]
    out += lines
    out += ["    %% Wires"]
    back = []
    for source, target, kind, _, loop in edges:
        if loop:
            # Declared backwards and without arrowhead, so the layout sees no cycle;
            # export_svg.mjs puts the arrowhead on the target end (see the back-edge comments).
            line = "===" if kind == "exec" else "---"
            out.append(f"    {target} {line} {source}")
            back.append(f"    %% back-edge {target} {source}")
        else:
            arrow = "==>" if kind == "exec" else "-->"
            out.append(f"    {source} {arrow} {target}")
    out += back
    if invisible:
        out += ["", "    %% Keep inputs left of outputs inside each node"]
        out += [f"    {a} ~~~ {b}" for a, b in invisible]
    out += ["", "    %% Nodes"]
    out += [f"    {s}" for s in styles]
    out += ["", "    %% Pins"]
    for kind in sorted(classes):
        if kind == "anchor":
            # Invisible layout helper rows (see render_graph); export_svg.mjs ignores them.
            out.append(f"    classDef pin_anchor fill:{BODY},stroke:{BODY},color:{BODY}")
            continue
        base = kind.removesuffix("_dim")
        colour = dim(PIN_COLOURS[base]) if kind.endswith("_dim") else PIN_COLOURS[base]
        # Pin rows: background and border in the node body colour, so they read as rows of the node.
        out.append(f"    classDef pin_{kind} fill:{BODY},stroke:{BODY},color:{colour}")
    for kind in sorted(classes):
        out.append(f"    class {','.join(classes[kind])} pin_{kind}")
    if edges:
        out += ["", "    %% Wire colours (dimmed and dashed between two nodes that aren't part of the change)"]
        groups = {}
        for index, (_, _, kind, old, _) in enumerate(edges):
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
        text = to_mermaid(diff, warnings, reference)
        for warning in warnings:
            print(f"{path.name}: {warning}", file=sys.stderr)
        table = path.with_suffix(".md")
        if text is None:
            # Nothing to draw, e.g. a new Blueprint with only its default events. A new Blueprint
            # still has to be created, so it gets a small table with its parent class instead.
            output.unlink(missing_ok=True)
            if first(diff, "old") == ["old", "none"]:
                table.write_text(creation_table(diff), encoding="utf-8", newline="\n")
                print(f"{path}: nothing to draw, wrote {table}")
            else:
                table.unlink(missing_ok=True)
                print(f"{path}: nothing to draw, no diagram written")
            continue
        table.unlink(missing_ok=True)
        output.write_text(text, encoding="utf-8", newline="\n")
        print(f"Wrote {output}")


def creation_table(diff):
    """Markdown table for a new Blueprint without anything to draw: just its parent class."""
    package = diff[1]
    name = package.rsplit("/", 1)[-1]
    parent_path = (first(diff, "parent") or ["parent", ""])[1]
    parent = parent_path.rsplit(".", 1)[-1].removesuffix("_C") or "Actor"
    return "\n".join([
        f"### {name} (Blueprint Class)",
        "",
        f"Create a new Blueprint Class named `{name}` in `{package.rsplit('/', 1)[0]}` with the parent class `{parent}`.",
        "",
        "| Setting | Value |",
        "|---|---|",
        f"| Parent Class | {parent} |",
        "",
    ])


if __name__ == "__main__":
    main()
