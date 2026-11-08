// Render every Mermaid diagram (.mmd) and settings table (.md under Doc/graph/) that git
// reports as untracked or changed to SVG.
//
//   node Doc/export_svg.mjs        (or: npm run export-svg, inside Doc/)
//
// Output goes to Doc/commits/Transient/<package path>.svg, overwriting earlier exports, e.g.
//   Doc/graph/transient/Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.mmd
//   -> Doc/commits/Transient/Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.svg
//   Doc/graph/transient/Game/Input/Actions/IA_Zoom.md
//   -> Doc/commits/Transient/Game/Input/Actions/IA_Zoom.svg
//
// Needs `npm install` in Doc/ once. Rendering uses the Chrome set in Doc/puppeteer.json.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

// Table colours, matching the diagram style in AGENTS.md.
const TABLE = {
  font: "trebuchet ms, verdana, arial, sans-serif",
  fontSize: 14,
  body: "#151515",
  stripe: "#1c1c1c",
  header: "#262626",
  border: "#3a3a3a",
  text: "#ffffff",
  muted: "#777777",
  title: "#ffffff",
};

const docDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(docDir, "node_modules", "@mermaid-js", "mermaid-cli", "src", "cli.js");
const puppeteerConfig = path.join(docDir, "puppeteer.json");

if (!existsSync(cli)) {
  console.error("Mermaid CLI is missing. Run `npm install` in Doc/ first.");
  process.exit(1);
}

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: docDir, encoding: "utf8" }).trim();

/** Paths (relative to the repo) of diagrams and tables that are untracked or changed, not deleted. */
function changedSources() {
  const output = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const entries = output.split("\0").filter(Boolean);
  const files = [];
  for (let i = 0; i < entries.length; i++) {
    const status = entries[i].slice(0, 2);
    const file = entries[i].slice(3);
    if (status[0] === "R" || status[0] === "C") {
      i++; // the next entry is the original path of a rename or copy
    }
    const lower = file.toLowerCase();
    const isDiagram = lower.endsWith(".mmd");
    const isTable = lower.endsWith(".md") && lower.startsWith("doc/graph/");
    if (status.includes("D") || !(isDiagram || isTable)) {
      continue;
    }
    files.push(file);
  }
  return files.sort();
}

/** Doc/graph/<kind>/Game/X.mmd -> Game/X.svg; anything else keeps its path below Doc/. */
function packageRelativeSvg(file) {
  const parts = file.split("/");
  let rest = parts;
  if (parts[0] === "Doc" && parts[1] === "graph" && parts.length > 3) {
    rest = parts.slice(3);
  } else if (parts[0] === "Doc") {
    rest = parts.slice(1);
  }
  return path.join(...rest).replace(/\.(mmd|md)$/i, ".svg");
}

/** Title and rows of a table written by sexpr_to_table.py. */
function parseTable(markdown) {
  const lines = markdown.split(/\r?\n/);
  const title = (lines.find((line) => line.startsWith("### ")) ?? "").slice(4).trim();
  const rows = lines
    .filter((line) => line.startsWith("|") && !/^\|[\s|:-]+\|$/.test(line))
    .map((line) =>
      line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((value) => value.trim().replace(/\\\|/g, "|").replace(/`/g, "")),
    );
  return { title, rows };
}

function xml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Draw a table as SVG; text widths are measured in the browser so columns fit. */
async function tableSvg(page, { title, rows }) {
  const font = `${TABLE.fontSize}px ${TABLE.font}`;
  const boldFont = `bold ${font}`;
  const texts = rows.flatMap((row, index) => row.map((value) => [value, index === 0]));
  const widths = await page.evaluate(
    (items, plain, bold, heading) => {
      const context = document.createElement("canvas").getContext("2d");
      const measure = (text, f) => {
        context.font = f;
        return context.measureText(text).width;
      };
      return { cells: items.map(([text, isHeader]) => measure(text, isHeader ? bold : plain)), title: measure(heading, bold) };
    },
    texts,
    font,
    boldFont,
    title,
  );

  const padX = 12;
  const rowHeight = 28;
  const titleHeight = title ? 34 : 0;
  const columns = Math.max(...rows.map((row) => row.length));
  const columnWidths = Array(columns).fill(0);
  let index = 0;
  for (const row of rows) {
    row.forEach((_, column) => {
      columnWidths[column] = Math.max(columnWidths[column], Math.ceil(widths.cells[index++]) + 2 * padX);
    });
  }
  const tableWidth = columnWidths.reduce((a, b) => a + b, 0);
  const width = Math.max(tableWidth, Math.ceil(widths.title) + 2 * padX);
  columnWidths[columns - 1] += width - tableWidth;
  const height = titleHeight + rows.length * rowHeight;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width + 2}" height="${height + 2}" viewBox="-1 -1 ${width + 2} ${height + 2}">`,
    `<style>text{font-family:${TABLE.font};font-size:${TABLE.fontSize}px;dominant-baseline:central}</style>`,
    `<rect x="0" y="0" width="${width}" height="${height}" rx="6" fill="${TABLE.body}" stroke="${TABLE.border}" stroke-width="2"/>`,
  ];
  if (title) {
    parts.push(`<text x="${padX}" y="${titleHeight / 2}" fill="${TABLE.title}" font-weight="bold">${xml(title)}</text>`);
  }
  rows.forEach((row, rowIndex) => {
    const top = titleHeight + rowIndex * rowHeight;
    const fill = rowIndex === 0 ? TABLE.header : rowIndex % 2 === 0 ? TABLE.stripe : TABLE.body;
    parts.push(`<rect x="1" y="${top}" width="${width - 2}" height="${rowHeight}" fill="${fill}"/>`);
    parts.push(`<line x1="0" y1="${top}" x2="${width}" y2="${top}" stroke="${TABLE.border}"/>`);
    let left = 0;
    row.forEach((value, column) => {
      const colour = value === "—" ? TABLE.muted : TABLE.text;
      const weight = rowIndex === 0 ? ` font-weight="bold"` : "";
      parts.push(`<text x="${left + padX}" y="${top + rowHeight / 2}" fill="${colour}"${weight}>${xml(value)}</text>`);
      left += columnWidths[column];
      if (column < columns - 1) {
        parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + rowHeight}" stroke="${TABLE.border}"/>`);
      }
    });
  });
  parts.push("</svg>");
  return parts.join("\n") + "\n";
}

/**
 * Mermaid 10 draws every arrowhead from one shared grey marker, ignoring the
 * wire's colour. Give each wire colour its own copy of the marker instead.
 */
function colourArrowheads(svg) {
  const markers = new Map();
  for (const match of svg.matchAll(/<marker id="([^"]+)"[\s\S]*?<\/marker>/g)) {
    markers.set(match[1], match[0]);
  }

  const copies = new Map(); // original marker id -> Map(colour -> copy markup)
  const result = svg.replace(/<path\b[^>]*\bmarker-(?:end|start)="url\(#[^)]+\)"[^>]*>/g, (tag) => {
    const style = /\bstyle="([^"]*)"/.exec(tag)?.[1] ?? "";
    const strokes = [...style.matchAll(/(?:^|;)\s*stroke\s*:\s*([^;]+)/g)];
    if (strokes.length === 0) {
      return tag;
    }
    const colour = strokes[strokes.length - 1][1].trim();
    return tag.replace(/\bmarker-(end|start)="url\(#([^)]+)\)"/g, (attribute, side, id) => {
      const original = markers.get(id);
      if (!original) {
        return attribute;
      }
      const copyId = `${id}-${colour.replace(/[^a-zA-Z0-9]/g, "")}`;
      if (!copies.has(id)) {
        copies.set(id, new Map());
      }
      if (!copies.get(id).has(colour)) {
        const copy = original
          .replace(`id="${id}"`, `id="${copyId}"`)
          .replace(/style="/g, `style="fill:${colour};stroke:${colour};`);
        copies.get(id).set(colour, copy);
      }
      return `marker-${side}="url(#${copyId})"`;
    });
  });

  let output = result;
  for (const [id, byColour] of copies) {
    const original = markers.get(id);
    output = output.replace(original, original + [...byColour.values()].join(""));
  }
  return output;
}

// Namespace of the metadata written into each SVG; export_doc.mjs reads it.
const METADATA_NS = "urn:blueprint-diff-export";

/**
 * Facts about the asset an SVG shows, taken from the diff (.sexpr) next to its source file:
 * package path, kind, class, display type, whether it's new, and the compared revision.
 */
function assetMetadata(sourceFile) {
  const diffFile = sourceFile.replace(/\.(mmd|md)$/i, ".sexpr");
  if (!existsSync(diffFile)) {
    return null;
  }
  const diff = readFileSync(diffFile, "utf8");
  const kind = /^\s*\((asset-diff|blueprint-diff)\b/.exec(diff)?.[1];
  if (!kind) {
    return null;
  }
  const words = (name) => name.replace(/(?<=[a-z0-9])(?=[A-Z])/g, " ");
  const isBlueprint = kind === "blueprint-diff";
  const className = isBlueprint ? "Blueprint" : /\(class "([^"]+)"\)/.exec(diff)?.[1] ?? "Object";
  const fields = {
    package: /^\s*\(\S+ "([^"]+)"/.exec(diff)?.[1] ?? "",
    kind: isBlueprint ? "blueprint" : "asset",
    class: className,
    type: isBlueprint ? "Blueprint Class" : words(className),
    new: String(/^\s*\(old none\b/m.test(diff)),
    revision: /\(old \(revision "([^"]+)"\)/.exec(diff)?.[1] ?? "none",
  };
  if (isBlueprint) {
    fields.parent = /\(parent "([^"]*)"\)/.exec(diff)?.[1] ?? "";
  }
  const deletedIn = /\(deleted-in "([^"]+)"\)/.exec(diff)?.[1];
  if (deletedIn) {
    fields["deleted-in"] = deletedIn;
  }
  fields.source = path.relative(repoRoot, diffFile).split(path.sep).join("/");
  return fields;
}

/** Insert the asset metadata right after the opening <svg> tag. */
function withMetadata(svg, fields) {
  if (!fields) {
    return svg;
  }
  const attributes = Object.entries(fields)
    .map(([key, value]) => `${key}="${xml(value)}"`)
    .join(" ");
  const block = `<metadata><bde:asset xmlns:bde="${METADATA_NS}" ${attributes}/></metadata>`;
  return svg.replace(/<svg\b[^>]*>/, (tag) => tag + block);
}

// Elements whose content is kept on one line: adding whitespace inside text or HTML labels
// can change how the text renders.
const KEEP_INLINE = new Set(["text", "tspan", "foreignObject", "title", "desc"]);

/** Indent an SVG so each element is on its own line, without changing how it renders. */
function prettySvg(svg) {
  const tokens = svg.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]+>|[^<]+/g) ?? [];
  const root = { name: null, children: [], raw: "" };
  const stack = [root];
  for (const token of tokens) {
    const parent = stack[stack.length - 1];
    if (token.startsWith("</")) {
      parent.close = token;
      stack.pop();
      stack[stack.length - 1].children.push(parent);
    } else if (token.startsWith("<") && !token.startsWith("<!") && !token.startsWith("<?") && !token.endsWith("/>")) {
      stack.push({ name: /^<([^\s>/]+)/.exec(token)[1], open: token, children: [] });
    } else {
      parent.children.push(token);
    }
  }

  const raw = (node) => (typeof node === "string" ? node : node.open + node.children.map(raw).join("") + node.close);
  const hasText = (node) => node.children.some((child) => typeof child === "string" && child.trim() && !child.startsWith("<"));
  const lines = [];
  const write = (node, depth) => {
    const pad = "  ".repeat(depth);
    if (typeof node === "string") {
      if (node.trim()) {
        lines.push(pad + node.trim());
      }
    } else if (node.name === "style") {
      const css = node.children.map(raw).join("").replace(/\}\s*/g, "}\n").trim();
      lines.push(pad + node.open, ...css.split("\n").map((rule) => pad + "  " + rule.trim()), pad + node.close);
    } else if (KEEP_INLINE.has(node.name) || hasText(node)) {
      lines.push(pad + raw(node));
    } else {
      lines.push(pad + node.open);
      node.children.forEach((child) => write(child, depth + 1));
      lines.push(pad + node.close);
    }
  };
  root.children.forEach((child) => write(child, 0));
  return lines.join("\n") + "\n";
}

const sources = changedSources();
if (sources.length === 0) {
  console.log("No untracked or changed .mmd or Doc/graph .md files.");
  process.exit(0);
}

const outputRoot = path.join(docDir, "commits", "Transient");
const written = new Map();
let failures = 0;
let browser = null;

function claimOutput(file) {
  const relative = packageRelativeSvg(file);
  if (written.has(relative)) {
    console.warn(`Skipped ${file}: ${written.get(relative)} already renders to ${relative}`);
    return null;
  }
  written.set(relative, file);
  const output = path.join(outputRoot, relative);
  mkdirSync(path.dirname(output), { recursive: true });
  return output;
}

for (const file of sources.filter((f) => f.toLowerCase().endsWith(".md"))) {
  const table = parseTable(readFileSync(path.join(repoRoot, file), "utf8"));
  if (table.rows.length < 2) {
    console.log(`${file}: no table rows, skipped`);
    continue;
  }
  const output = claimOutput(file);
  if (!output) {
    continue;
  }
  browser ??= await puppeteer.launch(JSON.parse(readFileSync(puppeteerConfig, "utf8")));
  const page = await browser.newPage();
  const metadata = assetMetadata(path.join(repoRoot, file));
  writeFileSync(output, prettySvg(withMetadata(await tableSvg(page, table), metadata)), "utf8");
  await page.close();
  console.log(`${file} -> ${path.relative(repoRoot, output)}`);
}
await browser?.close();

for (const file of sources.filter((f) => f.toLowerCase().endsWith(".mmd"))) {
  const output = claimOutput(file);
  if (!output) {
    continue;
  }

  const result = spawnSync(
    process.execPath,
    [cli, "--input", path.join(repoRoot, file), "--output", output, "--backgroundColor", "transparent", "--puppeteerConfigFile", puppeteerConfig, "--quiet"],
    { encoding: "utf8" },
  );
  if (result.status === 0) {
    const metadata = assetMetadata(path.join(repoRoot, file));
    const svg = colourArrowheads(readFileSync(output, "utf8"));
    writeFileSync(output, prettySvg(withMetadata(svg, metadata)), "utf8");
    console.log(`${file} -> ${path.relative(repoRoot, output)}`);
  } else {
    failures++;
    console.error(`Failed to render ${file}:\n${result.stderr || result.stdout}`);
  }
}

process.exit(failures ? 1 : 0);
