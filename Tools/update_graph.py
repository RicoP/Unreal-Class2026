"""Write the project's assets, settings and Blueprint graphs to Doc/graph.sexpr.

Run with the Unreal editor open and all assets saved:

    python Tools/update_graph.py

The file is a text record of each commit, so two commits can be compared
without checking out binary assets:

    git diff HEAD~1 HEAD -- Doc/graph.sexpr

Settings are listed only where they differ from the engine or parent default.
Node positions sit on their own lines, so they can be left out of a diff:

    git diff -I"^ *\\(pos " HEAD~1 HEAD -- Doc/graph.sexpr
"""

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

MCP_URL = "http://127.0.0.1:8000/mcp"
OUTPUT = Path(__file__).with_name("graph.sexpr")
BLUEPRINT_TOOLS = "editor_toolset.toolsets.blueprint.BlueprintTools"
ASSET_TOOLS = "editor_toolset.toolsets.asset.AssetTools"
OBJECT_TOOLS = "editor_toolset.toolsets.object.ObjectTools"
ACTOR_TOOLS = "editor_toolset.toolsets.actor.ActorTools"

# Asset classes whose settings are recorded, besides Blueprints.
SETTINGS_CLASSES = {
    "InputAction",
    "InputMappingContext",
    "MaterialInstanceConstant",
}
# Properties that change on their own or repeat another property.
SKIP_PROPERTIES = re.compile(r"(guid|^mappings$|^bPressedJump$)", re.IGNORECASE)

session_id = None
request_id = 0
class_defaults = {}


def post(payload):
    global session_id
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    request = urllib.request.Request(
        MCP_URL, json.dumps(payload).encode("utf-8"), headers
    )
    with urllib.request.urlopen(request) as response:
        session_id = response.headers.get("Mcp-Session-Id", session_id)
        body = response.read().decode("utf-8")
    if "id" not in payload:
        return None
    if "text/event-stream" in response.headers.get("Content-Type", ""):
        data = [l[5:] for l in body.splitlines() if l.startswith("data:")]
        return json.loads(data[-1])
    return json.loads(body)


def rpc(method, params):
    global request_id
    request_id += 1
    reply = post(
        {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
    )
    if "error" in reply:
        raise RuntimeError(f"{method}: {reply['error']}")
    return reply["result"]


def call(toolset, tool, **arguments):
    result = rpc(
        "tools/call",
        {
            "name": "call_tool",
            "arguments": {
                "toolset_name": toolset,
                "tool_name": tool,
                "arguments": arguments,
            },
        },
    )
    text = result["content"][0]["text"]
    if result.get("isError"):
        raise RuntimeError(f"{tool}: {text}")
    return json.loads(text)["returnValue"]


def ref(path):
    return {"refPath": path}


def quote(text):
    escaped = str(text).replace("\\", "\\\\").replace('"', '\\"')
    return '"' + escaped.replace("\n", "\\n") + '"'


def atom(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return json.dumps(value)
    return quote(value)


def short_name(ref_path):
    return ref_path.rsplit(".", 1)[-1]


def object_path(asset_path):
    if "." in asset_path.rsplit("/", 1)[-1]:
        return asset_path
    return f"{asset_path}.{asset_path.rsplit('/', 1)[-1]}"


# --- Settings ---------------------------------------------------------------


def read_properties(path):
    """Return every readable property value on an object."""
    schema = json.loads(
        call(OBJECT_TOOLS, "list_properties", instance=ref(path)) or "{}"
    )
    names = [
        name
        for name, info in schema.items()
        if info and not SKIP_PROPERTIES.search(name)
    ]
    try:
        return json.loads(
            call(OBJECT_TOOLS, "get_properties", instance=ref(path), properties=names)
        )
    except RuntimeError:
        pass
    values = {}
    for name in names:
        try:
            values.update(
                json.loads(
                    call(
                        OBJECT_TOOLS,
                        "get_properties",
                        instance=ref(path),
                        properties=[name],
                    )
                )
            )
        except RuntimeError:
            pass
    return values


def flatten(prefix, value, out):
    if isinstance(value, dict) and set(value) != {"refPath"}:
        for key, item in value.items():
            flatten(f"{prefix}.{key}", item, out)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            flatten(f"{prefix}[{index}]", item, out)
    else:
        out[prefix] = value


def flat_properties(path):
    out = {}
    for name, value in read_properties(path).items():
        flatten(name, value, out)
    return out


def class_default_path(path):
    class_path = call(OBJECT_TOOLS, "get_class", instance=ref(path))["refPath"]
    package, name = class_path.rsplit(".", 1)
    return f"{package}.Default__{name}", name


def default_properties(default_path):
    if default_path not in class_defaults:
        try:
            class_defaults[default_path] = flat_properties(default_path)
        except RuntimeError:
            class_defaults[default_path] = {}
    return class_defaults[default_path]


def settings_lines(path, baseline_path, indent, visited):
    """List what differs from the baseline object, including inner objects."""
    visited.add(path)
    values = flat_properties(path)
    if baseline_path == class_defaults_key(path):
        baseline = default_properties(baseline_path)
    else:
        baseline = flat_properties(baseline_path)

    def normalize(value, root):
        if isinstance(value, dict):
            return {"refPath": value["refPath"].replace(root, "~")}
        return value

    sets, subs = [], []
    for key in sorted(values):
        value = values[key]
        inner = (
            value["refPath"]
            if isinstance(value, dict)
            and value["refPath"].startswith((path + ":", path + "."))
            else None
        )
        if inner:
            if inner in visited:
                continue
            other = baseline.get(key)
            other_path = (
                other["refPath"]
                if isinstance(other, dict) and ":" in other["refPath"]
                else class_defaults_key(inner)
            )
            lines = settings_lines(inner, other_path, indent + 1, visited)
            name = class_default_path(inner)[1]
            if lines or key not in baseline:
                subs.append(f"{'  ' * indent}(object {quote(key)} {quote(name)}")
                subs.extend(lines)
                subs[-1] += ")"
        elif normalize(value, path) != normalize(baseline.get(key), baseline_path):
            shown = value["refPath"] if isinstance(value, dict) else value
            sets.append(f"{'  ' * indent}(set {quote(key)} {atom(shown)})")
    for key in sorted(set(baseline) - set(values)):
        sets.append(f"{'  ' * indent}(unset {quote(key)})")
    return sets + subs


def class_defaults_key(path):
    return class_default_path(path)[0]


def component_lines(default_object, blueprint_root, visited):
    try:
        components = call(ACTOR_TOOLS, "get_components", actor=ref(default_object))
    except RuntimeError:
        return []
    lines = []
    for component in sorted(c["refPath"] for c in components):
        if component in visited or component.startswith(default_object + ":"):
            continue
        parent = call(ACTOR_TOOLS, "get_parent_component", component=ref(component))
        name = short_name(re.split(r"[.:]", component)[-1]).replace("_GEN_VARIABLE", "")
        _, class_name = class_default_path(component)
        parent_name = (
            re.split(r"[.:]", parent["refPath"])[-1].replace("_GEN_VARIABLE", "")
            if parent
            else ""
        )
        lines.append(
            f"  (component {quote(name)} {quote(class_name)} {quote(parent_name)}"
        )
        lines.extend(
            settings_lines(component, class_defaults_key(component), 2, visited)
        )
        lines[-1] += ")"
    return lines


# --- Graphs -----------------------------------------------------------------


def pin_key(pin_id):
    return (pin_id["node"]["refPath"], pin_id["direction"], pin_id["index_id"])


def graph_lines(graph_path):
    found = call(BLUEPRINT_TOOLS, "find_nodes", graph=ref(graph_path), title="")
    nodes = call(BLUEPRINT_TOOLS, "get_node_infos", nodes=found) if found else []

    pin_names = {}
    for node in nodes:
        for pin in node["input_pins"] + node["output_pins"]:
            pin_names[pin_key(pin["pin_id"])] = pin["name"]

    lines = []
    for node in sorted(nodes, key=lambda n: n["node"]["refPath"]):
        lines.append(
            f"    (node {short_name(node['node']['refPath'])} {quote(node['type_id'])}"
        )
        lines.append(f"      (pos {node['position']['x']} {node['position']['y']})")
        for direction, pins in (("in", node["input_pins"]), ("out", node["output_pins"])):
            for pin in pins:
                lines.append(
                    f"      (pin {direction} {quote(pin['name'])} {quote(pin['type_id'])})"
                )
        entries = []
        for pin in node["input_pins"]:
            if pin["value"] and not pin["connected_pins"]:
                entries.append(f"(set {quote(pin['name'])} {quote(pin['value'])})")
        # Each connection is listed once, from its output side.
        for pin in node["output_pins"]:
            for target in pin["connected_pins"]:
                target_pin = pin_names.get(pin_key(target), f"#{target['index_id']}")
                entries.append(
                    f"(link {quote(pin['name'])} "
                    f"{short_name(target['node']['refPath'])} {quote(target_pin)})"
                )
        lines.extend(f"      {entry}" for entry in sorted(entries))
        lines[-1] += ")"
    return lines


def blueprint_lines(asset_path):
    path = object_path(asset_path)
    name = asset_path.split(".")[0]
    lines = [f"(blueprint {quote(name)}"]
    blueprint = ref(path)

    parent = call(BLUEPRINT_TOOLS, "get_parent", blueprint=blueprint)
    parent_path = parent["refPath"] if isinstance(parent, dict) else str(parent)
    lines.append(f"  (parent {quote(parent_path)})")

    default_object = call(BLUEPRINT_TOOLS, "get_default_object", blueprint=blueprint)[
        "refPath"
    ]
    visited = set()
    package, class_name = parent_path.rsplit(".", 1)
    try:
        lines.append("  (defaults")
        lines.extend(
            settings_lines(
                default_object, f"{package}.Default__{class_name}", 2, visited
            )
        )
        lines[-1] += ")"
    except RuntimeError as error:
        lines[-1] = "  (defaults)"
        print(f"WARNING: no defaults for {name}: {error}", file=sys.stderr)
    lines.extend(component_lines(default_object, path, visited))

    variables = call(BLUEPRINT_TOOLS, "list_variables", blueprint=blueprint)
    lines.append(
        "  (variables" + "".join(f" {quote(v)}" for v in sorted(variables)) + ")"
    )
    graphs = call(BLUEPRINT_TOOLS, "list_graphs", blueprint=blueprint)
    for graph in sorted(g["refPath"] for g in graphs):
        lines.append(f"  (graph {quote(graph.rsplit(':', 1)[-1])}")
        lines.extend(graph_lines(graph))
        lines[-1] += ")"
    lines[-1] += ")"
    return lines


def asset_settings_lines(asset_path, class_name):
    path = object_path(asset_path)
    lines = [f"(settings {quote(asset_path)} {quote(class_name)}"]
    lines.extend(settings_lines(path, class_defaults_key(path), 1, set()))
    lines[-1] += ")"
    return lines


# --- Output -----------------------------------------------------------------


def main():
    rpc(
        "initialize",
        {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "update_graph", "version": "2.0"},
        },
    )
    post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    assets = sorted(
        a
        for a in call(ASSET_TOOLS, "find_assets", folder_path="/Game/", name="")
        if "/__External" not in a
    )
    classes = {a: call(ASSET_TOOLS, "get_asset_class", asset_path=a) for a in assets}
    blueprints = sorted(
        call(
            ASSET_TOOLS,
            "find_assets",
            folder_path="/Game/",
            name="",
            asset_type=ref("/Script/Engine.Blueprint"),
        )
    )
    for asset in assets:
        if call(ASSET_TOOLS, "is_dirty", asset_path=asset):
            print(f"WARNING: unsaved changes in {asset}", file=sys.stderr)

    sections = [
        "\n".join(f"(asset {quote(a)} {quote(classes[a])})" for a in assets)
    ]
    for asset in assets:
        if classes[asset] in SETTINGS_CLASSES:
            sections.append("\n".join(asset_settings_lines(asset, classes[asset])))
    for asset in blueprints:
        sections.append("\n".join(blueprint_lines(asset)))

    OUTPUT.write_text("\n\n".join(sections) + "\n", encoding="utf-8", newline="\n")
    print(f"Wrote {len(assets)} assets to {OUTPUT}")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach the editor at {MCP_URL}: {error}")
