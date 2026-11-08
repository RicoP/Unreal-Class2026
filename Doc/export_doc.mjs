// Turn the current SVG export into a dated documentation snapshot.
//
//   node Doc/export_doc.mjs        (or: npm run export-doc, inside Doc/)
//
// Copies Doc/commits/Transient to Doc/commits/<YYYYMMDD_HHmmss> and writes doc.html there,
// which embeds every SVG inline (IDs prefixed per SVG so their styles don't clash) and offers
// the colour palettes from Doc/palette.json. The SVG files stay next to doc.html.
// Also copies Doc/graph (diffs, references, diagrams, tables) to <export>/graph, so the export
// keeps the source data it was made from. That path is the asset's package path, e.g.
//   Game/Input/Actions/IA_Zoom.svg  ->  /Game/Input/Actions/IA_Zoom
// In doc.html text, package paths are shown as the Content Browser shows them:
//   /Game/Input/Actions/IA_Zoom     ->  All/Content/Input/Actions/IA_Zoom
//
// New assets get the heading "Create <asset type> at <package path>" instead of just the
// package path. Whether an asset is new, and its type, come from the <metadata> block that
// export_svg.mjs writes into each SVG, so every export folder describes itself.
//
// Pass --commits <dir> to use another commits folder (for testing), or
// --regenerate <export folder> to rewrite doc.html of an existing export without copying anything.

import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  const sections = svgFiles(folder).map((file, index) => {
    const meta = svgMetadata(path.join(folder, file));
    const shownPath = browserPath(meta.package || "/" + file.replace(/\.svg$/i, ""));
    const heading = meta.new === "true" ? `Create ${meta.type} at ${shownPath}` : shownPath;
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
      header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 12px; }
      h1 { margin: 0 0 24px; font-size: 22px; }
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
      <h1>${html(title)}</h1>
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

const regenerateIndex = process.argv.indexOf("--regenerate");
if (regenerateIndex > 0) {
  writeDoc(path.resolve(process.argv[regenerateIndex + 1]));
  process.exit(0);
}

if (!existsSync(transient) || svgFiles(transient).length === 0) {
  console.error(`Nothing to export: ${path.relative(process.cwd(), transient)} has no SVGs. Run export_svg.mjs first.`);
  process.exit(1);
}

const target = path.join(commitsDir, timestamp(new Date()));
if (existsSync(target)) {
  console.error(`${target} already exists.`);
  process.exit(1);
}
cpSync(transient, target, { recursive: true });
console.log(`Copied ${path.relative(process.cwd(), transient)} -> ${path.relative(process.cwd(), target)}`);

const graphDir = path.join(docDir, "graph");
if (existsSync(graphDir)) {
  cpSync(graphDir, path.join(target, "graph"), { recursive: true });
  console.log(`Copied ${path.relative(process.cwd(), graphDir)} -> ${path.relative(process.cwd(), path.join(target, "graph"))}`);
} else {
  console.warn(`No ${path.relative(process.cwd(), graphDir)} folder; the export has no source data.`);
}
writeDoc(target);
