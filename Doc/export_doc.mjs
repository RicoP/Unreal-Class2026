// Turn the current SVG export into a dated documentation snapshot.
//
//   node Doc/export_doc.mjs        (or: npm run export-doc, inside Doc/)
//
// Copies Doc/commits/Transient to Doc/commits/<YYYYMMDD_HHmmss> and writes doc.md there,
// which embeds every SVG by its relative path. That path is the asset's package path, e.g.
//   Game/Input/Actions/IA_Zoom.svg  ->  /Game/Input/Actions/IA_Zoom
// In doc.md text, package paths are shown as the Content Browser shows them:
//   /Game/Input/Actions/IA_Zoom     ->  All/Content/Input/Actions/IA_Zoom
//
// New assets get the heading "Create <asset type> at <package path>" instead of just the
// package path. Whether an asset is new, and its type, come from the <metadata> block that
// export_svg.mjs writes into each SVG, so every export folder describes itself.
//
// Pass --commits <dir> to use another commits folder (for testing), or
// --regenerate <export folder> to rewrite doc.md of an existing export without moving anything.

import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

function writeDoc(folder) {
  const lines = [`# Documentation export ${path.basename(folder)}`, ""];
  for (const file of svgFiles(folder)) {
    const meta = svgMetadata(path.join(folder, file));
    const shownPath = browserPath(meta.package || "/" + file.replace(/\.svg$/i, ""));
    const heading = meta.new === "true" ? `Create ${meta.type} at ${shownPath}` : shownPath;
    const link = /\s/.test(file) ? `<${file}>` : file;
    lines.push(`## ${heading}`, "", `![${shownPath}](${link})`, "");
  }
  const docFile = path.join(folder, "doc.md");
  writeFileSync(docFile, lines.join("\n"), "utf8");
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
// Transient/.gitignore keeps the working folder out of git; the dated export must not inherit it.
cpSync(transient, target, { recursive: true, filter: (source) => path.basename(source) !== ".gitignore" });
console.log(`Copied ${path.relative(process.cwd(), transient)} -> ${path.relative(process.cwd(), target)}`);
writeDoc(target);
