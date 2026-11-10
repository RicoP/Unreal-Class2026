// Reading the sources of the documentation: the facts about the asset a diagram or table shows
// (taken from its diff), and the tables sexpr_to_table.py writes. Shared by export_svg.mjs, which
// writes the facts into each diagram SVG as <metadata>, and export_doc.mjs, which builds headings
// from them and turns the tables into HTML.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Where a diff lives, relative to its export folder (graph/transient/Game/X.sexpr), so the
 * path stays right when Transient is renamed to a dated folder. Outside an export folder:
 * relative to root.
 */
export function sourcePath(diffFile, root) {
  const parts = path.resolve(diffFile).split(path.sep);
  const graph = parts.lastIndexOf("graph");
  const relative = graph > 0 ? parts.slice(graph) : path.relative(root, diffFile).split(path.sep);
  return relative.join("/");
}

/** X.mmd, X.md and X.settings.md (a Blueprint's class defaults and components) -> X.sexpr */
export function diffFileOf(sourceFile) {
  return sourceFile.replace(/(\.settings)?\.(mmd|md)$/i, ".sexpr");
}

/**
 * Facts about the asset a diagram or table shows, taken from the diff (.sexpr) next to its
 * source file: package path, kind, class, display type, whether it's new, and the compared
 * revision. null if there is no diff to take them from.
 */
export function assetMetadata(sourceFile, root = process.cwd()) {
  if (/\.import\.md$/i.test(sourceFile)) {
    // One import step (sexpr_to_table.py): destination folder and source files, from its first line.
    const header = /<!-- import: folder="([^"]*)" files="([^"]*)" -->/.exec(readFileSync(sourceFile, "utf8"));
    return header ? { kind: "import", package: header[1], files: header[2], source: sourcePath(sourceFile, root) } : null;
  }
  const diffFile = diffFileOf(sourceFile);
  if (!existsSync(diffFile)) {
    return null;
  }
  const diff = readFileSync(diffFile, "utf8");
  const kind = /^\s*\((asset-diff|blueprint-diff|actor-diff)\b/.exec(diff)?.[1];
  if (!kind) {
    return null;
  }
  // "AnimSequence" -> "Anim Sequence"; "Texture2D" and runs of capitals stay together.
  const words = (name) => name.replace(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z0-9])(?=[A-Z][a-z])/g, " ");
  if (kind === "actor-diff") {
    // An actor placed in a level: package is the level, label the actor's name in the Outliner.
    const className = /\(class "([^"]+)"\)/.exec(diff)?.[1] ?? "Actor";
    const actorFields = {
      package: /^\s*\(\S+ "([^"]+)"/.exec(diff)?.[1] ?? "",
      kind: "actor",
      class: className,
      type: words(className.replace(/_C$/, "")),
      label: /\(label "([^"]*)"\)/.exec(diff)?.[1] ?? "",
      new: String(/^\s*\(old none\b/m.test(diff)),
      revision: /\(old \(revision "([^"]+)"\)/.exec(diff)?.[1] ?? "none",
      "actor-package": /\(package "([^"]*)"\)/.exec(diff)?.[1] ?? "",
    };
    actorFields.source = sourcePath(diffFile, root);
    return actorFields;
  }
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
    // A Blueprint can have two parts: its class defaults and components (table), and its graph.
    fields.part = /\.settings\.md$/i.test(sourceFile) ? "settings" : "graph";
  }
  const deletedIn = /\(deleted-in "([^"]+)"\)/.exec(diff)?.[1];
  if (deletedIn) {
    fields["deleted-in"] = deletedIn;
  }
  fields.source = sourcePath(diffFile, root);
  return fields;
}

/**
 * Title, component tree and rows (the first one is the header) of a table written by
 * sexpr_to_table.py. The tree is its "- name (type)" list, as [depth, text] (two spaces per level).
 */
export function parseTable(markdown) {
  const lines = markdown.split(/\r?\n/);
  const title = (lines.find((line) => line.startsWith("### ")) ?? "").slice(4).trim();
  const tree = lines
    .map((line) => /^( *)- (.+)$/.exec(line))
    .filter(Boolean)
    .map(([, indent, text]) => [indent.length / 2, text.trim()]);
  const rows = lines
    .filter((line) => line.startsWith("|") && !/^\|[\s|:-]+\|$/.test(line))
    .map((line) =>
      line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((value) => value.trim().replace(/\\\|/g, "|")),
    );
  return { title, tree, rows };
}
