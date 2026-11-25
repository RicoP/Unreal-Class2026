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
// Step 1, Step 2, ...), Doc/doc.js (kept there by hand, not generated: palette switch and step
// navigation, loaded by every doc.html as ../../doc.js), Doc/palettes.css (the colour palettes
// from Tools/palette.json, imported by the hand-written Doc/doc.css), Doc/bue-palettes.css (the
// same palettes for blueprintUE's renderer, linked by pages with editor views) and Doc/steps.js
// (the step order).
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
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetMetadata, parseTable } from "./doc_sources.mjs";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const argIndex = process.argv.indexOf("--commits");
const commitsDir = argIndex > 0 ? path.resolve(process.argv[argIndex + 1]) : path.join(toolsDir, "..", "Doc", "commits");
// The website root: index.html, palettes.css, bue-palettes.css and steps.js (written here) next to the commits folder.
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
  if (meta.kind === "origin") {
    return `Import ${Number(meta.count) === 1 ? meta.file : `${meta.count} files`}${meta.url ? ` from ${meta.url}` : ` into ${shownPath}`}`;
  }
  if (meta.kind === "retarget") {
    return `Retarget ${meta.count} ${meta.type} ${Number(meta.count) === 1 ? "asset" : "assets"} in ${shownPath}`;
  }
  if (meta.kind === "blueprint" && meta.new === "true" && (meta.part === "settings" || !hasSettings)) {
    return createBlueprintHeading(meta, shownPath);
  }
  if (meta.kind === "blueprint" && meta.part === "settings") {
    return `${shownPath}: Class Defaults and Components`;
  }
  if (meta.kind === "blueprint" && meta.graph) {
    // One section per graph: "<path>: EventGraph", "<path>: Function Set Target".
    return `${shownPath}: ${meta.graph}`;
  }
  if (meta.kind === "blueprint" && hasSettings) {
    // The settings section above already says what to create; this one shows the graph.
    return `${shownPath}: Graph`;
  }
  if (meta.kind === "actor") {
    const named = meta.label && meta.label.replace(/\s/g, "") !== meta.type.replace(/\s/g, "") ? ` named ${meta.label}` : "";
    return meta.new === "true" ? `Place ${meta.type}${named} in ${shownPath}` : `Change ${meta.label || meta.type} in ${shownPath}`;
  }
  if (meta.preset && meta.new === "true") {
    return `Create Preset of ${meta.preset} with the name ${meta.package.split("/").pop()}`;
  }
  const rowType = meta.rowtype ? ` (of rowtype ${meta.rowtype})` : "";
  return meta.new === "true" ? `Create ${meta.type} at ${shownPath}${rowType}` : shownPath;
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

/** "#c6c6c6" or "#fff" -> [198, 198, 198] */
function rgbOf(hex) {
  const digits = hex.replace("#", "");
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/**
 * The palettes for blueprintUE's renderer (Doc/bue-palettes.css): for every palette except
 * 'default' (the Unreal editor look the renderer already has), the colours it changes, applied to
 * the pin types, wires, node headers and node body they stand for. What stands for what is in
 * the "bue" section of Tools/palette.json. Wires carry their colour as an attribute set by the
 * renderer's script, so they are matched by that value. The selectors start with the palette
 * and .editor-view, so they win over the renderer's own rules whatever the order of the files.
 */
function bueCss() {
  const config = JSON.parse(readFileSync(path.join(toolsDir, "palette.json"), "utf8"));
  const mapping = Object.entries(config.bue).filter(([key]) => key !== "description");
  const rules = [];
  for (const [name, palette] of Object.entries(config.palettes)) {
    if (name === "default") {
      continue;
    }
    const scope = `body[data-palette="${name}"] .editor-view .bue-render`;
    rules.push(`/* ${palette.label ?? name} */`);
    for (const [key, targets] of mapping) {
      const color = palette.colors[key];
      if (!color) {
        continue; // this palette leaves it as it is
      }
      for (const pin of targets.pins ?? []) {
        rules.push(`${scope} .pin .connector.${pin} { border-color: ${color}; }`);
        rules.push(`${scope} .pin .connector.${pin}.filled { background-color: ${color}; }`);
      }
      for (const wire of targets.wires ?? []) {
        rules.push(`${scope} .link path[stroke="#${wire}" i] { stroke: ${color}; }`);
      }
      for (const header of targets.headers ?? []) {
        const [r, g, b] = rgbOf(color);
        rules.push(`${scope} .node-color.${header} { background-color: ${color}; }`);
        rules.push(`${scope} .node-color.${header}.gradient { background: linear-gradient(90deg, rgba(${r},${g},${b},.4) 0, rgba(${r},${g},${b},.1)); }`);
      }
      if (targets.body) {
        rules.push(`${scope} .node { background-color: color-mix(in srgb, ${color} 70%, transparent); }`);
      }
    }
  }
  return rules.join("\n");
}

/**
 * Where assets were downloaded from, by asset name: Doc/asset_sources.json maps asset files
 * ("Content/itch-assets/StaticMeshes/sword_B.uasset") to a page; tables name assets by their
 * name ("sword_B"). A name that two sources claim gets no link.
 */
const assetPackages = new Map(); // asset name -> package paths, for the title of its link
function loadAssetSources() {
  const file = path.join(siteDir, "asset_sources.json");
  const sources = new Map();
  if (!existsSync(file)) {
    return sources;
  }
  for (const [asset, url] of Object.entries(JSON.parse(readFileSync(file, "utf8")))) {
    const name = path.posix.basename(asset).replace(/\.(uasset|umap)$/i, "");
    sources.set(name, sources.has(name) && sources.get(name) !== url ? null : url);
    // The package path, as the link's tooltip: "Content/A/B.uasset" -> "/Game/A/B".
    if (asset.startsWith("Content/")) {
      const packagePath = "/Game/" + asset.slice("Content/".length).replace(/\.(uasset|umap)$/i, "");
      assetPackages.set(name, [...(assetPackages.get(name) ?? []), packagePath]);
    }
  }
  return sources;
}
/**
 * Every file an Asset Origin Label lists (graph/transient/**.sexpr, `asset-origin`) that
 * Doc/asset_sources.json doesn't have yet is added with the label's URL, so the docs link the
 * asset names to where they come from. An entry that exists is never changed, and a label
 * without a URL adds nothing. Diffs from before the plugin wrote package paths are skipped.
 */
function updateAssetSourcesFromLabels() {
  const file = path.join(siteDir, "asset_sources.json");
  const found = [];
  const walk = (dir) => {
    for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".sexpr")) {
        const text = readFileSync(full, "utf8");
        if (!/^\s*\(asset-origin\b/.test(text)) {
          continue;
        }
        const url = /\(url "([^"]+)"\)/.exec(text)?.[1];
        if (url) {
          for (const match of text.matchAll(/\(file "([^"]*)" "([^"]*)" "(\/Game\/[^"]*)"\)/g)) {
            found.push([`Content/${match[3].slice("/Game/".length)}${match[2] === "World" ? ".umap" : ".uasset"}`, url]);
          }
        }
      }
    }
  };
  walk(path.join(transient, "graph", "transient"));
  if (found.length === 0) {
    return;
  }
  const raw = existsSync(file) ? readFileSync(file, "utf8") : "{}";
  const sources = JSON.parse(raw);
  const before = Object.keys(sources).length;
  for (const [asset, url] of found) {
    sources[asset] ??= url;
  }
  const added = Object.keys(sources).length - before;
  if (added > 0) {
    const text = JSON.stringify(sources, null, 2) + (raw.endsWith("\n") ? "\n" : "");
    writeFileSync(file, raw.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text, "utf8");
    console.log(`Added ${added} asset(s) to ${path.relative(process.cwd(), file)}`);
  }
}
updateAssetSourcesFromLabels();
const assetSources = loadAssetSources();
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole asset names only: "sword_B" in "sword_B, sword_C", not in "sword_B_old". Longest first.
// The source file it was imported from ("sword_B.fbx") came from the same place: linked whole.
const assetNames = [...assetSources].filter(([, url]) => url).map(([name]) => name).sort((a, b) => b.length - a.length);
const assetPattern = assetNames.length
  ? new RegExp(`(?<![\\w-])(${assetNames.map(escapeRegExp).join("|")})(?:\\.(?:fbx|FBX|obj|OBJ|gltf|glb))?(?![\\w-])`, "g")
  : null;

/** Asset names in HTML text as links to where the asset came from, opened in a new tab. */
/** ` title="All/Content/..."` for an asset's link: its path as the Content Browser shows it (browserPath) (several, if two assets share the name). */
function assetTitle(name) {
  const packages = assetPackages.get(name);
  return packages ? ` title="${html(packages.map(browserPath).join(", "))}"` : "";
}

function linkAssets(text) {
  return assetPattern
    ? text.replace(assetPattern, (match, name) => `<a href="${html(assetSources.get(name))}"${assetTitle(name)} target="_blank" rel="noopener">${match}</a>`)
    : text;
}

/**
 * A table cell's text as HTML: `code` spans as <code>, and with links (values, not setting or
 * component names, which could share a word with an asset such as "Group") asset names as links
 * to their source.
 */
function cellHtml(text, links = true) {
  // A cell that is only a web address (an import's Source) is a link, and no asset name inside it is linked again.
  if (/^https?:\/\/\S+$/.test(text)) {
    return `<a href="${html(text)}" target="_blank" rel="noopener">${html(text)}</a>`;
  }
  const cell = withColorSquares(withObjectTypeNames(html(text)).replace(/`([^`]+)`/g, "<code>$1</code>"));
  return links ? linkAssets(cell) : cell;
}

/**
 * A color value gets a square in that color before it (`.color-square` in doc.css shows the `i`
 * as the square). Both of the engine's color types: an FLinearColor, `(R=0.312449,G=0.703082,
 * B=0.433200,A=1.000000)`, has decimals and linear values, converted to the sRGB color the editor's
 * swatch shows; an FColor, `(R=151,G=255,B=0,A=255)` (`color_text` in sexpr_to_table.py puts its
 * fields in this order), has whole numbers 0-255 that are sRGB already.
 */
function withColorSquares(cell) {
  const srgb = (c) => {
    const v = Math.min(1, Math.max(0, c));
    return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  };
  return cell.replace(/\(R=(-?[\d.]+),G=(-?[\d.]+),B=(-?[\d.]+)(?:,A=(-?[\d.]+))?\)/g, (match, r, g, b, a) => {
    const linear = /\./.test(match);
    const byte = (c) => Math.min(255, Math.max(0, Math.round(Number(c))));
    const channel = (c) => (linear ? srgb(Number(c)) : byte(c));
    const alpha = a === undefined ? 1 : Math.min(1, Math.max(0, linear ? Number(a) : Number(a) / 255));
    const color = `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${alpha})`;
    return `<span class="color-square" style="background-color: ${color}">i</span> ${match}`;
  });
}

/**
 * The pin colour of a type as the table names it ("Float", "BP Weapon Base Class Reference",
 * "Timer Handle Structure"), as a palette variable, or null for a name that isn't a type. The
 * colours are the editor's (Tools/palette.json), so a dot next to the name matches the pin.
 */
function pinColorOf(type) {
  const basic = {
    Boolean: "boolean", Byte: "byte", Integer: "integer", Integer64: "integer64", Float: "float", Name: "name",
    String: "string", Text: "text", Vector: "vector", Rotator: "rotator", Transform: "transform",
  };
  if (basic[type]) {
    return `--pin-${basic[type]}`;
  }
  if (/ Class References?$/.test(type)) return "--pin-class";
  if (/ Object References?$/.test(type)) return "--pin-object";
  if (/ Interface References?$/.test(type)) return "--pin-interface";
  if (/ Structure$/.test(type)) return "--pin-struct";
  return null;
}

const typeDot = (type) => {
  const color = pinColorOf(type);
  return color ? `<span class="pin-dot" style="color: var(${color})">◉</span>` : "";
};

/**
 * Put a dot in the type's colour before every type a cell names: the whole cell in a Type
 * column or a variable type row, "(Float)" at the end of a name in the rows that add a variable,
 * input or output.
 */
function withTypeDots(text, cell, { wholeCell, parenthesized }) {
  if (wholeCell && typeDot(text)) {
    return `${typeDot(text)} ${cell}`;
  }
  if (parenthesized) {
    return cell.replace(/\(([^()<>]+)\)/g, (match, type) => (typeDot(type) ? `(${typeDot(type)} ${type})` : match));
  }
  return cell;
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
  const typeColumns = header.map((name) => /(^|\s)Type$/.test(name));
  const cells = (row, tag) => {
    // Rows that name types: a variable's type, and variables, inputs and outputs being added.
    const typeRow = /(Variable Type|^Add (Variable|Input|Output)|› Add (Input|Output|Local Variable)|Inputs|Outputs)$/.test(row[0]);
    return row
      .map((value, column) => {
        if (value === "—") {
          return `<${tag} class="none">—</${tag}>`;
        }
        // A Notifies cell holds one entry per notify, separated by "; ": shown as a list.
        if (tag === "td" && column > 0 && /Notifies$/.test(row[0])) {
          const items = value.split("; ").map((item) => `<li>${cellHtml(item)}</li>`);
          return `<td><ul class="notifies">${items.join("")}</ul></td>`;
        }
        const cell = cellHtml(value, tag === "td" && column > 0);
        const dotted = tag === "td" && column > 0
          ? withTypeDots(value, cell, { wholeCell: typeColumns[column] || /(Variable Type|Inputs|Outputs)$/.test(row[0]), parenthesized: typeRow })
          : cell;
        return `<${tag}>${dotted}</${tag}>`;
      })
      .join("");
  };
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

/**
 * The files of a doc in dependency order: when asset A refers to asset B of the same doc (its
 * parent class, a cast, a variable type, a class default, an actor's class), B's sections come
 * first, so students build what is needed before what needs it. Otherwise files keep the order
 * they come in (by path). Sections of one asset (settings, graph) stay together.
 *
 * What an asset refers to is read from its full export (graph/reference), or from its diff when
 * there is none: other assets' names as whole words ("Cast To BP_Hero", ".../BP_Hero.BP_Hero_C"),
 * or as the editor spells them in pin and variable types ("BP Hit Box Base Class Reference").
 * Comment boxes and commit descriptions don't count. Assets that refer to each other can't both
 * come first: then a child still follows its parent, and the asset with the fewest open
 * references comes next.
 */
function dependencyOrder(files, metas, folder) {
  const units = new Map();
  for (const file of files) {
    const meta = metas.get(file);
    const key = meta.source ?? file;
    if (!units.has(key)) {
      units.set(key, { key, meta, files: [], needs: new Set(), parent: null });
    }
    units.get(key).files.push(file);
  }
  // Within an asset: its settings table first, then its graphs (the event graphs before the
  // functions' graphs), whatever their file names sort like.
  const rank = (file) => {
    const meta = metas.get(file);
    return meta.part === "settings" ? 0 : /^(Function |Construction Script)/.test(meta.graph ?? "") ? 2 : 1;
  };
  for (const unit of units.values()) {
    unit.files.sort((a, b) => rank(a) - rank(b));
  }
  const quoted = String.raw`"(?:[^"\\]|\\.)*"`;
  const textOf = ({ meta }) => {
    if (!meta.source) {
      return "";
    }
    const diff = path.join(folder, meta.source);
    const reference = path.join(folder, meta.source.replace(/^graph\/transient\//, "graph/reference/"));
    const file = existsSync(reference) ? reference : diff;
    return existsSync(file)
      ? readFileSync(file, "utf8")
          .replace(new RegExp(String.raw`\((?:comment|description) ${quoted}`, "g"), "")
      : "";
  };
  // What other assets can refer to: Blueprints and assets, by name (actors provide nothing).
  const providers = [...units.values()]
    .filter(({ meta }) => (meta.kind === "blueprint" || meta.kind === "asset") && meta.package)
    .map((unit) => {
      const name = unit.meta.package.split("/").pop();
      const spelled = name
        .split(/_|(?<=[a-z])(?=[A-Z])|(?<=[A-Z0-9])(?=[A-Z][a-z])/)
        .filter(Boolean)
        .map(escapeRegExp)
        .join(" ?");
      return {
        unit,
        mention: new RegExp(
          `(?<![\\w-])${escapeRegExp(name)}(?:_C)?(?![\\w-])|(?<![\\w-])${spelled} (?:Soft )?(?:Object|Class) Reference`,
        ),
        asParent: new RegExp(`\\(parent "[^"]*[/.]${escapeRegExp(name)}(?:_C)?"\\)`),
      };
    });
  for (const unit of units.values()) {
    const text = textOf(unit);
    for (const provider of providers) {
      if (provider.unit !== unit && provider.mention.test(text)) {
        unit.needs.add(provider.unit);
        if (provider.asParent.test(text)) {
          unit.parent = provider.unit;
        }
      }
    }
  }
  const ordered = [];
  const done = new Set();
  const remaining = [...units.values()];
  const open = (unit) => [...unit.needs].filter((needed) => !done.has(needed)).length;
  while (remaining.length) {
    let next = remaining.find((unit) => open(unit) === 0);
    if (!next) {
      // Assets that refer to each other: never a child before its parent, then fewest open references.
      const candidates = remaining.filter((unit) => !unit.parent || done.has(unit.parent));
      next = (candidates.length ? candidates : remaining).reduce((best, unit) => (open(unit) < open(best) ? unit : best));
    }
    remaining.splice(remaining.indexOf(next), 1);
    done.add(next);
    ordered.push(...next.files);
  }
  return ordered;
}

/**
 * The "editor view" of one graph, below its diagram: the whole graph as the Blueprint editor
 * shows it, drawn in the browser by blueprintUE's renderer (Doc/bue-render) from the text
 * Unreal itself uses to copy nodes. The plugin writes that text per graph next to the diffs:
 * graph/native/<package path>.graph.<graph>.txt, and .old.txt for the last committed revision.
 * With both, the page shows blueprintUE's side-by-side comparison. doc.js starts the renderer;
 * the texts are embedded in the page (hidden textareas), so it works from disk too.
 * [] when the graph has no such text (steps exported before the plugin wrote it).
 */
/** The nodes of a graph's native text: name, class, position, text and the nodes its pins lead to. */
function nativeNodes(text) {
  const nodes = new Map();
  for (const block of text.match(/^Begin Object [^\n]*\n(?:(?!End Object)[^\n]*\n)*?End Object[^\n]*\n?/gm) ?? []) {
    const name = /Name="([^"]+)"/.exec(block)?.[1];
    const position = (axis) => Number(new RegExp(`NodePos${axis}=(-?\\d+)`).exec(block)?.[1] ?? 0);
    const targets = (list) => list.split(",").map((entry) => entry.trim().split(" ")[0]).filter(Boolean);
    const output = [...block.matchAll(/Direction="EGPD_Output"[^\n]*?LinkedTo=\(([^)]*)\)/g)].flatMap((m) => targets(m[1]));
    const linked = [...block.matchAll(/LinkedTo=\(([^)]*)\)/g)].flatMap((m) => targets(m[1]));
    nodes.set(name, {
      name,
      cls: /Class=\S+?\.(\w+)\s/.exec(block)?.[1],
      x: position("X"),
      y: position("Y"),
      block,
      links: output,
      linked,
    });
  }
  return nodes;
}

/**
 * The default events of a Blueprint (Event BeginPlay, ActorBeginOverlap, Tick, ...) that only
 * lost their place in a change: they were removed, or only moved, and had nothing attached (a call
 * of the parent's version doesn't count). Left in, they show up in the change list of the editor
 * view as removed or moved nodes, which says nothing about the code. They are taken out of both
 * texts, together with the Parent call that sat on them.
 */
function withoutIdleDefaultEvents(oldText, newText) {
  // No old text: a new Blueprint (or graph); everything in it counts as added.
  const before = nativeNodes(oldText ?? ""), after = nativeNodes(newText);
  const isParentCall = (node) => node?.cls === "K2Node_CallParentFunction";
  const children = (node, nodes) => node.links.filter((name) => !isParentCall(nodes.get(name)));
  const withoutPosition = (node) => node.block.replace(/^\s*NodePos[XY]=-?\d+\n/gm, "");
  const dropOld = new Set(), dropNew = new Set();
  const addWithParentCalls = (set, node, nodes) => {
    set.add(node.name);
    for (const name of node.links) {
      // The Parent call goes along when it is connected to nothing but this event.
      if (isParentCall(nodes.get(name)) && nodes.get(name).linked.every((other) => other === node.name)) {
        set.add(name);
      }
    }
  };
  for (const node of before.values()) {
    if (node.cls !== "K2Node_Event" || children(node, before).length) {
      continue;
    }
    const now = after.get(node.name);
    if (!now) {
      addWithParentCalls(dropOld, node, before);
    } else if (
      now.cls === "K2Node_Event" && !children(now, after).length &&
      (now.x !== node.x || now.y !== node.y) && withoutPosition(node) === withoutPosition(now)
    ) {
      addWithParentCalls(dropOld, node, before);
      addWithParentCalls(dropNew, now, after);
    }
  }
  // A Parent call (Parent: Receive Actor Begin Overlap) that is connected to nothing is as idle.
  for (const node of before.values()) {
    if (!isParentCall(node) || node.linked.length || dropOld.has(node.name)) {
      continue;
    }
    const now = after.get(node.name);
    if (!now) {
      dropOld.add(node.name);
    } else if (isParentCall(now) && !now.linked.length && (now.x !== node.x || now.y !== node.y) && withoutPosition(node) === withoutPosition(now)) {
      dropOld.add(node.name);
      dropNew.add(now.name);
    }
  }
  // Added ones with nothing attached (the BeginPlay, Tick, ... a new Blueprint starts with).
  for (const node of after.values()) {
    if (before.has(node.name)) {
      continue;
    }
    if (node.cls === "K2Node_Event" && !children(node, after).length) {
      addWithParentCalls(dropNew, node, after);
    } else if (isParentCall(node) && !node.linked.length) {
      dropNew.add(node.name);
    }
  }
  // blueprintUE's diff fails on a comment box that was added, removed or changed (it reads a title
  // such a node doesn't have), and then lists nothing at all. Those boxes are left out of both texts;
  // unchanged ones stay.
  const comments = (nodes) => [...nodes.values()].filter((node) => node.cls === "EdGraphNode_Comment");
  for (const node of comments(before)) {
    const now = after.get(node.name);
    if (!now || now.block !== node.block) {
      dropOld.add(node.name);
      if (now) {
        dropNew.add(node.name);
      }
    }
  }
  for (const node of comments(after)) {
    if (!before.has(node.name)) {
      dropNew.add(node.name);
    }
  }
  const strip = (text, nodes, names) => [...names].reduce((rest, name) => rest.replace(nodes.get(name).block, ""), text);
  return [strip(oldText, before, dropOld), strip(newText, after, dropNew)];
}

// The engine's object types, as the editor's dropdowns name them: the enum value `ObjectTypeQuery1`
// is "WorldStatic" there. Channels a project adds itself (ObjectTypeQuery7 and up) keep their value.
const OBJECT_TYPES = ["WorldStatic", "WorldDynamic", "Pawn", "PhysicsBody", "Vehicle", "Destructible"];

function withObjectTypeNames(text) {
  return text.replace(/\bObjectTypeQuery(\d+)\b/g, (match, n) => OBJECT_TYPES[Number(n) - 1] ?? match);
}

function editorView(folder, svgFile) {
  const base = path.join(folder, "graph", "native", svgFile.replace(/\.svg$/i, ""));
  if (!existsSync(`${base}.txt`)) {
    return [];
  }
  const area = (kind, text) => `        <textarea class="bue-${kind}" hidden>${html(text)}</textarea>`;
  let current = readFileSync(`${base}.txt`, "utf8");
  let before = existsSync(`${base}.old.txt`) ? readFileSync(`${base}.old.txt`, "utf8") : null;
  [before, current] = withoutIdleDefaultEvents(before, current);
  current = withObjectTypeNames(current);
  before = before === null ? null : withObjectTypeNames(before);
  const previous = before !== null ? [area("previous", before)] : [];
  return [
    `      <div class="editor-view">`,
    `        <p>${previous.length ? "Before (left) and after (right), with the list of changes" : "The graph to build"}</p>`,
    // How to move around in it (the renderer's own controls; doc.js makes the left button pan).
    `        <p class="hint">Move: hold the left mouse button and drag. Zoom: hold Ctrl and scroll the wheel. ` +
      `Reset and Fullscreen are in the top bar${previous.length ? "; both sides move together, Lock / Unlock switches that off and on" : ""}. ` +
      `Touch screen: drag with one finger, pinch with two.</p>`,
    `        <div class="bue-graph"></div>`,
    area("current", current),
    ...previous,
    "      </div>",
  ];
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
  // The rest in dependency order: what an asset refers to comes before it.
  const files = [
    ...allFiles.filter((file) => ["import", "origin"].includes(metas.get(file).kind)),
    // Retargets work on what the imports bring in; the rest may use the retargeted animations.
    ...allFiles.filter((file) => metas.get(file).kind === "retarget"),
    ...dependencyOrder(allFiles.filter((file) => !["import", "origin", "retarget"].includes(metas.get(file).kind)), metas, folder),
  ];
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
      // A MetaSound's graph is shown in the editor view (metasound_to_native.py), after its table.
      const graph = String(meta.class ?? "").startsWith("MetaSound") ? editorView(folder, file.replace(/\.svg$/i, ".graph.MetaSound.svg")) : [];
      return ["    <section>", `      <h2>${html(heading)}</h2>`, tableHtml(parseTable(readFileSync(tables.get(file), "utf8"))), ...graph, "    </section>"].join("\n");
    }
    // A graph with an editor view shows only that: its before-and-after comparison already
    // says what changed, so our own diagram of the same change would repeat it. The diagram
    // is still rendered (the section, its heading and its place in the page come from it).
    const view = editorView(folder, file);
    if (view.length) {
      return ["    <section>", `      <h2>${html(heading)}</h2>`, ...view, "    </section>"].join("\n");
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
  const withEditorView = sections.some((section) => section.includes('class="editor-view"'));

  // A list of links to the sections at the top of the page: every section gets an id (from its
  // heading, made unique) and the list jumps to it. The headings stay plain <h2> (the site index
  // reads them).
  const taken = new Set();
  const contents = [];
  sections.forEach((section, index) => {
    const heading = /<h2>([\s\S]*?)<\/h2>/.exec(section)?.[1];
    if (heading === undefined) {
      return;
    }
    const base = heading.replace(/&[a-z]+;/g, " ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "section";
    let id = base;
    for (let n = 2; taken.has(id); n++) {
      id = `${base}-${n}`;
    }
    taken.add(id);
    sections[index] = section.replace("<section>", `<section id="${id}">`);
    contents.push(`        <li><a href="#${id}">${heading.trim()}</a></li>`);
  });
  const contentsHtml = contents.length > 1
    ? ["    <nav class=\"toc\">", "      <p>Contents</p>", "      <ol>", ...contents, "      </ol>", "    </nav>"].join("\n") + "\n"
    : "";
  const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${html(title)}</title>
    <!-- Shared stylesheet, written by hand: Doc/doc.css (it imports the palettes, Doc/palettes.css) -->
    <link rel="stylesheet" href="../../doc.css">${withEditorView ? `
    <!-- The editor views: blueprintUE's renderer, kept as it is in Doc/bue-render, then the palettes for it -->
    <link rel="stylesheet" href="../../bue-render/render.css">
    <link rel="stylesheet" href="../../bue-render/diff.css">
    <link rel="stylesheet" href="../../bue-palettes.css">` : ""}
  </head>
  <body class="step" data-palette="default">
    <header>
      <label>Colours <select id="palette">${paletteOptions()}</select></label>
    </header>
${contentsHtml}${sections.join("\n")}
${withEditorView ? `    <script src="../../bue-render/render.js"></script>
    <script src="../../bue-render/diff.js"></script>
` : ""}    <!-- Palette switch and step navigation: Doc/doc.js -->
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
  // A Blueprint's diagrams are one file per graph: <name>.graph.<graph>.mmd.
  const stem = path.basename(diff).replace(/\.sexpr$/, "");
  const graphs = readdirSync(path.dirname(diff)).filter((name) => name.startsWith(`${stem}.graph.`) && name.endsWith(".mmd"));
  const outputs = [
    ...[".mmd", ".md", ".settings.md"].map((ext) => modified(diff.replace(/\.sexpr$/, ext))),
    ...graphs.map((name) => modified(path.join(path.dirname(diff), name))),
  ].filter(Boolean);
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
  // A MetaSound's graph, as the text the editor views are drawn from (graph/native).
  const metasounds = diffs.filter((file) => /\(class "MetaSound/.test(readFileSync(file, "utf8")));
  for (const batch of batches(metasounds)) {
    run(python, [path.join(toolsDir, "metasound_to_native.py"), ...batch]);
  }
  run(process.execPath, [path.join(toolsDir, "export_svg.mjs"), ...(force ? ["--force"] : [])]);
  writeDoc(transient);
}

/**
 * Write the website's shared files into the site root (Doc/): index.html listing the finished
 * steps in order as Step 1, Step 2, ... with their section headings (the dated folder names
 * only give the order), palettes.css and bue-palettes.css (the colour palettes from
 * Tools/palette.json, for the site and for blueprintUE's renderer; doc.css itself is written by
 * hand) and steps.js (the step folders in order, as a call of doc.js's docSteps).
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
    // Each section links to its place in the step's page (the section's id, when the page has one).
    const items = [...page.matchAll(/(?:<section(?: id="([^"]*)")?>\s*)?<h2>([\s\S]*?)<\/h2>/g)]
      .map((m) => {
        const text = html(unescape(m[2].trim()));
        return `          <li>${m[1] ? `<a href="commits/${folder}/doc.html#${m[1]}">${text}</a>` : text}</li>`;
      })
      .join("\n");
    const wip = folder === path.basename(transient) ? " (work in progress)" : "";
    return [
      `      <article id="step-${index + 1}">`,
      `        <h2><a href="commits/${folder}/doc.html">Step ${index + 1}</a>${wip}</h2>`,
      `        <ul>\n${items}\n        </ul>`,
      "      </article>",
    ].join("\n");
  });
  // The contents list: a jump marker to every step.
  const contents = [
    '      <nav class="toc">',
    "        <p>Contents</p>",
    "        <ol>",
    ...steps.map((folder, index) => {
      const wip = folder === path.basename(transient) ? " (work in progress)" : "";
      return `          <li><a href="#step-${index + 1}">Step ${index + 1}</a>${wip}</li>`;
    }),
    "        </ol>",
    "      </nav>",
  ].join("\n");
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
${contents}
${entries.join("\n")}
    </main>
  </body>
</html>
`;
  writeFileSync(path.join(siteDir, "index.html"), index, "utf8");
  // Generated from Tools/palette.json; doc.css (written by hand) imports the first, pages with
  // editor views link the second.
  writeFileSync(
    path.join(siteDir, "palettes.css"),
    `/* The colour palettes of the site (variables such as --pin-float, set on <body data-palette="...">).\n   Generated from Tools/palette.json by Tools/export_doc.mjs: don't edit. Imported by doc.css. */\n${paletteCss()}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(siteDir, "bue-palettes.css"),
    `/* The colour palettes for blueprintUE's renderer (Doc/bue-render) in the editor views.\n   Generated from Tools/palette.json (its "bue" section) by Tools/export_doc.mjs: don't edit.\n   Linked after bue-render/render.css by pages with editor views. */\n${bueCss()}\n`,
    "utf8",
  );
  // The step order as a script (doc.js loads it with a <script> element and it calls docSteps),
  // not as JSON to fetch: pages opened from disk aren't allowed to fetch files.
  writeFileSync(path.join(siteDir, "steps.js"), `docSteps(${JSON.stringify(steps, null, 2)});\n`, "utf8");
  rmSync(path.join(siteDir, "steps.json"), { force: true }); // its predecessor
  console.log(`Wrote ${path.relative(process.cwd(), siteDir)}: index.html, palettes.css, bue-palettes.css, steps.js (${steps.length} steps)`);
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
  // Only the website's shared files (index.html, palettes.css, bue-palettes.css, steps.js).
} else {
  build(process.argv.includes("--force"));
}
writeSite();
