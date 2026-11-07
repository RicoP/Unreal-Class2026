"""Write every project Blueprint graph to Doc/graph.sexpr as sorted, diffable text.

Run with the Unreal editor open and all assets saved:

    python Doc/update_graph.py

Node positions are left out so that moving a node doesn't count as a change.
"""

import json
import sys
import urllib.request
from pathlib import Path

MCP_URL = "http://127.0.0.1:8000/mcp"
OUTPUT = Path(__file__).with_name("graph.sexpr")
BLUEPRINT_TOOLS = "editor_toolset.toolsets.blueprint.BlueprintTools"
ASSET_TOOLS = "editor_toolset.toolsets.asset.AssetTools"

session_id = None
request_id = 0


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
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return '"' + escaped.replace("\n", "\\n") + '"'


def short_name(ref_path):
    return ref_path.rsplit(".", 1)[-1]


def object_path(asset_path):
    if "." in asset_path.rsplit("/", 1)[-1]:
        return asset_path
    return f"{asset_path}.{asset_path.rsplit('/', 1)[-1]}"


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
    lines = [f"(blueprint {quote(asset_path.split('.')[0])}"]
    variables = call(BLUEPRINT_TOOLS, "list_variables", blueprint=ref(path))
    lines.append(
        "  (variables" + "".join(f" {quote(v)}" for v in sorted(variables)) + ")"
    )
    graphs = call(BLUEPRINT_TOOLS, "list_graphs", blueprint=ref(path))
    for graph in sorted(g["refPath"] for g in graphs):
        lines.append(f"  (graph {quote(graph.rsplit(':', 1)[-1])}")
        lines.extend(graph_lines(graph))
        lines[-1] += ")"
    lines[-1] += ")"
    return lines


def main():
    rpc(
        "initialize",
        {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "update_graph", "version": "1.0"},
        },
    )
    post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    assets = sorted(
        call(
            ASSET_TOOLS,
            "find_assets",
            folder_path="/Game/",
            name="",
            asset_type=ref("/Script/Engine.Blueprint"),
        )
    )
    unsaved = [a for a in assets if call(ASSET_TOOLS, "is_dirty", asset_path=a)]
    for asset in unsaved:
        print(f"WARNING: unsaved changes in {asset}", file=sys.stderr)

    sections = ["\n".join(blueprint_lines(asset)) for asset in assets]
    OUTPUT.write_text("\n\n".join(sections) + "\n", encoding="utf-8", newline="\n")
    print(f"Wrote {len(assets)} Blueprints to {OUTPUT}")


if __name__ == "__main__":
    main()
