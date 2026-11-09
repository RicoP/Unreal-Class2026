# Agent guide

This repo is the base for teaching Unreal Engine. Features are built in small
commits, and each change gets documentation that students follow step by step
to rebuild it themselves.

## Notes for agents

- Keep all lasting notes, rules and reminders in this file, not in a tool's
  local memory, so they live in the repo.
- Don't write lesson documentation until the user says documentation has
  started. Until then, diffs and diagrams are experiments.
- Open decision: `Tools/update_graph.py` is an earlier approach that wrote a
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

- Workflow: all documentation work in progress lives in `Doc/commits/Transient/`
  (ignored by git). The editor plugin writes diffs to
  `Transient/graph/transient/` and full versions to `Transient/graph/reference/`;
  `node Tools/export_doc.mjs` generates diagrams, tables, SVGs and `doc.html`
  inside `Transient`. When the user says the step is done,
  `node Tools/export_doc.mjs --finish` renames `Transient` to
  `Doc/commits/<YYYYMMDD_HHmmss>`, which gets committed; the next step starts
  with a new `Transient`. "Commit the doc" means exactly that: build
  (`node Tools/export_doc.mjs`), finish (`--finish`), and commit the dated folder
  together with the assets it documents.
- Right-click a Blueprint in the Content Browser and choose
  **Export Diff Against Depot**. The `BlueprintDiffExport` plugin
  (`Plugins/BlueprintDiffExport`) compares the Blueprint in the editor with its
  last committed revision and writes `Doc/commits/Transient/graph/transient/<package path>.sexpr`,
  for example
  `Doc/commits/Transient/graph/transient/Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.sexpr`.
  The same export also writes the full current Blueprint, with all variables,
  graphs, nodes, pins and links, to `Doc/commits/Transient/graph/reference/<package path>.sexpr`.
- A Blueprint diff also has `(defaults ...)`, the Class Defaults that changed
  (for a new Blueprint: those that differ from the parent class, marked
  `(baseline parent-class)`), and `(components ...)`: components of the C++
  parent (`kind native`, e.g. a Character's `Mesh` with a mesh assigned and
  rotated), components added in the Components panel (`kind added`, with
  `attach-to`, and `(new)` when added since the last revision) and components
  of a parent Blueprint changed here (`kind inherited`), each with its changed
  properties, plus `component-removed`. References to the Blueprint's own
  sub-objects (component pointers) are left out. The reference file lists all
  defaults and components that differ from the parent class.
  `sexpr_to_table.py` turns these into `<name>.settings.md` next to the
  diagram ("Create a new Blueprint Class ..., then set:" with the parent class
  first, or "change its class defaults and components" with Before/After);
  rows read `Class Defaults › <setting>` and `<component> › <setting>`.
  A new Blueprint's heading is `Create New <parent class> Blueprint at <path>`
  (e.g. `Create New Character Blueprint at All/Content/App/Enemy/BP_Enemy_Base`),
  or, when the parent is a Blueprint of this project (`/Game/...`),
  `Create Child Blueprint of <parent> with the name <name>` (no folder: children
  are assumed to sit in their parent's folder). `doc.html` has no page heading,
  only the palette switch.
  Components are named as the Components panel shows them: a C++ parent's
  component by the property that holds it (`Mesh`, `CharacterMovement`, not
  `CharacterMesh0`, `CharMoveComp`). Tables drop the boolean `b` prefix, show
  CamelCase enum values as words (`Placed In World Or Spawned`), and skip
  older properties that sit next to their replacement (`SkeletalMesh` next to
  `SkeletalMeshAsset`, see `SUPERSEDED` in `sexpr_to_table.py`). In
  `doc.html` this table comes before the graph: the create heading below (or
  "<path>: Class Defaults and Components"), then "<path>: Graph".
  SVG metadata has `part="settings"` or `part="graph"` for Blueprints.
- The same menu entry works on other assets, such as Input Actions and Input
  Mapping Contexts. It writes an `asset-diff` of their changed properties, and
  a reference with all their non-default properties. A new asset (no committed
  revision) is compared against its class defaults, so the diff lists exactly
  what was set after creating it. Levels aren't supported yet.
- Actors placed in a level that stores each actor in its own file (the
  `__ExternalActors__` files of a World Partition level) can be exported one
  by one: right-click them in the Outliner or the viewport and choose
  **Export Diff Against Depot** (shown only for such actors). It writes an
  `actor-diff` to `Doc/commits/Transient/graph/transient/<level package path>/<actor label>.sexpr`,
  for example `Doc/commits/Transient/graph/transient/Game/ThirdPerson/Lvl_ThirdPerson/BP_Enemy_Variant1.sexpr`,
  with label, class, level, actor file and transform, plus an `actor` reference
  under `Doc/commits/Transient/graph/reference/`. A new actor is compared against its class
  defaults; a changed one against the last committed version of its file
  (loaded the way the editor's own changelist diff does). Whole-level export
  isn't planned: only the actors that matter for a lesson get exported.
  `sexpr_to_table.py` turns an actor diff into a table: a new actor gets
  "Place a <type> in the level <level>" with Location, Rotation (left out when
  zero) and Scale, then its set properties; a changed actor gets
  "Select <label> ... and change" with Before/After rows. Properties that only
  point at the actor's own sub-objects (its components, a volume's brush
  builder, `Default__…` values) are left out. In SVG metadata actors have
  `kind="actor"`, `package` = the level, and `label`; `doc.html` headings read
  "Place <type> [named <label>] in <level>" or "Change <label> in <level>".
- Imported assets (meshes, animations, textures from FBX, glTF, ...): their
  `asset-diff` has `(imported-from "<source file>")` and, for imports through
  Interchange, `(import-options (set "<pipeline sub-object> <option>" value) ...)`
  with the import dialog settings that differ from the pipeline defaults (for
  example the Skeleton to use, or Import Animations off). The doc documents
  imports per step, not per asset: `sexpr_to_table.py` skips imported assets
  and the `<mesh>_Skeleton` / `<mesh>_PhysicsAsset` an import creates next to
  them, and writes one `<folder>/<first file>.import.md` per group of source
  files imported into the same folder with the same options: files, options,
  and what it creates. Options still at the value of Unreal's default import
  preset (`IMPORT_PRESET` in `sexpr_to_table.py`) and duplicates are left
  out, so only real changes show (Skeleton, Import Animations off, Parent
  Material). A texture the import brought along (`colormap.png`) counts
  towards that import step; the folder imported into is the one above the
  type subfolders the import creates (`SkeletalMeshes`, `Materials`,
  `Textures`, ...). Long lists read `18 in all: a, b, …, z`. Import steps come
  first in `doc.html`, before everything that may use them. Its first line is an
  `<!-- import: folder="..." files="..." -->` comment that `export_svg.mjs`
  turns into metadata (`kind="import"`); the heading reads "Import <file or
  N files> into <folder>". `export_doc.mjs` passes the whole
  `Transient/graph/transient` folder (`--all-in`) so groups see every diff.
- **Tools → Save Level Screenshot** (same "Documentation" section) captures
  the active level viewport in Game View (no grid, icons or gizmos; the
  previous view mode is restored) to
  `Doc/commits/Transient/<level package path>.png`, for example
  `Doc/commits/Transient/Game/ThirdPerson/Lvl_ThirdPerson.png`. Level geometry
  (boxes placed and scaled by hand) is documented this way instead of actor
  by actor. `doc.html` shows it under "Recreate the level geometry shown in
  <level path>", linked as an image file next to the page (not embedded).
- **Tools → Export Diffs of Changed Assets** (editor main menu, "Documentation"
  section) does the same for every project asset that revision control
  reports as new, added or modified, skipping levels and their `__External…`
  files. It refuses to run during a Play session, shows progress, and lists
  failures in the notification and the Output Log. If any assets or levels
  have unsaved changes, it first lists them in a message box and asks whether
  to export anyway (default: No), because revision control only sees saved
  files.
- Non-Blueprint assets have no graph, so the lesson shows them as tables.
  Generate one with `python Tools/sexpr_to_table.py <file>.sexpr`; it writes a
  `.md` file next to the diff.
- Diagrams for a change go next to its diff, with the same base name and the
  `.mmd` extension. Generate them with
  `python Tools/sexpr_to_mermaid.py <file>.sexpr` instead of writing them by
  hand. The script applies the style rules below and takes its colours from
  the default palette in `Tools/palette.json`. When a style rule changes, update
  the script too.
- The script merges the diff with the matching reference file
  (`Doc/commits/Transient/graph/transient/...` -> `Doc/commits/Transient/graph/reference/...`), the full current
  Blueprint, so it can draw everything connected to the change (see the style
  rules). Without a reference file it falls back to added nodes and their
  direct neighbours. Changes it can't draw (such as removed nodes) are printed
  on stderr.
- `node Tools/export_svg.mjs` renders every `.mmd` and `.md` table under
  `Doc/commits/Transient/graph/transient/` to
  `Doc/commits/Transient/<package path>.svg`. An SVG newer than its source,
  its diff, `export_svg.mjs` and `palette.json` is skipped (`--force` renders
  all), and SVGs whose source is gone are removed. With file arguments
  (`node Tools/export_svg.mjs a.mmd b.md`) it renders exactly those files instead
  and writes each SVG next to its source.
  SVGs are pretty-printed. Tables are drawn as SVG in the same
  dark style as diagrams. In every exported SVG, palette colours are CSS
  variables (`var(--pin-float)`), and the SVG carries the default palette at
  zero specificity (`:where(svg)`), so it looks the same on its own and a page
  can restyle it. It needs `npm install` in `Tools/` once. It uses the Mermaid
  CLI pinned in `Tools/package.json` (10.9.1, the last version that supports
  Node 16) and the Chrome set in `Tools/puppeteer.json` instead of downloading
  Chromium.
- Doc export: `node Tools/export_doc.mjs` builds everything in
  `Doc/commits/Transient`: it runs `sexpr_to_mermaid.py` on every
  `blueprint-diff` and `sexpr_to_table.py` on every other diff in
  `Transient/graph/transient`, then `export_svg.mjs`, and writes
  `Transient/doc.html`. It decides by file timestamps what to regenerate: a
  `.mmd` or `.md` only when its diff (or reference) is newer or it doesn't
  exist yet, so diagrams and tables the user edited by hand survive until the
  asset is exported again. Generator script changes don't count; after a style
  rule changes, run `node Tools/export_doc.mjs --force` (regenerates and
  re-renders everything, overwriting hand edits; ask the user first if they
  edited files). `doc.html` is always rewritten. It is a standalone dark page that embeds every
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
  `node Tools/export_doc.mjs --finish` renames `Transient` to
  `Doc/commits/<YYYYMMDD_HHmmss>` (current local date and time) and rewrites
  its `doc.html` title; run it only when the user says the step is done. The
  dated folder keeps its `graph/` source data, in case its documents need
  regenerating. `--regenerate <export folder>` rewrites `doc.html` of an
  existing export and removes an outdated `doc.md` from before the switch to
  HTML.
- Layout: `Tools/` holds every documentation tool (Python and Node scripts,
  `palette.json`, `package.json`, `node_modules`, `doc.js`); `Doc/` is the
  documentation website itself and contains only generated files:
  `Doc/index.html`, `Doc/doc.js`, `Doc/steps.json` and the steps in
  `Doc/commits/<YYYYMMDD_HHmmss>/` (plus `Doc/commits/Transient`, ignored by
  git). `export_doc.mjs` rewrites the three root files on every run (`--site`
  writes only them): `index.html` lists the finished steps in order, oldest
  first, as `Step 1`, `Step 2`, ... (the folder dates only give the order and
  aren't shown) with their section headings; `doc.js` is copied from
  `Tools/doc.js`; `steps.json` is the step folders in order.
- Every `doc.html` ends with `<script src="../../doc.js"></script>` and has
  no inline script (`export_doc.mjs` writes it; older exports were changed by
  hand). `doc.js`: (1) the colour palette switch (applies the page's
  `<select id="palette">`, remembers the choice in localStorage
  `doc-palette`, accepts `?palette=<name>`), on disk and online; (2) step
  navigation: fetches `steps.json` next to itself (no globals) and puts a
  "‹ Step 2 · Step 3 of 4 · Step 4 ›" bar into the page's `<header>`
  (left/right arrow keys work too). Pages opened from disk can't fetch, so
  they show no bar.
- Website: `.github/workflows/pages.yml` publishes `Doc/` on GitHub Pages on
  every push to `main` that touches `Doc/` (or by hand, "Run workflow"),
  without `commits/Transient`, `graph/` folders and separate SVG files (the
  pages embed them). It fetches only `Doc/**` from Git LFS. The repository's
  Pages source must be "GitHub Actions" (Settings → Pages).
- Every exported SVG carries a `<metadata>` block with a
  `<bde:asset xmlns:bde="urn:blueprint-diff-export" .../>` element, written by
  `export_svg.mjs` from the SVG's diff: `package`, `kind` (`blueprint` or
  `asset`), `class`, `type` (display name such as `Input Action`; Blueprints
  are `Blueprint Class`), `new`, `revision`, `source` (the diff, relative to
  the export folder: `graph/transient/...`), and for Blueprints
  `parent`. `export_doc.mjs` reads only this metadata, so each export folder
  describes itself without the diffs. Put any further per-asset facts the docs
  need into this block.
- Never check out old binary assets to compare versions. Use the exported diff.

## Mermaid diagram style

Diagrams should look like the Blueprint editor, so students can match them to
what they see on screen.

### Layout

- Use `flowchart LR` with `curve: monotoneX` in the front matter config: soft
  curves that don't overshoot horizontally. (Other options in Mermaid 10:
  `basis`, `linear`, `step`, `stepBefore`, `stepAfter`, `bumpX`, `bumpY`,
  `monotoneY`, `cardinal`, `catmullRom`, `natural`, `bundle`.)
- Don't give the diagram a title.
- No drop shadows: the front matter sets `look: classic` and a `themeCSS`
  rule `filter: none` on nodes and clusters, because newer Mermaid
  previewers add shadows that Mermaid 10 (used for the SVGs) never draws.
- Each Blueprint node is a `subgraph`. Its title is the node header.
- Each connected pin is a row inside its node's subgraph. Inputs go on the left, outputs
  on the right; an invisible link (`~~~`) from every input to every output keeps
  that order.
- Every pin label is at least `PIN_COLUMN_WIDTH` (150 px, in
  `sexpr_to_mermaid.py`) wide, inputs aligned left and outputs right, so nodes
  with pin rows come out the same width. Mermaid has no subgraph width
  setting; this is the workaround. Longer labels still widen their node, and
  collapsed nodes stay compact.
- When a diagram has several graph boxes, each gets `direction LR`; otherwise
  Mermaid lays out a box whose nodes only link inside it top to bottom.
- Loops (a wire back to an earlier node, such as AI MoveTo's On Fail into a
  Delay) would make the layout reverse links and scramble pins. Loop wires are
  found by following wires from the leftmost node (a wire to a node still on
  the current path closes a loop), declared backwards without arrowhead
  (`target === source`), and marked with `%% back-edge <target> <source>`.
  `export_svg.mjs` reads those comments and puts the arrowhead on the target
  end. A plain `.mmd` preview shows loop wires without arrowhead, and the wire
  meets its output pin from the left.
- Wires connect pin rows, not whole nodes, except for pure getters (below).
- Leave out reroute nodes completely. Draw the wire directly from the pin
  feeding the reroute node to the pins it leads to.
- Don't draw wires from an event's delegate pin (for example a Custom Event
  wired into Set Timer by Event's `Delegate`). The pin it leads to reads
  `● Connect to Event <event name>` instead, and the event's delegate pin is
  left out. The event stays if it has other wires.
- Leave out event nodes and function entry nodes with nothing connected, such
  as the unused BeginPlay, ActorBeginOverlap, Tick and Construction Script of a
  new Blueprint. Also leave out an event or function entry that only calls its
  parent (all its wires go to one Parent call node that has no other wires,
  like a child Blueprint's default `Event Tick` -> `Parent: Tick`), together
  with that Parent call. A graph left empty gets no box; if nothing is left at
  all, no `.mmd` is written (and an old one is removed). A new Blueprint with
  nothing to draw gets a `.md` table instead ("Create a new Blueprint Class ...
  with the parent class ..."), so the doc still says to create it. The exported diffs keep these
  nodes; only the diagrams skip them.

### Node titles

- Getter nodes start with `GET`, for example `GET Target Arm Length`, unless
  their name already starts with `Get` or `Is` (`Get Camera Boom`,
  `Is Jumping`): no second prefix.
- Setter nodes start with `SET`, for example `SET Target Arm Length`, unless
  their name already starts with `Set`.
- Math nodes use their full name from the diff, not the short symbol shown on
  the node, for example `float + float` instead of `+`.
- Function names exported without spaces get them back
  (`GetPlayerCharacter` -> `Get Player Character`).
- The Self node is titled `Self` and collapsed like a pure getter (rounded, in
  the object colour). Only an input `self` pin is labelled `Target`.
- Draw every node connected to the change, according to the reference graph:
  start from the nodes the diff touches and follow wires in both directions
  (through reroutes) to the whole connected chain. All drawn nodes follow the
  usual rules (title, collapsing, pins, typed-in values).
- Nodes that are part of the diff are drawn normally: added nodes, and nodes
  with a real change such as a pin value or pin count. Rewiring changes the
  wire, not the nodes at its ends, and the engine's pin-matching noise (pin
  type changes between different pins of one node) doesn't count. All other
  nodes keep their usual colours (border, title, pin labels) but dimmed, with
  a dashed outline. Wires between two such nodes are dimmed and dashed too;
  wires that touch a changed node keep full colour.
- Other nodes use their editor title, for example
  `◆ EnhancedInputAction IA_Zoom` for an input event.

### Pure getters

- Pure nodes (any node without exec pins except events, function entries and
  result nodes, such as Get Player Character, Get Actor Location or Get
  Enhanced Input Local Player Subsystem) count as pure getters when they have
  one output and at most one shown input. They keep their editor title (no `GET`
  prefix). Pure functions with more inputs, such as Clamp, keep their pin rows
  and the `border-function` colour.
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
  `Return Value`, `Action Value`. Boolean pins drop their code prefix `b`
  (`bLooping` -> `Looping`).
- Leave out every pin that isn't connected, inputs and outputs alike, except
  unconnected input pins with a value typed in. Those show the value in a box
  instead of the dot (`[50] Min`), framed in the pin's colour via
  `currentColor` (Mermaid mangles `#` in label HTML). "Typed in" means not
  empty, zero, `false` or `None`; the diff has no engine defaults, so a value
  deliberately set to 0 isn't shown. Numbers drop trailing zeros
  (`50.000000` -> `50`), and asset or class paths become names
  (`/Game/Input/IMC_Default.IMC_Default` -> `IMC_Default`).
- Names are split into words before a capital that starts a word
  (`ActionValue` -> `Action Value`, `XAxis` -> `X Axis`); runs of capitals stay
  together (`iOS`).
- A node with such a value keeps its pin rows even if it would otherwise be
  collapsed (pure getter or operator), so the value stays visible.
- Pins are marked `▶` (exec) or `●` (data). Input pins put the marker before
  the name (`● A`); output pins put it after (`Return Value ●`).
- Exec pins use the flag shape (`>"Triggered ▶"]`). Data pins use rectangles.
- A node with at most one exec input pin (counting all exec inputs it has, not
  only connected ones) gets no row for it; the same applies separately to exec
  outputs. Such wires connect to the node's box itself (the subgraph). Raw
  Mermaid renders draw their arrowheads in dark grey, nearly invisible on the
  dark background; the SVG export colours them, so always judge diagrams from
  the exported SVG. Nodes with several exec outputs (Enhanced Input events,
  Branch, Sequence, Switch, AI MoveTo) keep their exec output rows, so the
  diagram shows which one is used.
- An exec pin shown as a row always has a name, even if only one of the
  node's exec pins is used. Names start with a capital (`Then 0`), `then` and
  `execute` become `Then` and `Execute`, and Branch's `then`/`else` are shown
  as `True`/`False` like in the editor.

### Colours

All colours live in `Tools/palette.json`, the one place to change them. Its
`default` palette is the Unreal editor look below, used by `.mmd` files and
built into every SVG. Each default colour must be unique, because
`export_svg.mjs` maps rendered colours back to their names; text is
`#f2f2f2` rather than white so it differs from exec pins. Other palettes
only apply in `doc.html` and only list the colours they change; colour
blindness doesn't matter for `.mmd` files:

| Palette | For | Notes |
|---|---|---|
| `red-green-safe` | protanopia, deuteranopia | Okabe-Ito based; float orange, object blue, boolean reddish purple; function calls sand `#b8a868` |
| `blue-yellow-safe` | tritanopia | Float green and boolean red stay; object purple; function calls `#4f7f8f` |
| `high-contrast` | low vision | Black node body, all key colours at least 7:1 contrast; function calls `#a8c8e8` |
| `greyscale` | achromatopsia, print | 4 brightness levels: exec, float, object, boolean; rarer types share them; function calls `#b8b8b8` |

Check palette changes with `node Tools/check_palette.mjs`, which simulates each
colour blindness (Machado 2009) and prints the closest pairs of key colours
(aim for 25+ for exec, float, object and boolean in the palette's target
vision), and visually with Chrome's vision deficiency emulation.

| Element | Colour |
|---|---|
| Node body | `#151515` |
| Input event header border | `#b3261e` |
| Setter header border | `#2b5d8f` |
| Function calls (`border-call`): function, parent and array calls, AI MoveTo, Create Widget, Spawn Actor and other async/latent call nodes (`CALL_CLASSES` in `sexpr_to_mermaid.py`) | `#456980` |
| Operator border (mixed pin types) and other nodes (`border-function`) | `#8a8a8a` |
| Operator border and title (single pin type) | Colour of that pin type |
| Pure getter border and title | Colour of the output pin type |
| Table grid lines (`border-neutral`) | `#3a3a3a` |
| Nodes and wires not part of the diff | Their usual colour, dimmed (`<name>-dim`), dashed |

Dimming is set in `palette.json` under `dim`: `amount` of the colour mixed
with `node-body` (currently 0.45), for the listed colours. `sexpr_to_mermaid.py`
writes the dimmed hex values; `export_svg.mjs` computes the same values (same
rounding), maps them to `var(--<name>-dim)` and defines those with
`color-mix()`, so every palette in `doc.html` dims automatically. Dimmed
default colours must also be unique.

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
| Delegate (event dispatcher, timer delegates) | `#ff3838` |
| Other types | `#777777` until their editor colour is added |

These come from `UGraphEditorSettings` in the engine
(`Engine/Source/Editor/GraphEditor/Private/GraphEditorSettings.cpp`),
converted from linear to sRGB. Float pins use `RealPinTypeColor`, as the editor
does for both precisions. Some of these colours, such as Boolean `#950000`
and Byte `#006f65`, have low contrast on the dark node body, and several are
hard to tell apart with red-green colour blindness (Float green vs Boolean
red or the event border); the `red-green-safe` palette addresses this.

Pin rows have the node body colour as background and border, so their borders
are invisible while their size (and so where wires attach) stays the same. Only
change how pin rows look, never their geometry: a smaller Mermaid `padding`
shrinks the rows to their text and moves wire anchor points. Colour pin rows with `classDef` and wires with `linkStyle`.

Node boxes with pin rows have no inner margin in exported SVGs. Mermaid can't
set this (dagre spaces pins away from the border), so `export_svg.mjs`
(`tightenNodeBoxes`) does it after rendering: each box shrinks to its title
and pin rows, the title is re-centred, wires ending on the box border are
extended to the new border, and the borders are drawn again on top, because
the pin rows' body-coloured fill would cover them. Titles keep at least
16 px (`TITLE_SIDE`) to each side. Plain `.mmd` previews still show the margin.

Wires attach like Blueprint wires, also done by `export_svg.mjs` because dagre
has no port sides: input rows sit flush with the left border and output rows
with the right one (their wires bend along); wires arrive at the left side
of what they lead to (an input row's middle, a box's title band, a collapsed
node's middle) and leave from the right side, curving in horizontally from
the last point of the route that is 40 px clear of that side. A forward wire
becomes a single editor-like curve unless that curve would cross another node
box; only then does it keep the layout's route. A wire that can't get to the
left side (it comes from further right) keeps the layout's route. Loop wires
are left alone.

Exec output rows (Sequence's `Then 0`, `Then 1`, Branch, Switch) are stacked
in pin order, top to bottom, like in the editor. Dagre sorts rows to reduce
crossings, so `sexpr_to_mermaid.py` writes `%% pin-order <row ids>` inside the
node's subgraph, and `export_svg.mjs` swaps the rows back into that order and
bends the first 60 px of their wires to the new position (wires may cross,
as in the editor). Plain `.mmd` previews may still show another order.

Events come before (left of) the nodes they trigger. Mermaid attaches a wire
to a node box to an arbitrary row of it, which could put an event right of
its node or spread a node's rows sideways. So nodes with pin rows get
invisible anchor rows (class `pin_anchor`): `<node>_anchor_in` in the input
column takes the wires of an omitted exec input, `<node>_anchor_out` in the
output column the wires of an omitted exec output, and a node with rows on one
side only gets an anchor on the other side. Anchors are linked with `~~~`
like rows. `export_svg.mjs` removes them and draws their wires to the box
border; plain `.mmd` previews show such exec arrows ending just inside the
box's left edge.
List the visible wires first and the invisible `~~~` links last, because
`linkStyle` indices count both.

## Planned

- Ways to tell node types apart besides colour, such as outline thickness and
  dashed or dotted borders. These could become CSS variables in
  `palette.json` like the colours, so `doc.html` can switch them too.
