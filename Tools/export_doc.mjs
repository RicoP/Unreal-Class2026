// Build the documentation of the work in progress, and turn it into a dated snapshot when done.
//
//   node Tools/export_doc.mjs            (or: npm run export-doc, inside Tools/)
//   node Tools/export_doc.mjs --finish   (or: npm run finish-doc)
//
// The tools live in Tools/; Doc/ is the documentation website itself. Work in progress happens
// in Doc/commits/Transient. The editor plugin writes diffs to Transient/graph/transient (and
// full versions to Transient/graph/reference). Without options, this script writes a diagram
// (.mmd, sexpr_to_mermaid.py) or table (.md, sexpr_to_table.py) next to every diff, renders
// the diagrams to SVG (export_svg.mjs), and writes Transient/doc.html, which embeds every SVG
// inline (IDs prefixed per SVG so their styles don't clash), shows every table as an HTML
// table, and offers the colour palettes from Tools/palette.json. Steps finished before tables
// became HTML have table SVGs instead; those are still shown.
// Every run also writes the website's shared files: Doc/index.html (the finished steps as
// Step 1, Step 2, ...), Doc/doc.js (copied from Tools/doc.js: palette switch and step
// navigation, loaded by every doc.html as ../../doc.js), Doc/doc.css (Tools/doc.css plus the
// palettes; the stylesheet of index.html and every new doc.html) and Doc/steps.json (the
// step order).
// Only what is out of date is regenerated (by file timestamps), so diagrams and tables edited
// by hand survive until their diff is exported again; --force regenerates everything.
// --finish renames Transient to Doc/commits/<YYYYMMDD_HHmmss>, ready to commit; the next
// lesson step starts with a new, empty Transient.
// SVGs are named by package path, e.g.
//   Game/Input/Actions/IA_Zoom.svg  ->  /Game/Input/Actions/IA_Zoom
// In doc.html text, package paths are shown as the Content Browser shows them:
//   /Game/Input/Actions/IA_Zoom     ->  All/Content/Input/Actions/IA_Zoom
//
// New assets get the heading "Create <asset type> at <package path>" instead of just the
// package path. Whether an asset is new, and its type, come from the <metadata> block that
// export_svg.mjs writes into each SVG, and for tables from their diff in graph/transient
// (assetMetadata in doc_sources.mjs, the same facts), so every export folder describes itself.
//
// Pass --commits <dir> to use another commits folder (for testing), or
// --regenerate <export folder> to rewrite doc.html of an existing export without rebuilding.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetMetadata, parseTable } from "./doc_sources.mjs";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const argIndex = process.argv.indexOf("--commits");
const commitsDir = argIndex > 0 ? path.resolve(process.argv[argIndex + 1]) : path.join(toolsDir, "..", "Doc", "commits");
// The website root: index.html, doc.js and steps.json next to the commits folder.
const siteDir = path.dirname(commitsDir);
const transient = path.join(commitsDir, "Transient");

function timestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Relative paths (with forward slashes) of all SVGs and level screenshots (PNG) below a folder,
 * sorted, leaving out the graph/ source data.
 */
function svgFiles(root, folder = root) {
  const files = [];
  for (const name of readdirSync(folder)) {
    const full = path.join(folder, name);
    if (statSync(full).isDirectory()) {
      if (!(folder === root && name === "graph")) {
        files.push(...svgFiles(root, full));
      }
    } else if (/\.(svg|png)$/i.test(name)) {
      files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

/**
 * The tables (.md) in a folder's graph/transient, as a map from the path their SVG had before
 * tables became HTML (Game/X.settings.svg for graph/transient/Game/X.settings.md) to the table
 * file, so they sort among the SVGs as before.
 */
function tableFiles(folder) {
  const graphRoot = path.join(folder, "graph", "transient");
  const below = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? below(full) : entry.name.toLowerCase().endsWith(".md") ? [full] : [];
    });
  return new Map(
    (existsSync(graphRoot) ? below(graphRoot) : []).map((file) => [
      path.relative(graphRoot, file).split(path.sep).join("/").replace(/\.md$/i, ".svg"),
      file,
    ]),
  );
}

/** Attributes of the <bde:asset> metadata element in an SVG, or {} if it has none. */
function svgMetadata(svgFile) {
  const tag = /<bde:asset\b([^>]*)\/?>/.exec(readFileSync(svgFile, "utf8"))?.[1] ?? "";
  const unescape = (value) =>
    value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, unescape(value)]));
}

/** "/Game/Input/IA_Zoom" -> "All/Content/Input/IA_Zoom", the path the Content Browser shows. */
function browserPath(packagePath) {
  return packagePath.startsWith("/Game/") ? "All/Content/" + packagePath.slice("/Game/".length) : packagePath;
}

/**
 * Section heading: "Create <type> at <path>" for a new asset; for an actor (package = its level)
 * "Place <type> in <level>" or "Change <label> in <level>"; otherwise just the path.
 */
/**
 * Heading for creating a Blueprint: "Create New Character Blueprint at <path>", or, when the
 * parent is a Blueprint of this project (/Game/...), "Create Child Blueprint of BP_Enemy_Base
 * with the name BP_Enemy_Variant1" (children are assumed to sit in their parent's folder).
 */
function createBlueprintHeading(meta, shownPath) {
  const parentPath = meta.parent ?? "";
  const parent = parentPath.split(/[./]/).pop().replace(/_C$/, "") || "Actor";
  if (parentPath.startsWith("/Game/")) {
    return `Create Child Blueprint of ${parent} with the name ${meta.package.split("/").pop()}`;
  }
  return `Create New ${parent} Blueprint at ${shownPath}`;
}

function headingFor(meta, shownPath, hasSettings) {
  if (meta.kind === "import") {
    const files = (meta.files ?? "").split(", ").filter(Boolean);
    const what = files.length === 1 ? files[0] : `${files.length} files`;
    return `Import ${what} into ${shownPath}`;
  }
  if (meta.kind === "blueprint" && meta.new === "true" && (meta.part === "settings" || !hasSettings)) {
    return createBlueprintHeading(meta, shownPath);
  }
  if (meta.kind === "blueprint" && meta.part === "settings") {
    return `${shownPath}: Class Defaults and Components`;
  }
  if (meta.kind === "blueprint" && hasSettings) {
    // The settings section above already says what to create; this one shows the graph.
    return `${shownPath}: Graph`;
  }
  if (meta.kind === "actor") {
    const named = meta.label && meta.label.replace(/\s/g, "") !== meta.type.replace(/\s/g, "") ? ` named ${meta.label}` : "";
    return meta.new === "true" ? `Place ${meta.type}${named} in ${shownPath}` : `Change ${meta.label || meta.type} in ${shownPath}`;
  }
  return meta.new === "true" ? `Create ${meta.type} at ${shownPath}` : shownPath;
}

function html(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Prefix every ID in an SVG, and every reference to it (url(#id), href="#id", CSS #id), so
 * several SVGs can share one page. Mermaid gives each diagram the same ID, "my-svg".
 */
function uniqueIds(svg, prefix) {
  const ids = [...new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))].sort((a, b) => b.length - a.length);
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let result = svg;
  for (const id of ids) {
    result = result
      .replace(new RegExp(`\\bid="${escape(id)}"`, "g"), `id="${prefix}-${id}"`)
      .replace(new RegExp(`#${escape(id)}(?![\\w-])`, "g"), `#${prefix}-${id}`);
  }
  return result;
}

/**
 * CSS that applies a palette when doc.html's <body data-palette="..."> selects it: to the page
 * (HTML tables) and to each SVG, which carries the default palette at zero specificity.
 * Other palettes only list the colours they change, so they start from the default one.
 */
function paletteCss() {
  const palettes = JSON.parse(readFileSync(path.join(toolsDir, "palette.json"), "utf8")).palettes;
  return Object.entries(palettes)
    .map(([name, palette]) => {
      const colors = name === "default" ? palette.colors : { ...palettes.default.colors, ...palette.colors };
      const variables = Object.entries(colors)
        .map(([key, value]) => `--${key}: ${value};`)
        .join(" ");
      return `body[data-palette="${name}"], body[data-palette="${name}"] svg { ${variables} }`;
    })
    .join("\n");
}

/**
 * Where assets were downloaded from, by asset name: Doc/asset_sources.json maps asset files
 * ("Content/itch-assets/StaticMeshes/sword_B.uasset") to a page; tables name assets by their
 * name ("sword_B"). A name that two sources claim gets no link.
 */
function loadAssetSources() {
  const file = path.join(siteDir, "asset_sources.json");
  const sources = new Map();
  if (!existsSync(file)) {
    return sources;
  }
  for (const [asset, url] of Object.entries(JSON.parse(readFileSync(file, "utf8")))) {
    const name = path.posix.basename(asset).replace(/\.uasset$/i, "");
    sources.set(name, sources.has(name) && sources.get(name) !== url ? null : url);
  }
  return sources;
}
const assetSources = loadAssetSources();
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole asset names only: "sword_B" in "sword_B, sword_C", not in "sword_B_old". Longest first.
// The source file it was imported from ("sword_B.fbx") came from the same place: linked whole.
const assetNames = [...assetSources].filter(([, url]) => url).map(([name]) => name).sort((a, b) => b.length - a.length);
const assetPattern = assetNames.length
  ? new RegExp(`(?<![\\w-])(${assetNames.map(escapeRegExp).join("|")})(?:\\.(?:fbx|FBX|obj|OBJ|gltf|glb))?(?![\\w-])`, "g")
  : null;

/** Asset names in HTML text as links to where the asset came from, opened in a new tab. */
function linkAssets(text) {
  return assetPattern
    ? text.replace(assetPattern, (match, name) => `<a href="${html(assetSources.get(name))}" target="_blank" rel="noopener">${match}</a>`)
    : text;
}

/**
 * A table cell's text as HTML: `code` spans as <code>, and with links (values, not setting or
 * component names, which could share a word with an asset such as "Group") asset names as links
 * to their source.
 */
function cellHtml(text, links = true) {
  const cell = html(text).replace(/`([^`]+)`/g, "<code>$1</code>");
  return links ? linkAssets(cell) : cell;
}

/** A component tree ([depth, "name (type)"] items) as nested lists, like the Components panel. */
function treeHtml(tree) {
  const lines = [];
  let depth = -1;
  for (const [level, text] of tree) {
    if (level > depth) {
      lines.push("<ul>".repeat(level - depth));
    } else {
      lines.push("</li>" + "</ul></li>".repeat(depth - level));
    }
    lines.push(`<li>${cellHtml(text, false)}`);
    depth = level;
  }
  lines.push("</li>" + "</ul></li>".repeat(depth) + "</ul>");
  return [
    `      <div class="components">`,
    "        <p>Components</p>",
    `        ${lines.join("")}`,
    "      </div>",
  ].join("\n");
}

/**
 * A table written by sexpr_to_table.py as an HTML table; its first row is the header. A
 * Blueprint's component tree, when it has one, comes first.
 */
function tableHtml({ title, tree, rows }) {
  const [header, ...body] = rows;
  // The first column names settings; only the values link assets.
  const cells = (row, tag) =>
    row
      .map((value, column) =>
        value === "—" ? `<${tag} class="none">—</${tag}>` : `<${tag}>${cellHtml(value, tag === "td" && column > 0)}</${tag}>`,
      )
      .join("");
  return [
    ...(tree.length ? [treeHtml(tree)] : []),
    `      <div class="table">`,
    "        <table>",
    ...(title ? [`          <caption>${cellHtml(title)}</caption>`] : []),
    `          <thead><tr>${cells(header, "th")}</tr></thead>`,
    "          <tbody>",
    ...body.map((row) => `            <tr>${cells(row, "td")}</tr>`),
    "          </tbody>",
    "        </table>",
    "      </div>",
  ].join("\n");
}

function paletteOptions() {
  const palettes = JSON.parse(readFileSync(path.join(toolsDir, "palette.json"), "utf8")).palettes;
  return Object.entries(palettes)
    .map(([name, palette]) => `<option value="${html(name)}">${html(palette.label ?? name)}</option>`)
    .join("");
}

function writeDoc(folder) {
  const title = `Documentation export ${path.basename(folder)}`;
  const images = svgFiles(folder);
  // Tables are shown as HTML, unless the step is older and has the table as SVG already.
  const tables = new Map(
    [...tableFiles(folder)].filter(([file, md]) => !images.includes(file) && parseTable(readFileSync(md, "utf8")).rows.length >= 2),
  );
  const allFiles = [...images, ...tables.keys()].sort();
  const metaOf = (file) => {
    if (tables.has(file)) {
      return assetMetadata(tables.get(file), folder) ?? {};
    }
    return file.endsWith(".png") ? {} : svgMetadata(path.join(folder, file));
  };
  const metas = new Map(allFiles.map((file) => [file, metaOf(file)]));
  // Import steps come first: everything else may use what they bring in.
  const files = [...allFiles.filter((file) => metas.get(file).kind === "import"), ...allFiles.filter((file) => metas.get(file).kind !== "import")];
  const withSettings = new Set([...metas.values()].filter((meta) => meta.part === "settings").map((meta) => meta.package));

  // Asset tables in the same folder that are 100% the same (asset type, new or changed, and
  // rows) become one section that lists the assets, e.g. collision removed from 30 Static
  // Meshes at once. The section sits where the first of them would be; a different asset in
  // between (sorted by name) doesn't split the group.
  const groups = [];
  const byKey = new Map();
  for (const file of files) {
    const meta = metas.get(file);
    const table = tables.has(file) && meta.kind === "asset" ? parseTable(readFileSync(tables.get(file), "utf8")) : null;
    const key = table && JSON.stringify([meta.package.replace(/\/[^/]*$/, ""), meta.type, meta.new, table.rows]);
    if (key && byKey.has(key)) {
      byKey.get(key).files.push(file);
      continue;
    }
    const group = { files: [file], table };
    groups.push(group);
    if (key) byKey.set(key, group);
  }
  const groupSection = ({ files: members, table }) => {
    const meta = metas.get(members[0]);
    const names = members.map((file) => metas.get(file).package.split("/").pop());
    const what = `${names.length} ${meta.type} assets`;
    const heading = `${meta.new === "true" ? "Create" : "Change"} ${what} in ${browserPath(meta.package.replace(/\/[^/]*$/, ""))}`;
    return [
      "    <section>",
      `      <h2>${html(heading)}</h2>`,
      `      <p class="assets">${linkAssets(html(names.join(", ")))}</p>`,
      tableHtml({ ...table, title: what, tree: [] }),
      "    </section>",
    ].join("\n");
  };

  const sections = groups.map((group, index) => {
    if (group.files.length > 1) {
      return groupSection(group);
    }
    const [file] = group.files;
    if (file.endsWith(".png")) {
      // A level screenshot (Tools > Save Level Screenshot): the geometry to rebuild by eye.
      const levelPath = browserPath("/" + file.replace(/\.png$/i, ""));
      return [
        "    <section>",
        `      <h2>${html(`Recreate the level geometry shown in ${levelPath}`)}</h2>`,
        `      <div class="figure"><img src="${html(encodeURI(file))}" alt="${html(levelPath)}"></div>`,
        "    </section>",
      ].join("\n");
    }
    const meta = metas.get(file);
    const shownPath = browserPath(meta.package || "/" + file.replace(/\.svg$/i, ""));
    const heading = headingFor(meta, shownPath, withSettings.has(meta.package));
    if (tables.has(file)) {
      return ["    <section>", `      <h2>${html(heading)}</h2>`, tableHtml(parseTable(readFileSync(tables.get(file), "utf8"))), "    </section>"].join("\n");
    }
    const svg = uniqueIds(readFileSync(path.join(folder, file), "utf8").replace(/<\?xml[^>]*\?>\s*/, ""), `s${index + 1}`);
    return [
      "    <section>",
      `      <h2>${html(heading)}</h2>`,
      `      <div class="figure" role="img" aria-label="${html(shownPath)}">`,
      svg.trimEnd(),
      "      </div>",
      "    </section>",
    ].join("\n");
  });

  const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${html(title)}</title>
    <!-- Shared stylesheet with the palettes: Doc/doc.css (from Tools/doc.css) -->
    <link rel="stylesheet" href="../../doc.css">
  </head>
  <body class="step" data-palette="default">
    <header>
      <label>Colours <select id="palette">${paletteOptions()}</select></label>
    </header>
${sections.join("\n")}
    <!-- Palette switch and step navigation: Doc/doc.js (from Tools/doc.js) -->
    <script src="../../doc.js"></script>
  </body>
</html>
`;
  const docFile = path.join(folder, "doc.html");
  writeFileSync(docFile, page, "utf8");
  // Exports made before the switch to HTML have a doc.md that is now outdated.
  rmSync(path.join(folder, "doc.md"), { force: true });
  console.log(`Wrote ${path.relative(process.cwd(), docFile)}`);
}

/** All .sexpr diffs below a folder (absolute paths), sorted. */
function diffFiles(folder) {
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(folder, entry.name);
      return entry.isDirectory() ? diffFiles(full) : entry.name.endsWith(".sexpr") ? [full] : [];
    })
    .sort();
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`${command} ${path.basename(args[0])} failed${result.error ? `: ${result.error.message}` : ""}.`);
    process.exit(1);
  }
}

const modified = (file) => (existsSync(file) ? statSync(file).mtimeMs : 0);

/**
 * Whether a diff's diagram or table must be (re)generated: it doesn't exist yet, or the diff
 * or its reference file (Transient/graph/reference/...) is newer. A diagram or table edited by
 * hand is kept until the diff is exported again. Changes to the generator scripts don't count;
 * use --force after a style rule changes.
 */
function needsGenerating(diff) {
  const outputs = [".mmd", ".md", ".settings.md"].map((ext) => modified(diff.replace(/\.sexpr$/, ext))).filter(Boolean);
  if (outputs.length === 0) {
    return true;
  }
  const reference = diff.replace(/([\\/])graph\1transient\1/, "$1graph$1reference$1");
  return Math.max(modified(diff), modified(reference)) > Math.max(...outputs);
}

/**
 * Build the documentation in Transient: a diagram (.mmd) or table (.md) next to every diff
 * in Transient/graph/transient, every SVG in Transient, and Transient/doc.html. Only what is
 * out of date is regenerated; --force regenerates everything (and overwrites hand edits).
 */
function build(force) {
  const diffs = diffFiles(path.join(transient, "graph", "transient"));
  if (diffs.length === 0 && !(existsSync(transient) && svgFiles(transient).some((file) => file.endsWith(".png")))) {
    console.error(`Nothing to export: ${path.relative(process.cwd(), transient)} has no diffs or level screenshots. Export some from the editor first.`);
    process.exit(1);
  }
  const outdated = force ? diffs : diffs.filter(needsGenerating);
  if (outdated.length < diffs.length) {
    console.log(`${diffs.length - outdated.length} diagram(s)/table(s) up to date, kept as they are.`);
  }
  const python = process.env.PYTHON ?? "python";
  const isBlueprint = (file) => /^\s*\(blueprint-diff\b/.test(readFileSync(file, "utf8"));
  const blueprints = outdated.filter(isBlueprint);
  // In batches, so the command line stays short (Windows allows about 32,000 characters).
  const batches = (files) => Array.from({ length: Math.ceil(files.length / 40) }, (_, i) => files.slice(i * 40, i * 40 + 40));
  for (const batch of batches(blueprints)) {
    run(python, [path.join(toolsDir, "sexpr_to_mermaid.py"), ...batch]);
  }
  // Tables for assets and actors, and each Blueprint's class defaults and components. Imported
  // assets are grouped into one table per import step, which needs to see every diff.
  for (const batch of outdated.length ? batches(outdated) : [[]]) {
    run(python, [path.join(toolsDir, "sexpr_to_table.py"), ...batch, "--all-in", path.join(transient, "graph", "transient")]);
  }
  run(process.execPath, [path.join(toolsDir, "export_svg.mjs"), ...(force ? ["--force"] : [])]);
  writeDoc(transient);
}

/**
 * Write the website's shared files into the site root (Doc/): index.html listing the finished
 * steps in order as Step 1, Step 2, ... with their section headings (the dated folder names
 * only give the order), doc.js (Tools/doc.js), doc.css (Tools/doc.css plus the palettes) and
 * steps.json (the step folders in order).
 * While Transient has a doc.html, it is the last step, marked as work in progress, so its layout
 * can be checked with the rest of the website. The published website leaves it out: the Pages
 * workflow runs --site again on the steps it publishes.
 */
function writeSite() {
  const steps = readdirSync(commitsDir)
    .filter((name) => /^\d{8}_\d{6}$/.test(name) && existsSync(path.join(commitsDir, name, "doc.html")))
    .sort();
  if (existsSync(path.join(transient, "doc.html"))) {
    steps.push(path.basename(transient));
  }
  const unescape = (text) =>
    text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const entries = steps.map((folder, index) => {
    const page = readFileSync(path.join(commitsDir, folder, "doc.html"), "utf8");
    const items = [...page.matchAll(/<h2>([\s\S]*?)<\/h2>/g)]
      .map((m) => `          <li>${html(unescape(m[1].trim()))}</li>`)
      .join("\n");
    const wip = folder === path.basename(transient) ? " (work in progress)" : "";
    return [
      "      <article>",
      `        <h2><a href="commits/${folder}/doc.html">Step ${index + 1}</a>${wip}</h2>`,
      `        <ul>\n${items}\n        </ul>`,
      "      </article>",
    ].join("\n");
  });
  const index = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Unreal Class 2026</title>
    <link rel="stylesheet" href="doc.css">
  </head>
  <body class="index">
    <main>
      <h1>Unreal Class 2026</h1>
${entries.join("\n")}
    </main>
  </body>
</html>
`;
  writeFileSync(path.join(siteDir, "index.html"), index, "utf8");
  copyFileSync(path.join(toolsDir, "doc.js"), path.join(siteDir, "doc.js"));
  const css = readFileSync(path.join(toolsDir, "doc.css"), "utf8").trimEnd();
  writeFileSync(
    path.join(siteDir, "doc.css"),
    `${css}\n\n/* Palettes from Tools/palette.json, written by Tools/export_doc.mjs. */\n${paletteCss()}\n`,
    "utf8",
  );
  writeFileSync(path.join(siteDir, "steps.json"), JSON.stringify(steps, null, 2) + "\n", "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), siteDir)}: index.html, doc.js, doc.css, steps.json (${steps.length} steps)`);
}

/** Rename Transient to Doc/commits/<YYYYMMDD_HHmmss>, ready to commit. */
function finish() {
  if (!existsSync(path.join(transient, "doc.html"))) {
    console.error(`${path.relative(process.cwd(), transient)} has no doc.html. Run node Tools/export_doc.mjs first.`);
    process.exit(1);
  }
  const target = path.join(commitsDir, timestamp(new Date()));
  if (existsSync(target)) {
    console.error(`${target} already exists.`);
    process.exit(1);
  }
  renameSync(transient, target);
  console.log(`Renamed ${path.relative(process.cwd(), transient)} -> ${path.relative(process.cwd(), target)}`);
  writeDoc(target); // the page title names the folder
}

const regenerateIndex = process.argv.indexOf("--regenerate");
if (regenerateIndex > 0) {
  writeDoc(path.resolve(process.argv[regenerateIndex + 1]));
} else if (process.argv.includes("--finish")) {
  finish();
} else if (process.argv.includes("--site")) {
  // Only the website's shared files (index.html, doc.js, doc.css, steps.json).
} else {
  build(process.argv.includes("--force"));
}
writeSite();
