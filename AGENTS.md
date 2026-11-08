# Agent guide

This repo is the base for teaching Unreal Engine. Features are built in small
commits, and each change gets documentation that students follow step by step
to rebuild it themselves.

## Notes for agents

- Keep all lasting notes, rules and reminders in this file, not in a tool's
  local memory, so they live in the repo.
- Don't write lesson documentation until the user says documentation has
  started. Until then, diffs and diagrams are experiments.
- Open decision: `Doc/graph.sexpr` and `Doc/update_graph.py` are an earlier
  approach that snapshots the whole project for comparison. The
  `BlueprintDiffExport` plugin replaced it for Blueprints, so don't refresh the
  snapshot on commit, and ask the user before removing or reusing it. If it is
  used again, never fill it from `read_graph_dsl`: that tool drops Enhanced
  Input wiring and animation graphs, and appears to mark Blueprints as unsaved.

## Blueprint diffs

- Right-click a Blueprint in the Content Browser and choose
  **Export Diff Against Depot**. The `BlueprintDiffExport` plugin
  (`Plugins/BlueprintDiffExport`) compares the Blueprint in the editor with its
  last committed revision and writes `Doc/graph/transient/<package path>.sexpr`,
  for example
  `Doc/graph/transient/Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.sexpr`.
  The same export also writes the full current Blueprint, with all variables,
  graphs, nodes, pins and links, to `Doc/graph/reference/<package path>.sexpr`.
- Diagrams for a change go next to its diff, with the same base name and the
  `.mmd` extension. Generate them with
  `python Doc/sexpr_to_mermaid.py <file>.sexpr` instead of writing them by
  hand. The script applies the style rules below, and its palette constants
  are the one place to change colours. When a style rule changes, update the
  script too.
- The script draws added nodes. Changes it can't draw yet (removed or moved
  nodes, changed pin values) are printed on stderr.
- `node Doc/export_svg.mjs` renders every `.mmd` that git reports as
  untracked or changed to `Doc/commits/<YYYYMMDD_HHmmss>/<package path>.svg`,
  using the current local date and time. It needs `npm install` in `Doc/` once.
  It uses the Mermaid CLI pinned in `Doc/package.json` (10.9.1, the last
  version that supports Node 16) and the Chrome set in `Doc/puppeteer.json`
  instead of downloading Chromium.
- Never check out old binary assets to compare versions. Use the exported diff.

## Mermaid diagram style

Diagrams should look like the Blueprint editor, so students can match them to
what they see on screen.

### Layout

- Use `flowchart LR` with `curve: step` in the front matter config, so wires
  are drawn with horizontal and vertical segments only.
- Don't give the diagram a title.
- Each Blueprint node is a `subgraph`. Its title is the node header.
- Each connected pin is a row inside its node's subgraph. Inputs go on the left, outputs
  on the right; use invisible links (`~~~`) from inputs to outputs to keep that
  order.
- Wires connect pin rows, not whole nodes, except for pure getters (below).
- Leave out reroute nodes completely. Draw the wire directly from the pin
  feeding the reroute node to the pins it leads to.

### Node titles

- Getter nodes always start with `GET`, for example `GET Target Arm Length`.
- Setter nodes always start with `SET`, for example `SET Target Arm Length`.
- Math nodes use their full name from the diff, not the short symbol shown on
  the node, for example `float + float` instead of `+`.
- A node that existed before the change but is wired to a new node is drawn as
  a dashed grey placeholder titled `<node name> (existing)`.
- Other nodes use their editor title, for example
  `◆ EnhancedInputAction IA_Zoom` for an input event.

### Pure getters

- A pure getter with one output pin and at most one input pin has no pin rows,
  for example `GET Camera Boom` (no input) or `GET Target Arm Length`
  (one input). Wires connect to its subgraph directly.
- Operator nodes such as `float + float` have no pin rows either. Wires
  connect to the operator's subgraph directly.
- If all input and output pins of an operator have the same type, its border
  and title use that type's colour, for example green for `float + float`.
  Otherwise it keeps the operator border colour.
- Pure getter subgraphs have rounded corners (`rx:16px,ry:16px` in their
  `style`), and their border and title use the colour of their output pin type.

### Pins

- Use the pin's display name from the editor: `Target` for `self`,
  `Return Value`, `Action Value`.
- Leave out every pin that isn't connected, inputs and outputs alike.
- Pins are marked `▶` (exec) or `●` (data). Input pins put the marker before
  the name (`● A`); output pins put it after (`Return Value ●`).
- Exec pins use the flag shape (`>"Triggered ▶"]`). Data pins use rectangles.

### Colours

| Element | Colour |
|---|---|
| Node body | `#151515` |
| Input event header border | `#b3261e` |
| Setter header border | `#2b5d8f` |
| Operator border (mixed pin types) and other nodes | `#3a3a3a` |
| Existing node placeholder | `#555555`, dashed |
| Operator border and title (single pin type) | Colour of that pin type |
| Pure getter border and title | Colour of the output pin type |

Pins and wires use the Blueprint editor's default pin type colours, so
diagrams match what students see. Exec wires are 3px wide; data wires 2px.

| Pin type | Colour |
|---|---|
| Exec | `#ffffff` |
| Boolean | `#950000` |
| Byte | `#006f65` |
| Integer | `#1fe3af` |
| Integer64 | `#ace3af` |
| Float (single and double precision) | `#38d500` |
| Name | `#cd82ff` |
| String | `#ff00d4` |
| Text | `#e77caa` |
| Vector | `#ffca23` |
| Rotator | `#a0b4ff` |
| Transform | `#ff7300` |
| Object reference | `#00aaf5` |
| Other types | `#777777` until their editor colour is added |

These come from `UGraphEditorSettings` in the engine
(`Engine/Source/Editor/GraphEditor/Private/GraphEditorSettings.cpp`),
converted from linear to sRGB. Float pins use `RealPinTypeColor`, as the editor
does for both precisions. Some of these colours, such as Boolean, have low
contrast on the dark node body; see Planned.

Give pin rows the same fill and stroke as the node body so they read as rows,
not separate boxes. Colour pin rows with `classDef` and wires with `linkStyle`.
List the visible wires first and the invisible `~~~` links last, because
`linkStyle` indices count both.

## Planned

When we start exporting the documentation, raise this before writing the
exporter. The colours above are currently hard-coded in each diagram.

- One central place for colour configuration, used by every exported diagram.
  Mermaid can't import a shared stylesheet, so this needs a generator that
  writes the same `classDef` block into each file, or renderer config such as
  `mmdc --cssFile`.
- Colour-blind support, such as alternative palettes. The editor palette
  above relies on hues that are hard to tell apart with colour blindness,
  for example Float green vs Boolean red, or Integer vs Integer64. It also has
  low-contrast colours on the dark body, such as Boolean `#950000` and Byte
  `#006f65`.
- Ways to tell node types apart besides colour, such as outline thickness and
  dashed or dotted borders.
