# Agent guide

This repo is the base for teaching Unreal Engine. Features are built in small
commits, and each change gets documentation that students follow step by step
to rebuild it themselves.

## Notes for agents

- Keep all lasting notes, rules and reminders in this file, not in a tool's
  local memory, so they live in the repo.
- Don't write lesson documentation until the user says documentation has
  started. Until then, diffs and diagrams are experiments.
- Open decision: `Doc/update_graph.py` is an earlier approach that wrote a
  snapshot of the whole project (`Doc/graph.sexpr`, now deleted). The
  `BlueprintDiffExport` plugin replaced it for Blueprints, so don't run it on
  commit, and ask the user before removing or reusing the script. Never read
  Blueprints with `read_graph_dsl`: that tool drops Enhanced Input wiring and
  animation graphs, and appears to mark Blueprints as unsaved.

- Live Coding (Ctrl+Alt+F11, or `CompileLiveCoding` through the MCP) only
  patches the running editor. It doesn't update the plugin DLL on disk, so its
  changes are lost on restart, and it doesn't rerun startup code such as menu
  registration. After changing plugin code, close the editor and build
  (`Build.bat Platforming1Editor Win64 Development -Project=<uproject>`)
  before the next restart, and tell the user when a change needs that.

## Blueprint diffs

- Right-click a Blueprint in the Content Browser and choose
  **Export Diff Against Depot**. The `BlueprintDiffExport` plugin
  (`Plugins/BlueprintDiffExport`) compares the Blueprint in the editor with its
  last committed revision and writes `Doc/graph/transient/<package path>.sexpr`,
  for example
  `Doc/graph/transient/Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.sexpr`.
  The same export also writes the full current Blueprint, with all variables,
  graphs, nodes, pins and links, to `Doc/graph/reference/<package path>.sexpr`.
- The same menu entry works on other assets, such as Input Actions and Input
  Mapping Contexts. It writes an `asset-diff` of their changed properties, and
  a reference with all their non-default properties. A new asset (no committed
  revision) is compared against its class defaults, so the diff lists exactly
  what was set after creating it. Levels aren't supported yet.
- Non-Blueprint assets have no graph, so the lesson shows them as tables.
  Generate one with `python Doc/sexpr_to_table.py <file>.sexpr`; it writes a
  `.md` file next to the diff.
- Diagrams for a change go next to its diff, with the same base name and the
  `.mmd` extension. Generate them with
  `python Doc/sexpr_to_mermaid.py <file>.sexpr` instead of writing them by
  hand. The script applies the style rules below and takes its colours from
  the default palette in `Doc/palette.json`. When a style rule changes, update
  the script too.
- The script draws added nodes. Changes it can't draw yet (removed or moved
  nodes, changed pin values) are printed on stderr.
- `node Doc/export_svg.mjs` renders every `.mmd`, and every `.md` table under
  `Doc/graph/`, that git reports as untracked or changed to
  `Doc/commits/Transient/<package path>.svg`, overwriting earlier exports of
  the same file. SVGs are pretty-printed. Tables are drawn as SVG in the same
  dark style as diagrams. In every exported SVG, palette colours are CSS
  variables (`var(--pin-float)`), and the SVG carries the default palette at
  zero specificity (`:where(svg)`), so it looks the same on its own and a page
  can restyle it. It needs `npm install` in `Doc/` once. It uses the Mermaid
  CLI pinned in `Doc/package.json` (10.9.1, the last version that supports
  Node 16) and the Chrome set in `Doc/puppeteer.json` instead of downloading
  Chromium.
- Doc export: `node Doc/export_doc.mjs` copies `Doc/commits/Transient` to
  `Doc/commits/<YYYYMMDD_HHmmss>` (current local date and time; `Transient`
  stays) and writes `doc.html` there, a standalone dark page that embeds every
  SVG inline under a heading with its path. The SVG files stay next to it,
  named by package path (`Game/Input/Actions/IA_Zoom.svg` for
  `/Game/Input/Actions/IA_Zoom`). Inline SVGs get their IDs prefixed (`s1-`,
  `s2-`, ...) because every Mermaid diagram uses `my-svg`. The page has a
  colour palette switch (also `?palette=<name>`, remembered per browser).
  In headings and labels, paths starting with
  `/Game/` are shown as the Content Browser shows them:
  `All/Content/Input/Actions/IA_Zoom`. For a new asset (no previous revision)
  the heading is `Create <asset type> at <path>`, for example
  `Create Input Action at All/Content/Input/Actions/IA_Zoom`.
  The doc export also copies all of `Doc/graph/` (diffs, references, `.mmd`
  diagrams, `.md` tables) to `<export>/graph/`, so each export keeps the
  source data it was made from, in case its documents need regenerating.
  `--regenerate <export folder>` rewrites `doc.html` of an existing export and
  removes an outdated `doc.md` from before the switch to HTML.
- Every exported SVG carries a `<metadata>` block with a
  `<bde:asset xmlns:bde="urn:blueprint-diff-export" .../>` element, written by
  `export_svg.mjs` from the SVG's diff: `package`, `kind` (`blueprint` or
  `asset`), `class`, `type` (display name such as `Input Action`; Blueprints
  are `Blueprint Class`), `new`, `revision`, `source`, and for Blueprints
  `parent`. `export_doc.mjs` reads only this metadata, so each export folder
  describes itself without the diffs. Put any further per-asset facts the docs
  need into this block.
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

All colours live in `Doc/palette.json`, the one place to change them. Its
`default` palette is the Unreal editor look below, used by `.mmd` files and
built into every SVG. Each default colour must be unique, because
`export_svg.mjs` maps rendered colours back to their names; text is
`#f2f2f2` rather than white so it differs from exec pins. Other palettes
only apply in `doc.html` and only list the colours they change; colour
blindness doesn't matter for `.mmd` files:

| Palette | For | Notes |
|---|---|---|
| `red-green-safe` | protanopia, deuteranopia | Okabe-Ito based; float orange, object blue, boolean reddish purple |
| `blue-yellow-safe` | tritanopia | Float green and boolean red stay; object purple |
| `high-contrast` | low vision | Black node body, all key colours at least 7:1 contrast |
| `greyscale` | achromatopsia, print | 4 brightness levels: exec, float, object, boolean; rarer types share them |

Check palette changes with `node Doc/check_palette.mjs`, which simulates each
colour blindness (Machado 2009) and prints the closest pairs of key colours
(aim for 25+ for exec, float, object and boolean in the palette's target
vision), and visually with Chrome's vision deficiency emulation.

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
does for both precisions. Some of these colours, such as Boolean `#950000`
and Byte `#006f65`, have low contrast on the dark node body, and several are
hard to tell apart with red-green colour blindness (Float green vs Boolean
red or the event border); the `red-green-safe` palette addresses this.

Give pin rows the same fill and stroke as the node body so they read as rows,
not separate boxes. Colour pin rows with `classDef` and wires with `linkStyle`.
List the visible wires first and the invisible `~~~` links last, because
`linkStyle` indices count both.

## Planned

- Ways to tell node types apart besides colour, such as outline thickness and
  dashed or dotted borders. These could become CSS variables in
  `palette.json` like the colours, so `doc.html` can switch them too.
