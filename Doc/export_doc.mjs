// Build the documentation of the work in progress, and turn it into a dated snapshot when done.
//
//   node Doc/export_doc.mjs            (or: npm run export-doc, inside Doc/)
//   node Doc/export_doc.mjs --finish   (or: npm run finish-doc)
//
// Everything happens in Doc/commits/Transient. The editor plugin writes diffs to
// Transient/graph/transient (and full versions to Transient/graph/reference). Without options,
// this script writes a diagram (.mmd, sexpr_to_mermaid.py) or table (.md, sexpr_to_table.py)
// next to every diff, renders them all to SVG (export_svg.mjs), and writes Transient/doc.html,
// which embeds every SVG inline (IDs prefixed per SVG so their styles don't clash) and offers
// the colour palettes from Doc/palette.json.
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
// export_svg.mjs writes into each SVG, so every export folder describes itself.
//
// Pass --commits <dir> to use another commits folder (for testing), or
// --regenerate <export folder> to rewrite doc.html of an existing export without rebuilding.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docDir = path.dirname(fileURLToPath(import.meta.url));
const argIndex = process.argv.indexOf("--commits");
const commitsDir = argIndex > 0 ? path.resolve(process.argv[argIndex + 1]) : path.join(docDir, "commits");
const transient = path.join(commitsDir, "Transient");

function timestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Relative paths (with forward slashes) of all SVGs below a folder, sorted. */
function svgFiles(root, folder = root) {
  const files = [];
  for (const name of readdirSync(folder)) {
    const full = path.join(folder, name);
    if (statSync(full).isDirectory()) {
      files.push(...svgFiles(root, full));
    } else if (name.toLowerCase().endsWith(".svg")) {
      files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return files.sort();
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

/** CSS that applies a palette when doc.html's <body data-palette="..."> selects it. */
function paletteCss() {
  const palettes = JSON.parse(readFileSync(path.join(docDir, "palette.json"), "utf8")).palettes;
  return Object.entries(palettes)
    .map(([name, palette]) => {
      const variables = Object.entries(palette.colors)
        .map(([key, value]) => `--${key}: ${value};`)
        .join(" ");
      return `      body[data-palette="${name}"] svg { ${variables} }`;
    })
    .join("\n");
}

function paletteOptions() {
  const palettes = JSON.parse(readFileSync(path.join(docDir, "palette.json"), "utf8")).palettes;
  return Object.entries(palettes)
    .map(([name, palette]) => `<option value="${html(name)}">${html(palette.label ?? name)}</option>`)
    .join("");
}

function writeDoc(folder) {
  const title = `Documentation export ${path.basename(folder)}`;
  const files = svgFiles(folder);
  const metas = new Map(files.map((file) => [file, svgMetadata(path.join(folder, file))]));
  const withSettings = new Set([...metas.values()].filter((meta) => meta.part === "settings").map((meta) => meta.package));
  const sections = files.map((file, index) => {
    const meta = metas.get(file);
    const shownPath = browserPath(meta.package || "/" + file.replace(/\.svg$/i, ""));
    const heading = headingFor(meta, shownPath, withSettings.has(meta.package));
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
    <style>
      body { margin: 0; padding: 24px; background: #2b2b2b; color: #e6e6e6;
             font-family: "trebuchet ms", verdana, arial, sans-serif; }
      header { display: flex; justify-content: flex-end; }
      h2 { margin: 32px 0 12px; font-size: 17px; font-weight: normal; color: #ffffff; }
      label { font-size: 14px; }
      select { margin-left: 6px; font: inherit; }
      .figure svg { display: block; max-width: 100%; height: auto; }
      /* Palettes from Doc/palette.json. Each SVG carries the default palette at zero specificity. */
${paletteCss()}
    </style>
  </head>
  <body data-palette="default">
    <header>
      <label>Colours <select id="palette">${paletteOptions()}</select></label>
    </header>
${sections.join("\n")}
    <script>
      const select = document.getElementById("palette");
      const apply = (name) => {
        document.body.dataset.palette = name;
        select.value = name;
        try { localStorage.setItem("doc-palette", name); } catch (error) { /* storage unavailable */ }
      };
      let saved = null;
      try { saved = localStorage.getItem("doc-palette"); } catch (error) { /* storage unavailable */ }
      const requested = new URLSearchParams(location.search).get("palette") || saved;
      const known = [...select.options].map((option) => option.value);
      apply(known.includes(requested) ? requested : "default");
      select.addEventListener("change", () => apply(select.value));
    </script>
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
  if (diffs.length === 0) {
    console.error(`Nothing to export: ${path.relative(process.cwd(), transient)}/graph/transient has no diffs. Export some from the editor first.`);
    process.exit(1);
  }
  const outdated = force ? diffs : diffs.filter(needsGenerating);
  if (outdated.length < diffs.length) {
    console.log(`${diffs.length - outdated.length} diagram(s)/table(s) up to date, kept as they are.`);
  }
  const python = process.env.PYTHON ?? "python";
  const isBlueprint = (file) => /^\s*\(blueprint-diff\b/.test(readFileSync(file, "utf8"));
  const blueprints = outdated.filter(isBlueprint);
  if (blueprints.length) {
    run(python, [path.join(docDir, "sexpr_to_mermaid.py"), ...blueprints]);
  }
  // Tables for assets and actors, and each Blueprint's class defaults and components.
  if (outdated.length) {
    run(python, [path.join(docDir, "sexpr_to_table.py"), ...outdated]);
  }
  run(process.execPath, [path.join(docDir, "export_svg.mjs"), ...(force ? ["--force"] : [])]);
  writeDoc(transient);
}

/** Rename Transient to Doc/commits/<YYYYMMDD_HHmmss>, ready to commit. */
function finish() {
  if (!existsSync(path.join(transient, "doc.html"))) {
    console.error(`${path.relative(process.cwd(), transient)} has no doc.html. Run node Doc/export_doc.mjs first.`);
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
} else {
  build(process.argv.includes("--force"));
}
