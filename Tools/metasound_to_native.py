"""Turn the graph of a MetaSound asset diff into the text Unreal copies Blueprint nodes with, so the
doc shows it in the same viewer as the Blueprint graphs.

    python Tools/metasound_to_native.py <diff.sexpr>

The plugin exports a MetaSound as an `asset-diff` whose `RootMetasoundDocument RootGraph PagedGraphs`
property holds the nodes (name, pins, position) and their connections. This writes
`graph/native/<package path>.graph.MetaSound.txt` (the new graph) and, when the diff replaces an
earlier graph, `.old.txt`, next to the diff's `graph/transient` folder, in the format of the
Blueprint graphs (`export_doc.mjs`, `editorView`). The nodes are drawn as Blueprint nodes: a trigger
is an exec pin, an event for what starts the sound, a pin only when it is connected or has a value
typed in, and the nodes sit where they sit in the MetaSound editor.
"""

import hashlib
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
from sexpr_to_mermaid import first, parse  # noqa: E402

HEX = r"[0-9A-F]{32}"

# MetaSound data types as pins of a Blueprint graph (category, sub category, sub category object).
# Only the colour and the shape of the pin come from this, so the types read apart in the viewer.
SCALARS = {
    "Trigger": ("exec", "", None),
    "Float": ("real", "double", None),
    "Time": ("real", "double", None),
    "Int32": ("int", "", None),
    "Bool": ("bool", "", None),
    "String": ("string", "", None),
    "Enum": ("byte", "", None),
    "WaveAsset": ("object", "", "/Script/CoreUObject.Class'/Script/Engine.SoundWave'"),
    "Audio": ("struct", "", "/Script/CoreUObject.ScriptStruct'/Script/CoreUObject.Transform'"),
}


def pin_type(type_name):
    """Pin type properties for a MetaSound type name such as "Float", "WaveAsset:Array" or "Enum:Foo"."""
    base, _, rest = type_name.partition(":")
    category, sub, sub_object = SCALARS.get(base, ("object", "", "/Script/CoreUObject.Class'/Script/CoreUObject.Object'"))
    container = "Array" if rest == "Array" else "None"
    return (
        f'PinType.PinCategory="{category}",PinType.PinSubCategory="{sub}",'
        f'PinType.PinSubCategoryObject={f"{chr(34)}{sub_object}{chr(34)}" if sub_object else "None"},'
        f"PinType.PinSubCategoryMemberReference=(),PinType.PinValueType=(),PinType.ContainerType={container},"
        "PinType.bIsReference=False,PinType.bIsConst=False,PinType.bIsWeakPointer=False,PinType.bIsUObjectWrapper=False,"
        "PinType.bSerializeAsSinglePrecisionFloat=False"
    )


def split_camel(name):
    """'RandomFloat' -> 'Random Float'; names with spaces stay as they are."""
    return name if " " in name else re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name)


def short_name(name):
    """The name of a pin or node the way the MetaSound editor shows it: 'UE.Source.OneShot.OnFinished'
    -> 'On Finished', 'UE.OutputFormat.Mono.Audio:0' -> 'Audio'."""
    if not name.startswith("UE."):
        return split_camel(name)
    last = name.split(":")[0].split(".")[-1]
    return split_camel(last)


def pin_id(node, vertex):
    return hashlib.md5(f"{node}{vertex}".encode()).hexdigest().upper()


def paged_graph(value):
    """The nodes and edges of a PagedGraphs value."""
    body = value[value.index("Nodes=(") + 7 : value.index("Edges=(")] if "Nodes=(" in value and "Edges=(" in value else ""
    nodes = []
    for chunk in re.split(rf"(?=\(ID={HEX},ClassID=)", body):
        head = re.match(rf'\(ID=({HEX}),ClassID=({HEX}),Name="([^"]*)"', chunk)
        if not head:
            continue
        outputs_at = chunk.find("Outputs=(")
        inputs_part = chunk[:outputs_at] if outputs_at > 0 else chunk
        outputs_part = chunk[outputs_at:] if outputs_at > 0 else ""
        pin = rf'\(Name="([^"]*)",TypeName="([^"]*)",VertexID=({HEX})'
        literals = dict(re.findall(rf"\(VertexID=({HEX}),Value=\(Type=\w+,As\w+=\(([^)]*)\)\)", chunk))
        position = re.search(r"\(X=(-?[\d.]+),Y=(-?[\d.]+)\)", chunk)
        nodes.append({
            "id": head.group(1),
            "class": head.group(2),
            "name": head.group(3),
            "inputs": re.findall(pin, inputs_part),
            "outputs": re.findall(pin, outputs_part),
            "literals": literals,
            "x": int(float(position.group(1))) if position else 0,
            "y": int(float(position.group(2))) if position else 0,
        })
    edges = re.findall(rf"FromNodeID=({HEX}),FromVertexID=({HEX}),ToNodeID=({HEX}),ToVertexID=({HEX})", value)
    return nodes, edges


def class_infos(dependencies):
    """The classes the document's nodes are made from, by class ID: {"type": Input | Output | External,
    "name", "variant"}. The editor takes its node titles from these."""
    infos = {}
    for chunk in re.split(rf"(?=\(ID={HEX},Metadata=)", dependencies or ""):
        head = re.match(rf'\(ID=({HEX}),Metadata=\(ClassName=\(([^)]*)\)', chunk)
        if not head:
            continue
        fields = dict(re.findall(r'(\w+)="([^"]*)"', head.group(2)))
        kind = re.search(r"Type=(\w+)", chunk[head.end():head.end() + 300])
        infos[head.group(1)] = {"type": kind.group(1) if kind else "", "name": fields.get("Name", ""), "variant": fields.get("Variant", "")}
    return infos


def node_title(node, info):
    """The node's title from the node's class in the export: 'Input' and 'Output' for the nodes of
    the graph's interface, the class name, and its variant in brackets ('Random Get (WaveAsset:Array)')."""
    kind = (info or {}).get("type")
    if kind in ("Input", "Output"):
        return kind
    if kind == "External":
        title = split_camel(info["name"])
        return f"{title} ({info['variant']})" if info["variant"] else title
    return short_name(node["name"])


def interface_pin_label(node_name):
    """The pin of an interface input or output: 'UE.Source.OnPlay' -> 'On Play (UE.Source)' (the member,
    then its interface); a graph input keeps its name."""
    if not node_name.startswith("UE."):
        return node_name
    interface, _, member = node_name.rpartition(".")
    return f"{split_camel(member.split(':')[0])} ({interface})"


def without_internal_nodes(nodes, edges, infos):
    """Drops the nodes the editor doesn't draw: the `Input` template (a dependency of Type=Template)
    passes a value on, where a Reroute template (also a Template) is a node the student placed. The
    wires are joined: the source goes straight to what it fed."""
    internal = {n["id"] for n in nodes if infos.get(n["class"], {}).get("type") == "Template" and infos[n["class"]]["name"] == "Input"
                and len(n["inputs"]) == 1 and len(n["outputs"]) == 1}
    edges = list(edges)
    for node_id in internal:
        incoming = [e for e in edges if e[2] == node_id]
        outgoing = [e for e in edges if e[0] == node_id]
        edges = [e for e in edges if e[0] != node_id and e[2] != node_id]
        edges += [(a[0], a[1], b[2], b[3]) for a in incoming for b in outgoing]
    return [n for n in nodes if n["id"] not in internal], edges


def native_text(value, dependencies=None):
    """The Blueprint text for a PagedGraphs value, or None if it has no nodes."""
    nodes, edges = paged_graph(value)
    infos = class_infos(dependencies)
    nodes, edges = without_internal_nodes(nodes, edges, infos)
    if not nodes:
        return None
    by_id = {n["id"]: n for n in nodes}
    links = {}  # (node, vertex) -> [(node, vertex)] on the other side
    for from_node, from_vertex, to_node, to_vertex in edges:
        links.setdefault((from_node, from_vertex), []).append((to_node, to_vertex))
        links.setdefault((to_node, to_vertex), []).append((from_node, from_vertex))

    def is_reroute(node):
        return len(node["inputs"]) == 1 and len(node["outputs"]) == 1 and node["name"] == "Reroute"

    def connected(node, side):
        return any((node["id"], vertex) in links for _, _, vertex in node[side])

    def is_start(node):
        """What starts a branch: On Play, a graph input. Its input pins (the interface lists both) aren't wired."""
        return not connected(node, "inputs") and connected(node, "outputs")

    # Graph inputs have no place in the document (the MetaSound editor keeps them elsewhere), so the
    # nodes that start a branch are stacked in a column left of everything else.
    starts = [node for node in nodes if is_start(node) and not is_reroute(node)]
    others = [node for node in nodes if node not in starts]
    left = min((node["x"] for node in others), default=0) - 280
    top = min((node["y"] for node in others), default=0)
    for row, node in enumerate(starts):
        node["x"], node["y"] = left, top + 110 * row

    # Node names: K2Node_<kind>_<n>, in the order of the file.
    names = {}
    for index, node in enumerate(nodes):
        kind = "Knot" if is_reroute(node) else "CustomEvent" if is_start(node) else "CallFunction"
        names[node["id"]] = f"K2Node_{kind}_{index}"

    def pin_line(node, vertex, name, type_name, direction):
        linked = ",".join(f"{names[n]} {pin_id(n, v)}" for n, v in links.get((node["id"], vertex), []) if n in names)
        default = node["literals"].get(vertex)
        parts = [f"PinId={pin_id(node['id'], vertex)}", f'PinName="{name}"']
        if direction == "out":
            parts.append('Direction="EGPD_Output"')
        parts.append(pin_type(type_name))
        if default is not None and direction == "in":
            parts.append(f'DefaultValue="{default}"')
        if linked:
            parts.append(f"LinkedTo=({linked},)")
        parts.append("PersistentGuid=00000000000000000000000000000000,bHidden=False,bNotConnectable=False,"
                     "bDefaultValueIsReadOnly=False,bDefaultValueIsIgnored=False,bAdvancedView=False,bOrphanedPin=False,")
        return "   CustomProperties Pin (" + ",".join(parts) + ")"

    out = []
    for node in nodes:
        info = infos.get(node["class"])
        title = node_title(node, info)
        name = names[node["id"]]
        knot = is_reroute(node)
        if knot:
            cls = "K2Node_Knot"
            header = []
        elif is_start(node):
            cls = "K2Node_CustomEvent"  # an Input node of the graph: On Play, a graph input
            header = [f'   CustomFunctionName="{title}"']
        else:
            cls = "K2Node_CallFunction"
            header = [f'   FunctionReference=(MemberName="{title}")']
        lines = [f'Begin Object Class=/Script/BlueprintGraph.{cls} Name="{name}"', *header,
                 f"   NodePosX={node['x']}", f"   NodePosY={node['y']}",
                 f"   NodeGuid={pin_id(node['id'], 'node')}"]
        # Only pins that are connected or have a value typed in, like the diagrams of the Blueprints.
        for vertex_list, direction in ((node["inputs"], "in"), (node["outputs"], "out")):
            for pin_name, type_name, vertex in vertex_list:
                if (node["id"], vertex) in links or (direction == "in" and vertex in node["literals"]):
                    interface_node = (info or {}).get("type") in ("Input", "Output")
                    shown = ("InputPin" if direction == "in" else "OutputPin") if knot else (
                        interface_pin_label(node["name"]) if interface_node else short_name(pin_name))
                    lines.append(pin_line(node, vertex, shown, type_name, direction))
        lines.append("End Object")
        out.append("\n".join(lines))
    return "\n".join(out) + "\n"


def property_value(diff, name, which):
    """The old or new value of a changed property of an asset diff, or None."""
    for entry in (first(diff, "properties") or ["properties"])[1:]:
        if isinstance(entry, list) and len(entry) > 1 and entry[0] == "changed" and entry[1] == name:
            part = first(entry, which)
            return part[1] if part else None
    return None


LITERAL_CHANGE = re.compile(r"RootMetasoundDocument RootGraph PagedGraphs\[0\] Nodes\[(\d+)\] InputLiterals\[(\d+)\] Value As\w+\[0\]$")


def reference_graph(graph_root, diff):
    """(PagedGraphs value, Dependencies value) of the MetaSound's full export (graph/reference), or None."""
    file = graph_root / "reference" / (diff[1].lstrip("/") + ".sexpr")
    if not file.exists():
        return None
    properties = (first(parse(file.read_text(encoding="utf-8")), "properties") or ["properties"])[1:]
    value = lambda name: next((e[2] for e in properties if isinstance(e, list) and len(e) > 2 and e[1] == name), None)
    graph = value("RootMetasoundDocument RootGraph PagedGraphs")
    return (graph, value("RootMetasoundDocument Dependencies") or "") if graph else None


def old_graph(value, diff):
    """The PagedGraphs value before the diff's single-value changes: the new values replaced by the old ones."""
    nodes, _ = paged_graph(value)
    for entry in (first(diff, "properties") or ["properties"])[1:]:
        match = isinstance(entry, list) and len(entry) > 1 and LITERAL_CHANGE.search(entry[1])
        old, new = (first(entry, "old"), first(entry, "new")) if match else (None, None)
        if not (match and old and new and int(match.group(1)) < len(nodes)):
            continue
        node = nodes[int(match.group(1))]
        vertices = list(node["literals"])
        if int(match.group(2)) >= len(vertices):
            continue
        pattern = re.compile(rf"(\(VertexID={vertices[int(match.group(2))]},Value=\(Type=\w+,As\w+=\(){re.escape(new[1])}(\)\)\))")
        value = pattern.sub(lambda m: m.group(1) + old[1] + m.group(2), value, count=1)
    return value


def write_native(diff_path):
    """Write graph/native/<package path>.graph.MetaSound(.old).txt for a MetaSound diff; the files written."""
    diff = parse(diff_path.read_text(encoding="utf-8"))
    if not (isinstance(diff, list) and diff[0] == "asset-diff" and (first(diff, "class") or [0, ""])[1].startswith("MetaSound")):
        return []
    package = diff[1].lstrip("/")
    preset = "PresetTemplate(Parent=" in (property_value(diff, "RootMetasoundDocument Template", "new") or "")
    graph_root = diff_path
    while graph_root.name != "graph":
        graph_root = graph_root.parent
    target = graph_root / "native" / (package + ".graph.MetaSound")
    target.parent.mkdir(parents=True, exist_ok=True)
    written = []
    from_reference = None
    if property_value(diff, "RootMetasoundDocument RootGraph PagedGraphs", "new") is None and not preset:
        # Only single values changed (a node's typed-in number): the diff names them by position, so the
        # new graph is the one in the full export, and the old one is that with the values put back.
        from_reference = reference_graph(graph_root, diff)
    for which, suffix in (("new", ".txt"), ("old", ".old.txt")):
        value = property_value(diff, "RootMetasoundDocument RootGraph PagedGraphs", which)
        dependencies = property_value(diff, "RootMetasoundDocument Dependencies", which) or property_value(diff, "RootMetasoundDocument Dependencies", "new")
        if from_reference:
            value, dependencies = from_reference[0] if which == "new" else old_graph(from_reference[0], diff), from_reference[1]
        text = native_text(value, dependencies) if value and not preset else None  # a preset's graph is its parent in a box
        path = target.parent / (target.name + suffix)
        if text:
            path.write_text(text, encoding="utf-8", newline="\n")
            written.append(path)
        else:
            path.unlink(missing_ok=True)
    return written


def main():
    for argument in sys.argv[1:]:
        for path in write_native(Path(argument).resolve()):
            print(f"Wrote {path}")


if __name__ == "__main__":
    main()
