// Build the GitHub Pages site from the documentation exports in Doc/commits.
//
//   node Doc/build_pages.mjs [output folder]      (default: _site)
//
// Copies every dated export (Doc/commits/<YYYYMMDD_HHmmss>/) with only what its doc.html
// shows: doc.html, SVGs and images. The graph/ source data (diffs, diagrams, tables) and the
// work in progress (Doc/commits/Transient) are left out. Writes an index.html listing the
// exports, newest first, with the section headings of each.
// Used by .github/workflows/pages.yml.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docDir = path.dirname(fileURLToPath(import.meta.url));
const commitsDir = path.join(docDir, "commits");
const outDir = path.resolve(process.argv[2] ?? "_site");

function html(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Copy an export's doc.html and the files it references (src="..."/href="...", such as level
 * screenshots). Its SVGs are embedded in the page, and graph/ holds only source data, so
 * nothing else is needed.
 */
function copyDocFiles(from, to) {
  mkdirSync(to, { recursive: true });
  const page = readFileSync(path.join(from, "doc.html"), "utf8");
  copyFileSync(path.join(from, "doc.html"), path.join(to, "doc.html"));
  let count = 1;
  const references = new Set([...page.matchAll(/\b(?:src|href)="([^"#?:]+)"/g)].map((m) => decodeURI(m[1])));
  for (const reference of references) {
    const source = path.join(from, reference);
    if (!source.startsWith(from + path.sep) || !existsSync(source) || !statSync(source).isFile()) {
      continue;
    }
    mkdirSync(path.dirname(path.join(to, reference)), { recursive: true });
    copyFileSync(source, path.join(to, reference));
    count++;
  }
  return count;
}

/** "20261109_105725" -> "2026-11-09 10:57" */
function readableDate(folder) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(folder);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : folder;
}

/** The section headings of a doc.html, as plain text. */
function headings(docFile) {
  const page = readFileSync(docFile, "utf8");
  const unescape = (text) =>
    text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  return [...page.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => unescape(m[1].trim()));
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const exports = readdirSync(commitsDir)
  .filter((name) => /^\d{8}_\d{6}$/.test(name) && existsSync(path.join(commitsDir, name, "doc.html")))
  .sort()
  .reverse();

const entries = exports.map((folder) => {
  const count = copyDocFiles(path.join(commitsDir, folder), path.join(outDir, folder));
  console.log(`${folder}: ${count} files`);
  const items = headings(path.join(commitsDir, folder, "doc.html"))
    .map((heading) => `          <li>${html(heading)}</li>`)
    .join("\n");
  return [
    "      <article>",
    `        <h2><a href="${folder}/doc.html">${html(readableDate(folder))}</a></h2>`,
    `        <ul>\n${items}\n        </ul>`,
    "      </article>",
  ].join("\n");
});

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Unreal Class 2026</title>
    <style>
      body { margin: 0; padding: 24px 16px; background: #2b2b2b; color: #e6e6e6;
             font-family: "trebuchet ms", verdana, arial, sans-serif; }
      main { max-width: 900px; margin: 0 auto; }
      h1 { margin: 0 0 24px; font-size: 24px; color: #ffffff; }
      h2 { margin: 24px 0 8px; font-size: 18px; font-weight: normal; }
      a { color: #7cc4ff; }
      ul { margin: 0; padding-left: 20px; color: #bdbdbd; font-size: 14px; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <h1>Unreal Class 2026</h1>
${entries.join("\n")}
    </main>
  </body>
</html>
`;
writeFileSync(path.join(outDir, "index.html"), page, "utf8");
// Serve files as they are (no Jekyll processing on GitHub Pages).
writeFileSync(path.join(outDir, ".nojekyll"), "");
console.log(`Wrote ${path.relative(process.cwd(), outDir)} with ${exports.length} exports`);
