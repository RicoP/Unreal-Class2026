// Render every Mermaid diagram (.mmd) that git reports as untracked or changed to SVG.
//
//   node Doc/export_svg.mjs        (or: npm run export-svg, inside Doc/)
//
// Output goes to Doc/commits/<YYYYMMDD_HHmmss>/<package path>.svg, for example
//   Doc/graph/transient/Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.mmd
//   -> Doc/commits/20261107_143000/Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.svg
//
// Needs `npm install` in Doc/ once. Rendering uses the Chrome set in Doc/puppeteer.json.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(docDir, "node_modules", "@mermaid-js", "mermaid-cli", "src", "cli.js");
const puppeteerConfig = path.join(docDir, "puppeteer.json");

if (!existsSync(cli)) {
  console.error("Mermaid CLI is missing. Run `npm install` in Doc/ first.");
  process.exit(1);
}

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: docDir, encoding: "utf8" }).trim();

/** Paths (relative to the repo) of .mmd files that are untracked or changed, not deleted. */
function changedDiagrams() {
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
    if (status.includes("D") || !file.toLowerCase().endsWith(".mmd")) {
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
  return path.join(...rest).replace(/\.mmd$/i, ".svg");
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

function timestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

const diagrams = changedDiagrams();
if (diagrams.length === 0) {
  console.log("No untracked or changed .mmd files.");
  process.exit(0);
}

const outputRoot = path.join(docDir, "commits", timestamp(new Date()));
const written = new Map();
let failures = 0;

for (const file of diagrams) {
  const relative = packageRelativeSvg(file);
  if (written.has(relative)) {
    console.warn(`Skipped ${file}: ${written.get(relative)} already renders to ${relative}`);
    continue;
  }
  const output = path.join(outputRoot, relative);
  mkdirSync(path.dirname(output), { recursive: true });

  const result = spawnSync(
    process.execPath,
    [cli, "--input", path.join(repoRoot, file), "--output", output, "--backgroundColor", "transparent", "--puppeteerConfigFile", puppeteerConfig, "--quiet"],
    { encoding: "utf8" },
  );
  if (result.status === 0) {
    writeFileSync(output, colourArrowheads(readFileSync(output, "utf8")), "utf8");
    written.set(relative, file);
    console.log(`${file} -> ${path.relative(repoRoot, output)}`);
  } else {
    failures++;
    console.error(`Failed to render ${file}:\n${result.stderr || result.stdout}`);
  }
}

process.exit(failures ? 1 : 0);
