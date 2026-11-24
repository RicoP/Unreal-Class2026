# Agent guide

This repo is the base for teaching Unreal Engine. Features are built in small
commits, and each change gets documentation that students follow step by step
to rebuild it themselves.

## Notes for agents

- Keep all lasting notes, rules and reminders in this file, not in a tool's
  local memory, so they live in the repo.
- Don't write lesson documentation until the user says documentation has
  started. Until then, diffs and diagrams are experiments.
- "Commit and push" also means finishing the transient doc: rebuild
  (`node Tools/export_doc.mjs`), finish (`--finish`), and commit the dated
  step folder with the assets it documents, then push. The website only
  publishes finished steps, so an unfinished Transient never shows up there.
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
  A Blueprint class as a value reads as its Blueprint's name, like the
  editor's class pickers (`BP_Enemy_AIController`, not `..._C`).
  Variables come right after Parent Class: `Add Variable | Walk Speed (Float)`
  (name as typed, type without "(double-precision)"), then the Default Value
  (taken from the class-defaults entry, which is then left out), Category and
  Instance Editable rows only where they differ from a fresh variable;
  `Remove Variable | Old`; and `Variable <old name> › <field> | old | new` for
  changes. BlendSpace1D samples read `<animation> at Beginning of Blend` when
  X is 0 (an unset SampleValue is 0), `<animation> at End of Blend` when X is
  about `BlendParameters[0] Max` (100 unless the diff changes it; removed
  samples use the old Max), otherwise `<animation> at <X>`. Asset tables leave
  out `ASSET_BOOKKEEPING` (an animation's DataModelInterface, Controller and
  CommonTargetFrameRate) and changes that read the same before and after; plain
  numbers lose trailing zeros (`0.4`); a new asset with default settings reads
  "Create a new <class> … and keep its default settings" with the single row
  `All settings | Default` (`doc.html` drops tables without rows); an existing
  asset exported without changes gets no table at all. A montage's slot
  tracks aren't editable properties, so the plugin writes them as
  `MontageSlots` (`DefaultGroup.DefaultSlot: MM_Attack_01`, `AddMontageEntries`).
  Collision Responses are read like the editor's grid: a new Blueprint gets one
  row per component with the channels grouped by response in the grid's column
  order (`Ignore: Visibility, Camera · Overlap: Pawn`, or `Ignore: all
  channels`); a changed one gets a row per channel that changed
  (`<component> › Collision Responses › Camera | Block | Ignore`). Exported
  response lists only name channels that differ from their default, Block
  (`FCollisionResponse::UpdateArrayFromResponseContainer`), so unnamed ones are
  Block. A new Blueprint, or one that gets new components, also gets its
  component tree before the table, a `- name (type)` Markdown list indented
  two spaces per level (`Components:`), shown in `doc.html` as a nested list.
  It is built from the Blueprint's reference export and those of its
  Blueprint parents that are in the same export (so a child shows inherited
  components), with C++ parents' own attachments from `NATIVE_ATTACH`
  (Character: Mesh on the capsule); components of a C++ parent appear only
  when the Blueprint changes them. Scene components come first as a tree,
  then components without a place in it (e.g. Rotating Movement).
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
  `SkeletalMeshAsset`, see `SUPERSEDED` in `sexpr_to_table.py`). The plugin
  writes the name the Details panel shows for each property last in its entry,
  `(display "Actor Hidden in Game")` for `bHidden` (`FProperty::GetDisplayNameText`),
  and `entry_label` in `sexpr_to_table.py` uses it for the last part of a row's
  label (`Class Defaults › Actor Hidden in Game`). A name taken from a
  `DisplayName` in the engine's source keeps its spelling there ("Actor Hidden
  In Game") while the Details panel shows small words in lowercase, as the
  engine's own name conversion does ("Orient Rotation to Movement"), so
  `lower_small_words` applies that rule (In, As, To, Or, At, On, If, Be, By, The,
  For, And, With, When, From; never the first word); exports from before it keep
  the converted raw name, and the raw name stays what the script's
  special cases match (`SUPERSEDED`, `ASSET_BOOKKEEPING`, ...). In
  `doc.html` this table comes before the graphs: the create heading below (or
  "<path>: Class Defaults and Components"), then one section per graph,
  "<path>: EventGraph", "<path>: Function Set Target" (event graphs before
  functions' graphs; steps from before the split have one "<path>: Graph").
  Asset metadata has `part="settings"` (the table) or `part="graph"` (a
  diagram SVG, with `graph="<section title>"`) for Blueprints.
- A Blueprint diff lists its functions like its variables: `(functions
  (added|removed "<name>" (override ..) (pure ..) (const ..) (access ..)
  (category ..) (inputs (param "<name>" (type ..) (default ..)) ...)
  (outputs ...)) (changed (old ...) (new ...)))`, matched by name; the
  reference file has every function as `(function ...)`. The Construction
  Script isn't listed. `override true` means the parent class already has the
  function (Functions → Override, e.g. an AnimNotify's `Received_Notify`).
  `sexpr_to_table.py` writes them after the variables: `Add Function |
  GetWeaponHitBoxPoint` (name as typed, in a code span), then one
  `<name> › Add Input` / `Add Output` row per parameter (`Transform
  (Transform)`), and `Pure`, `Const`, `Access Specifier` and `Category` rows
  only where they differ from a fresh function; `Override Function | Received
  Notify` (no further rows: the parent decides the rest); `Remove Function`;
  `Rename Function | Old | New` for a removed and an added function with the
  same signature (`(renamed "Old" "New")` in the diff, `FunctionRenames` in the
  plugin: its old graph is compared with the new one, and the old native text
  is written as the new graph's `.old.txt`, so the editor view has a BEFORE);
  and `Function <name> › <field> | old | new` for changes (`Inputs` and
  `Outputs` as one list each). The function's graph is still drawn in the
  Blueprint's diagram.
- Notifies placed on an animation's or montage's timeline aren't editable
  properties either, so the plugin writes them as `AnimNotifies`
  (`AddAnimNotifyEntries`), in time order and separated by `; `:
  `BP_AnimNotify_Spawn_HitBox at 0.420 s (Actor To Spawn: BP_HitBox_Sword)`,
  a notify state `<class> from 0.200 s for 0.500 s`, a plain named notify by
  its name, or `none`. The brackets hold what was set on that placed notify
  (its editable properties that differ from its class defaults). The table
  row is `Notifies | <before> | <after>` (`SETTING_NAMES` in
  `sexpr_to_table.py`), with times trimmed (`0.42 s`). The section order
  puts the montage after the notify Blueprint it names.
- The bulk export doesn't count a changed level as a failure: its
  notification ends with "Changed levels left out (<names>): export their
  actors from the Outliner."
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
- References to an object's own sub-objects are left out of property diffs,
  so the plugin adds an asset's collision (its `BodySetup` sub-object, e.g.
  a static mesh's) by hand: `BodySetup CollisionPrimitives` (simple shapes
  counted per kind, "1 Box, 2 Convex Elements" or "no simple collision") and
  `BodySetup CollisionComplexity` (the editor's display name). The body
  setup's other data isn't listed (its GUID changes on every rebuild).
- Instanced sub-objects a component holds in an editable property (an AI
  Perception component's `SensesConfig` entries) are edited inside the
  component's Details panel, but a property diff only sees the reference to
  them. `AddInstancedSubobjectEntries` therefore adds their settings that
  differ from the matching old sub-object (same property and class) or their
  class defaults, named `<property> <class display name> <setting display
  name>` with `_` for spaces inside a part: `SensesConfig AI_Sight_config
  Sight_Radius`. The table reads `AI Perception › Senses Config › AI Sight
  config › Sight Radius` (`setting_name`: a part with `_` is a display name,
  only its `_` become spaces). Struct values drop the `b` of their fields
  (`Detect Enemies: True, ...`).
- `component-removed` is only written for components the Blueprint added
  itself. An inherited component whose override record disappeared (its
  overrides were reset, or the parent removed it) isn't a removal in the
  child.
- Imported assets (meshes, animations, textures from FBX, glTF, ...): their
  `asset-diff` has `(imported-from "<source file>")` and, for imports through
  Interchange, `(import-options (set "<pipeline sub-object> <option>" value) ...)`
  with the import dialog settings that differ from the pipeline defaults (for
  example the Skeleton to use, or Import Animations off). Only assets new in
  the step (`(old none)`) count as imports; one imported in an earlier step
  gets a normal "Open ... and change" table, or none if nothing changed. The
  doc documents imports per step, not per asset: `sexpr_to_table.py` skips imported assets
  and the `<mesh>_Skeleton` / `<mesh>_PhysicsAsset` an import creates next to
  them, and writes one `<folder>/<first file>.import.md` per group of source
  files imported into the same folder with the same options: files, options,
  and what it creates. Options still at the value of Unreal's default import
  preset (`IMPORT_PRESET` in `sexpr_to_table.py`) and duplicates are left
  out, so only real changes show (Skeleton, Import Animations off, Parent
  Material). Interchange sometimes also saves pipeline bookkeeping (`Results`,
  `CacheContextParam`, `BaseNodeContainer` pointing at numbered transient
  objects, `bAllowPropertyStatesEdition`); `IMPORT_BOOKKEEPING` drops it, or
  every file would look like its own import step. A texture the import brought along (`colormap.png`) counts
  towards that import step; the folder imported into is the one above the
  type subfolders the import creates (`SkeletalMeshes`, `Materials`,
  `Textures`, ...). Long lists read `18 in all: a, b, …, z`. Import steps come
  first in `doc.html`, before everything that may use them. Its first line is an
  `<!-- import: folder="..." files="..." -->` comment that `assetMetadata`
  (`Tools/doc_sources.mjs`) turns into metadata (`kind="import"`); the heading reads "Import <file or
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
  failures in the notification and the Output Log. Right-clicking a folder in
  the Content Browser (**Export Diffs of Changed Assets**, "Documentation"
  section) does the same for the changed assets in that folder and its
  sub-folders. Both leave out `/Game/Developers` (All/Content/Developers, everyone's test content)
  unless the folder you right-clicked is inside it. The "Documentation" sections are first in every menu they are
  in (Tools, asset, folder and actor context menus). If any assets or levels
  have unsaved changes, it first lists them in a message box and asks whether
  to export anyway (default: No), because revision control only sees saved
  files.
- A User Defined Struct and a Data Table get their contents in the diff
  (`AddTableInfo` in the plugin): `(struct-fields (field "Name" "Type") ...)` and
  `(data-table (row-struct "S_Row") (columns ...) (row "RowName" "value" ...) ...)`.
  `sexpr_to_table.py` shows them 1:1: a struct as a `Name | Type` table, a data
  table as `Row Name | <column> ...` with one line per row. The heading of a new
  data table reads `Create Data Table at <path> (of rowtype <struct>)`
  (`meta.rowtype`, from `assetMetadata`). Both need a re-export after the plugin
  is built.
- Default events (`K2Node_Event`: Event BeginPlay, ActorBeginOverlap, Tick, ...)
  that only lost their place in a change aren't part of the code to show: when
  such an event was removed, or was only moved (nothing else of it changed), and
  had no children before (a Parent call on it doesn't count; a Parent call that
  is connected to nothing is as idle), `editorView` in
  `export_doc.mjs` (`withoutIdleDefaultEvents`) takes it out of the Before and
  After texts, with its Parent call, so the editor view's change list doesn't
  list it. The same events, added with nothing attached (a new Blueprint's
  BeginPlay and Tick), are left out of the After text. Events that gained or
  lost children are kept.
- blueprintUE's diff view crashes while it writes its summary when a comment box
  was added, removed or changed (it reads a title such a node doesn't have), and
  then the summary list is empty. `withoutIdleDefaultEvents` therefore leaves
  those comment boxes out of both texts; unchanged ones stay. The renderer files
  stay as they are.
- A `doc.html` with more than one section starts with a `Contents` list
  (`<nav class="toc">`) of links to its sections: `writeDoc` gives every
  `<section>` an `id` made from its heading (made unique) and links to it.
  The headings stay plain `<h2>` without attributes, because the site index
  reads them. Finished steps get the list when they are regenerated.
- `Plugins/ColorBlindFriendlyBlueprints` (editor plugin, C++) switches the Blueprint editor's pin
  and node title colours between the documentation's palettes (`Tools/palette.json`, hard-coded
  in a table at the top of `Source/ColorBlindFriendlyBlueprintsSettings.cpp`; change both together): a dropdown
  (`EColorBlindPalette`) in Editor Preferences > Plugins > Color Blind Friendly Blueprints. It sets the colours of `UGraphEditorSettings`
  (`ApplyPalette`; the colour mapping is `Mappings()`) and redraws; a palette's `pin-*` and
  `border-event`/`border-call` colours are used, the rest is the editor's. After changing the
  plugin, close the editor and build it.
- Types named in tables get a dot (`◉`) in the colour of their pin before the
  name (`pinColorOf` / `withTypeDots` in `export_doc.mjs`, `.pin-dot` in
  `doc.css`, colours `--pin-*` from `palette.json`, so every palette applies):
  the cells of a `Type` column, a variable's type, and the `(Type)` of added
  variables, inputs and outputs. Basic types by name (Boolean, Integer, Float,
  ...), `... Object Reference`, `... Class Reference` (`pin-class`, deep purple),
  `... Interface Reference`, `... Structure` (`pin-struct`, deep blue). Other
  names get no dot. The class, struct and interface colours are the editor's
  `GraphEditorSettings`, converted to sRGB; the other palettes keep them.
- Third-party packs (Fab, itch.io) get an **Asset Origin Label**
  (`UAssetOriginLabel`, a `UPrimaryAssetLabel` in the BlueprintDiffExport plugin; Content Browser:
  Add > Miscellaneous > Data Asset) in their folder, with `URL` (where the folder's files come
  from) and `Whitelist` (asset classes; empty: all). The bulk export (Tools menu or folder
  menu) then handles that folder and its sub-folders (the deepest label counts) differently:
  files of a class that isn't whitelisted are left out entirely, the label itself isn't
  documented, new files aren't exported one by one but written as one `asset-origin` diff
  (`graph/transient/<label package path>.sexpr`: folder, label, url, `(file "<name>" "<class>")`),
  and changed (not new) whitelisted files get their usual diff. `sexpr_to_table.py`
  (`origin_markdown`) makes `<label>.md` from it: heading `Import <N files | the file> from
  <URL>`, a `Source` link row, a `Move To` row (`All/Content/Extern_Assets/`: the folder above the
  label's folder, since a pack lands in Content when added; left out when the label's
  folder is directly in Content) and one row per asset class with the names compacted
  (`27 in all: a, b, …, z`, `short_list`). In `doc.html` these steps come first, with the
  import steps (`kind="origin"` in `assetMetadata`). A cell that is only a web address becomes
  a link. Exporting a single asset from its context menu ignores labels. Every run of
  `export_doc.mjs` adds the files of an `asset-origin` diff (`(file "<name>" "<class>"
  "<package path>")`) that `Doc/asset_sources.json` doesn't list yet, with the label's URL
  (`updateAssetSourcesFromLabels`): existing entries are never changed, a label without a
  URL adds nothing, and diffs exported before the plugin wrote package paths are skipped. After changing the
  plugin, close the editor and build.
- Assets with a `Retarget Source Asset` set (retargeted animations) aren't
  documented one by one, and not as imports even though they keep their
  source's import data: `retarget_tables` in `sexpr_to_table.py` writes one
  `<folder>/<first asset>.retarget.md` per folder, asset type, skeleton and
  Retarget Source Asset (`Assets` as `N in all: a, b, …, z`, `Retarget Source
  Asset`, `Skeleton`, and `Retargeted from`, the originals listed the same way, when every name is
  `<original>_RETARGET` and the original's diff is in the step). Its first
  line is `<!-- retarget: folder="..." type="..." count="..." -->`
  (`assetMetadata`, `kind="retarget"`); the heading reads "Retarget <N>
  <type> assets in <folder>", and these sections come right after the
  import steps.
- Section order in `doc.html` (`dependencyOrder` in `export_doc.mjs`): import
  steps first, then every asset after the assets of the same doc it refers
  to, so students build what is needed before what needs it (`BP_Hero` before
  the notify that casts to it, a parent before its child, a Blueprint before
  the actor placed from it). Assets without such a link keep their order by
  path, and an asset's sections (settings, graph) stay together. References
  are read from the asset's full export (`graph/reference`, else its diff):
  another documented asset's name as a whole word (`Cast To BP_Hero`,
  `.../BP_Hero.BP_Hero_C`) or as the editor spells it in pin and variable
  types (`BP Hit Box Base Class Reference`); comment boxes and commit
  descriptions don't count. Assets that refer to each other can't both come
  first: a child still follows its parent, then the asset with the fewest
  open references goes next. A reference the plugin doesn't export (a
  montage's notifies) can't be ordered. Finished steps keep their order until
  regenerated (`--regenerate`).
- Asset tables in the same folder that are 100% the same (asset type, new or
  changed, and identical rows) are merged by `writeDoc` into one section where
  the first of them would be: "Change <N> <type> assets in <folder>" (or
  "Create ..."), the asset names in a `<p class="assets">`, then the table
  once. Anything that differs, even one row, keeps its own section; it doesn't
  split a group that sorts around it.
- Non-Blueprint assets have no graph, so the lesson shows them as tables.
  Generate one with `python Tools/sexpr_to_table.py <file>.sexpr`; it writes a
  `.md` file next to the diff.
- Editor views: a graph's section in `doc.html` shows the graph as the
  Blueprint editor draws it, instead of our own diagram (user decision: the
  before-and-after view already says what changed), with
  blueprintUE's renderer (`Doc/bue-render`: `render.js`, `render.css`,
  `diff.js`, `diff.css` and its MIT `LICENSE`, copied unchanged from
  `github.com/blueprintue/blueprintue-self-hosted-edition`, `www/bue-render`;
  the only copy, nothing generates it: the pages load it from there, and the
  Pages workflow publishes `Doc/` as it is. Update it by replacing these
  files, and keep our own changes in `Doc/doc.css` (styles) and `Doc/doc.js`
  (script), not in them). It draws from the
  text Unreal copies nodes with, which the plugin writes for every graph of
  an exported Blueprint (`WriteNativeGraphs`,
  `FEdGraphUtilities::ExportNodesToText`):
  `Doc/commits/Transient/graph/native/<package path>.graph.<graph>.txt`, and
  `.old.txt` for the last committed revision (its temporary package name
  replaced by the real one). The graph part of the name is the same as in the
  diagram's file name. `editorView` in `export_doc.mjs` embeds the texts in
  hidden textareas (so the page works from disk) under
  `<div class="editor-view">`, and `doc.js` starts
  `blueprintUE.render.Main(text, element, {height})`, or with an old text
  `blueprintUE.diff.Main(old, new, element, {height})`, its side-by-side
  comparison with a list of changes. The renderer sizes that list by its
  longest entry, which took a third of the view, so `Doc/doc.css` pins it
  to 150 px with smaller text (entries wrap; blueprintUE's own files stay
  unchanged). A view is `70vh` high (a share of the window, not pixels, so it
  is as big on every screen; the renderer puts the `height` option into a CSS
  `height:`), and in a diff the watermark of each pane reads BEFORE and AFTER
  (`doc.js` sets it from the start callback, because `diff.js` hands both
  panes the same options). The views are read-only: `doc.css` sets
  `pointer-events: none` on `.node`, so a node can't be grabbed, moved,
  selected or have its checkboxes and values changed (the renderer starts in
  read mode, so wires can't be drawn either); the arrows that fold a node's
  extra pins stay clickable. The renderer itself pans with the right mouse
  button only and draws a selection rectangle on a left drag; zooming needs
  Ctrl + wheel (a plain wheel only shows "Use ctrl + scroll to zoom" and
  scrolls the page, so a long page isn't trapped by the views; in fullscreen
  the wheel zooms). `doc.js` makes the left button pan: a capture-phase
  `mousedown` on the view hands a left press on the canvas (`.layer`, but not
  the fold arrows) to the renderer as a synthetic right-button press, which
  it then follows as the mouse moves (the right button still works). In a
  diff both panes move together until Lock / Unlock is switched. A caption
  `<p class="hint">` under each view's heading (`editorView`) tells students
  these controls. A page only loads the renderer when it
  has such a view. A graph without native text (steps exported before this)
  keeps showing its diagram SVG. The diagram is still generated and rendered
  for every graph, because the section, its heading (`%% graph`) and its place
  in the page come from it; only the page leaves it out. The renderer shows
  whole graphs with the editor's node positions and has none of our diagram
  rules (dimming, pure marks, palettes), so the rules under "Mermaid diagram
  style" only show in steps without editor views.
- Diagrams for a change go next to its diff, one per graph of the Blueprint:
  `<name>.graph.<graph>.mmd` (`BP_Enemy_Base.graph.EventGraph.mmd`,
  `BP_Enemy_Base.graph.Set_Target.mmd`; characters other than letters and
  digits in the graph's name become `_`), rendered to
  `<package path>.graph.<graph>.svg`. Each gets its own section in
  `doc.html`, so graphs of different sizes aren't stacked and centred in one
  drawing. The diagram's `%% graph <title>` line is its section title
  (`graph_title`): the graph's name, or for a function's graph `Function
  <name>` with ` (pure)` or ` (override)`, or `Construction Script`. A graph
  with nothing to draw gets no file, and files of an earlier run that aren't
  written again are removed, also the single `<name>.mmd` of steps from before
  the split (those steps keep working as they are). Generate them with
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
- `node Tools/export_svg.mjs` renders every `.mmd` diagram under
  `Doc/commits/Transient/graph/transient/` to
  `Doc/commits/Transient/<package path>.svg`. An SVG newer than its source,
  its diff, `export_svg.mjs`, `doc_sources.mjs` and `palette.json` is skipped
  (`--force` renders all), and SVGs whose source is gone are removed. With file
  arguments (`node Tools/export_svg.mjs a.mmd b.mmd`) it renders exactly those
  files instead and writes each SVG next to its source.
  Tables (`.md`) aren't rendered to SVG: `export_doc.mjs` writes them into
  `doc.html` as HTML tables, styled by `doc.css` in the same dark look as the
  diagrams (palette variables, striped rows; wide tables scroll inside their
  box). Steps finished before this change keep their table SVGs, and
  `writeDoc` still shows those (a table is skipped when its old SVG exists).
  SVGs are pretty-printed. In every exported SVG, palette colours are CSS
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
  edited files). `doc.html` is always rewritten. It is a dark page that embeds every
  SVG inline and every table as HTML, each under a heading with its path. The SVG files stay next to it,
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
  `doc_sources.mjs`, `palette.json`, `package.json`, `node_modules`);
  `Doc/` is the documentation website itself and contains generated files:
  `Doc/index.html`, `Doc/palettes.css`, `Doc/bue-palettes.css`,
  `Doc/steps.js` and the steps in `Doc/commits/<YYYYMMDD_HHmmss>/` (plus
  `Doc/commits/Transient`, ignored by git), and the hand-maintained
  things (`Doc/doc.css`, `Doc/doc.js`, `Doc/asset_sources.json`,
  `Doc/bue-render`; edit those in place, there is no copy in `Tools/`).
  `export_doc.mjs` rewrites the four
  generated root files on every run (`--site` writes only them): `index.html` lists the
  finished steps in order, oldest first, as `Step 1`, `Step 2`, ... (the folder
  dates only give the order and aren't shown) with their section headings, each linking to its place in the step (the section's id, when the page has one; older steps have none), under a `Contents` row of jump markers (`#step-N`) at the top;
  `doc.js` and `doc.css` are not generated; `palettes.css` is the colour
  palettes from `palette.json` (`body[data-palette=...]` variable rules for the
  page and its SVGs), which `doc.css` imports (`@import`), so every page and
  every finished step gets them through `doc.css` alone; `bue-palettes.css`
  is the same palettes for blueprintUE's renderer (see "Colours" below), linked
  by pages with editor views; `steps.js` is the step folders in order. Never
  edit the two palette files: change `palette.json`. While `Transient` has a `doc.html`,
  it is listed as the last step ("Step N (work in progress)") in `index.html`
  and `steps.js`, so its layout and step navigation can be checked with the
  rest of the website. The Pages workflow publishes without it: after
  collecting the site it runs `node Tools/export_doc.mjs --site --commits
  _site/commits`, which writes the step list from the published steps only.
- `Doc/asset_sources.json` is the one hand-maintained data file in `Doc/`
  (next to the vendored `Doc/bue-render`, see the editor views above): a lookup
  from an asset file (repo-relative, forward slashes, e.g.
  `Content/itch-assets/StaticMeshes/arrow_A.uasset`) to the page it was
  downloaded from (e.g. `https://kaylousberg.itch.io/fantasy-weapons-bits`).
  Keep it up to date: when the user names where imported assets come from,
  add every asset of that import. `export_doc.mjs` turns asset names (the file
  name without `.uasset`, whole words only) into links to their source that
  open in a new tab: in table values and captions and in a merged section's
  asset list, not in the Setting column or component trees (setting and
  component names could share a word with an asset, e.g. Kenney's `Group`).
  Each link has a `title` with the asset's path as the Content Browser shows it (`All/Content/Extern_Assets/...`,
  from its key in the file; several, comma separated, if two assets share the name).
  A name claimed by two different sources gets no link; a source file named
  after the asset (`sword_B.fbx`, also `.obj`, `.gltf`, `.glb`) is linked
  whole. Steps 5 (`20261110_121316`, regenerated) and 4 (`20261109_105725`,
  whose tables are SVG: asset names in `<text>` were wrapped by hand in
  `<a target="_blank"><tspan style="fill:#7cc4ff;text-decoration:underline">`)
  have links too; steps 1-3 name no listed assets. When sources are added for
  assets an older step names, add its links the same way.
- Diagrams in `doc.html` are never scaled to fit the page: each is shown at
  its natural size (1 SVG unit = 1 CSS pixel), so nodes and text are the same
  size in every diagram, and one wider than the page scrolls sideways inside
  its own `.figure` box. `doc.css` does this without knowing the sizes:
  Mermaid writes each SVG's natural width as an inline `max-width`, and the
  stylesheet asks for a far larger `width`, which that clamps. SVGs without
  an inline `max-width` (old table SVGs) and level screenshots still shrink
  to the page.
- `doc.css` is the shared stylesheet: `index.html` (`<body class="index">`)
  links `doc.css`, and every `doc.html` (`<body class="step">`) written since
  tables became HTML links `../../doc.css` and has no inline style. Older
  steps keep their inline `<style>` until regenerated.
- Every `doc.html` ends with `<script src="../../doc.js"></script>` and has
  no inline script (`export_doc.mjs` writes it; older exports were changed by
  hand). `doc.js`: (1) the colour palette switch (applies the page's
  `<select id="palette">`, remembers the choice in localStorage
  `doc-palette`, accepts `?palette=<name>`), on disk and online; (2) step
  navigation: loads `steps.js` next to itself with a `<script>` element;
  that file calls `docSteps([...])` (defined by `doc.js`) with the step
  folders, which puts a "‹ Step 2 · Step 3 of 4 · Step 4 ›" bar into the
  page's `<header>` (left/right arrow keys work too). It is a script and not
  JSON because a page opened from disk may load scripts but not fetch files,
  so the bar works on disk and online.
- Website: `.github/workflows/pages.yml` publishes `Doc/` on GitHub Pages on
  every push to `main` that touches `Doc/` (or by hand, "Run workflow"),
  without `commits/Transient`, `graph/` folders and separate SVG files (the
  pages embed them). It fetches only `Doc/**` from Git LFS. The repository's
  Pages source must be "GitHub Actions" (Settings → Pages).
- Asset metadata comes from `assetMetadata` in `Tools/doc_sources.mjs`, which
  reads the diff next to a diagram or table: `package`, `kind` (`blueprint`,
  `asset`, `actor` or `import`), `class`, `type` (display name such as
  `Input Action`; Blueprints are `Blueprint Class`), `new`, `revision`,
  `source` (the diff, relative to the export folder: `graph/transient/...`),
  and for Blueprints `parent` and `part`. Every diagram SVG carries it as a
  `<metadata>` block with a
  `<bde:asset xmlns:bde="urn:blueprint-diff-export" .../>` element, written by
  `export_svg.mjs`; for tables `export_doc.mjs` calls `assetMetadata` on the
  `.md` in the export folder's `graph/transient` (dated folders keep it). So
  each export folder describes itself. Put any further per-asset facts the
  docs need into `assetMetadata`.
- Never check out old binary assets to compare versions. Use the exported diff.

## Mermaid diagram style

Diagrams should look like the Blueprint editor, so students can match them to
what they see on screen.

### Layout

- Use `flowchart LR` with `curve: monotoneX` in the front matter config: soft
  curves that don't overshoot horizontally. (Other options in Mermaid 10:
  `basis`, `linear`, `step`, `stepBefore`, `stepAfter`, `bumpX`, `bumpY`,
  `monotoneY`, `cardinal`, `catmullRom`, `natural`, `bundle`.)
- Spacing is tight, so diagrams aren't larger than needed: the front matter
  sets `nodeSpacing: 8` (between rows of a column, so between a node's pin
  rows) and `rankSpacing: 30` (between columns, so between a node's input and
  output pins and between nodes). Mermaid 10 ignores these inside a subgraph
  without wires to the outside (every graph box, and a comment box around a
  whole chain): it lays that out on its own with a fixed 50 px ("Todo: set
  proper spacing" in its source). `export_svg.mjs`
  (`useDiagramSpacingInSubgraphs`) therefore patches the installed
  `Tools/node_modules/mermaid/dist/mermaid.js` before every export so such
  subgraphs take the spacing of the drawing around them. The patch is marked
  in that file, is applied again by itself after a fresh `npm install`, and
  prints a warning if another Mermaid version doesn't have the spot.
- With tight spacing the layout leaves no room for a graph box's title, so
  `export_svg.mjs` makes it: each graph box (`G_...`, a drawing of its own,
  stacked top to bottom) grows upward until its title fits above what it
  holds, including comment boxes that grew for their own titles, and pushes
  the graph boxes below it down (the node borders drawn on top move along,
  and the viewBox grows).
- Re-rendering a finished step's diagrams after a style rule changed (ask the
  user first; done for `20261115_084649` when the spacing changed): run
  `python Tools/sexpr_to_mermaid.py` on the `blueprint-diff` files in
  `<step>/graph/transient`, `node Tools/export_svg.mjs` on its `.mmd` files
  (with file arguments each SVG lands next to its source), move those SVGs to
  `<step>/<package path>.svg`, then `node Tools/export_doc.mjs --regenerate
  <step>`. This redraws with all current rules, not only the changed one.
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
- Comment boxes of the Blueprint editor are drawn as subgraphs `C_...` around
  the drawn nodes they frame, titled with the comment's first line, in its
  colour (`fill:none`; dimmed and dashed when the comment isn't part of the
  change), each with `direction LR`. The plugin writes a comment node's
  `(comment "<text>" (size w h) (color "#rrggbb"))` (sRGB); a node belongs to
  the smallest comment containing its position, a comment to the smallest
  comment enclosing it, and comments around no drawn node are left out.
  Comment nodes are never drawn as nodes. Mermaid lays clusters out around
  the unshrunk node boxes and leaves no room for their titles, so
  `export_svg.mjs` refits each comment around its final contents (innermost
  first; a collapsed node is an empty subgraph, which Mermaid draws as a
  `g.node`, not a cluster) and lets it grow upward and sideways for its title
  unless that would cover another box, growing the SVG's viewBox if needed.
  A title that still doesn't fit ends in "…".
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
- A pure function the project's Blueprints define themselves is marked in
  every graph: the node calling it, its entry node and its graph box end in
  ` (pure)` (`Get Weapon Hit Box Point (pure)`, box `GetWeaponHitBoxPoint
  (pure)`). Engine functions and overrides aren't marked. `pure_functions` in
  `sexpr_to_mermaid.py` takes the names from the `(function ... (override
  false) (pure true))` entries of the reference files of this step and every
  earlier one (per Blueprint the latest export counts), so a call is marked
  even when the function's Blueprint isn't exported again. Functions are
  matched by name only. A diagram is only redrawn when its own diff changes:
  after a function's Pure setting changes, run `--force` so its callers
  follow.
- A function that overrides one of the parent class (Functions → Override)
  is marked on its entry node and its graph box: `Received_Notify
  (override)`. The names come from the `(override true)` function entries of
  the Blueprint's own diff and reference file (`overridden_functions`); an
  override isn't also marked pure.
- The pure variant of a built-in node is marked the same way: a cast
  converted to a pure cast reads `Cast To BP_Hero (pure)`. It is recognised
  by having no exec pins (`PURE_VARIANT_CLASSES` in `sexpr_to_mermaid.py`:
  Cast and Class Cast). Other nodes with a pure toggle (a function call's
  "Show Exec Pins") can't be told from the export yet; that needs a flag
  from the plugin.
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
  (`bLooping` -> `Looping`), also behind a split struct's prefix
  (`Stimulus_bSuccessfullySensed` -> `Stimulus Successfully Sensed`).
- Leave out every pin that isn't connected, inputs and outputs alike, except
  unconnected input pins with a value typed in. Those show the value in a box
  instead of the dot (`[50] Min`), framed in the pin's colour via
  `currentColor` (Mermaid mangles `#` in label HTML). "Typed in" means not
  empty, zero, `false` or `None`; the diff has no engine defaults, so a value
  deliberately set to 0 isn't shown. Numbers drop trailing zeros
  (`50.000000` -> `50`), and asset or class paths become names
  (`/Game/Input/IMC_Default.IMC_Default` -> `IMC_Default`).
- Exception: a setter's value pin is always shown, also unconnected with 0
  or `false` (`[0] Life` on `Set Life`, `[false] Is Attacking`): there the
  value is the point of the node. Without a value at all (an object variable
  set to nothing) the row reads `● Active Weapon`.
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

All colours live in `Tools/palette.json`, the one place to change them
(`export_doc.mjs` turns it into `Doc/palettes.css` and `Doc/bue-palettes.css`).
Its `bue` section says which palette colour stands for which pin types, wire
colours (blueprintUE's script sets them as `stroke` attributes, so they are
matched by value), node header classes and the node body of blueprintUE's
renderer. `bue-palettes.css` repeats, for every palette but `default`, only the
colours that palette changes, under `body[data-palette=<name>] .editor-view
.bue-render`, so they win over the renderer's own rules in any file order; the
default palette leaves the renderer in the Unreal editor look it already has.
The `default` palette is the Unreal editor look below, used by `.mmd` files and
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

A node whose title is wider than its pin rows (`On Target Perception Updated
(AIPerception)`) would grow past the room the layout gave it, which only knew
the rows, and touch the next node. `tightenNodeBoxes` reports such nodes, and
`export_svg.mjs` lays the diagram out a second time with a larger `min-width`
on that node's output rows (input rows if it has none), from a temporary
`<name>.widened.mmd`; the `.mmd` itself is unchanged. So every node keeps the
layout's gap (`rankSpacing`) to its neighbours.

Pin rows are stacked tightly from the top of their node (4 px apart,
`ROW_GAP` in `tightenNodeBoxes`), inputs and outputs each in their own column,
exec rows first and the rest in the order the layout chose. The layout puts
each row level with what it is wired to, which left large gaps inside nodes
(Branch's `True` far below `Condition`); the wires are redrawn to the rows'
new places. The layout's node positions stay, so this shrinks nodes, not the
whole drawing.

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
