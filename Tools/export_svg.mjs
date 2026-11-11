// Render every Mermaid diagram (.mmd) of the documentation being worked on, in
// Doc/commits/Transient/graph/transient/, to SVG. Tables (.md) aren't rendered: export_doc.mjs
// writes them into doc.html as HTML tables.
//
//   node Tools/export_svg.mjs        (or: npm run export-svg, inside Tools/)
//
// Output goes to Doc/commits/Transient/<package path>.svg. An SVG newer than its source, its
// diff, this script, doc_sources.mjs and palette.json is skipped (--force renders all), and
// SVGs whose source is gone are removed (also the table SVGs of earlier versions). e.g.
//   Doc/commits/Transient/graph/transient/Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.mmd
//   -> Doc/commits/Transient/Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter.svg
// With file arguments, renders exactly those files, each SVG next to its source.
//
// Needs `npm install` in Tools/ once. Rendering uses the Chrome set in Tools/puppeteer.json.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
import { assetMetadata, diffFileOf } from "./doc_sources.mjs";

// Colours live in Tools/palette.json. Exported SVGs refer to them as CSS variables
// (var(--pin-float)) and carry the default palette, so a page can switch palettes.
const docDirEarly = path.dirname(fileURLToPath(import.meta.url));
const paletteConfig = JSON.parse(readFileSync(path.join(docDirEarly, "palette.json"), "utf8"));
const palettes = paletteConfig.palettes;
const defaultColours = palettes.default.colors;
const dimConfig = paletteConfig.dim;

/** Same mix as dim() in sexpr_to_mermaid.py: <amount> of the colour, the rest node-body. */
function dimmed(hex) {
  const body = defaultColours["node-body"];
  const channel = (colour, i) => parseInt(colour.slice(i, i + 2), 16);
  return (
    "#" +
    [1, 3, 5]
      .map((i) => Math.floor(channel(hex, i) * dimConfig.amount + channel(body, i) * (1 - dimConfig.amount) + 0.5))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

const colourNames = new Map(); // "#38d500" -> "pin-float", "#256b0c" -> "pin-float-dim"
const nameColour = (name, value) => {
  const key = value.toLowerCase();
  if (colourNames.has(key)) {
    console.error(`palette.json: ${colourNames.get(key)} and ${name} are both ${value} in the default palette; they must differ.`);
    process.exit(1);
  }
  colourNames.set(key, name);
};
for (const [name, value] of Object.entries(defaultColours)) {
  nameColour(name, value);
}
for (const name of dimConfig.colors) {
  nameColour(`${name}-dim`, dimmed(defaultColours[name]));
}

/** Replace default palette colours (hex or rgb()) in a rendered SVG with their CSS variables. */
function useColourVariables(svg) {
  const toVariable = (hex) => {
    const name = colourNames.get(hex.toLowerCase());
    return name ? `var(--${name})` : null;
  };
  return svg
    .replace(/#[0-9a-fA-F]{6}(?![0-9a-fA-F])/g, (hex) => toVariable(hex) ?? hex)
    .replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*1(?:\.0+)?\s*)?\)/g, (match, r, g, b) => {
      const hex = "#" + [r, g, b].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
      return toVariable(hex) ?? match;
    });
}

/**
 * Add the default palette to an SVG. :where() gives it zero specificity, so a page that
 * shows the SVG inline can override any colour with its own CSS.
 */
function withPalette(svg) {
  // Dimmed colours are derived from the current ones, so every palette dims automatically.
  const percent = Math.round(dimConfig.amount * 100);
  const variables =
    Object.entries(defaultColours)
      .map(([name, value]) => `--${name}:${value};`)
      .join("") +
    dimConfig.colors
      .map((name) => `--${name}-dim:color-mix(in srgb, var(--${name}) ${percent}%, var(--node-body));`)
      .join("");
  return svg.replace(/<svg\b[^>]*>/, (tag) => `${tag}<style>:where(svg){${variables}}</style>`);
}

/**
 * Remove the inner margin of Blueprint node boxes (subgraphs N_...) that have pin rows.
 * Mermaid has no setting for it (dagre spaces the pins away from the border), so this
 * runs on the rendered SVG: each box shrinks to its title and pin rows, the title is
 * re-centred, and wires that end on the box border are extended to the new border.
 * Pin rows don't move, so wires attached to pins keep their anchor points.
 */
async function tightenNodeBoxes(page, svgFile, mmdSource) {
  // "%% pin-order a b c" (from sexpr_to_mermaid.py): rows that must be stacked in this order.
  const pinOrders = [...mmdSource.matchAll(/^\s*%% pin-order (.+)$/gm)].map((m) => m[1].trim().split(/\s+/));
  // Comment boxes (subgraphs C_...) and the node boxes and comments directly inside them.
  const commentChildren = {};
  const open = [];
  for (const line of mmdSource.split(/\r?\n/)) {
    const subgraph = /^\s*subgraph\s+([^\s[]+)/.exec(line);
    if (subgraph) {
      const parent = open[open.length - 1];
      if (parent?.startsWith("C_")) (commentChildren[parent] ??= []).push(subgraph[1]);
      open.push(subgraph[1]);
    } else if (/^\s*end\s*$/.test(line)) {
      open.pop();
    }
  }
  await page.goto(pathToFileURL(svgFile).href);
  return page.evaluate((pinOrders, commentChildren) => {
    const svg = document.documentElement;
    const pairPattern = /(-?[\d.]+(?:e-?\d+)?),(-?[\d.]+(?:e-?\d+)?)/g;
    const TITLE_SIDE = 16; // px between a node's title and its left and right border, at least

    // Shift the end of a wire by (dx, dy), fading to nothing over the first <= 60 px of the wire,
    // so only the part next to the moved row bends. atStart: the wire's start (else its end).
    const bendWire = (path, dx, dy, atStart) => {
      const d = path.getAttribute("d");
      const points = [...d.matchAll(pairPattern)].map((m) => [Number(m[1]), Number(m[2])]);
      if (!atStart) points.reverse();
      const distance = [0];
      for (let i = 1; i < points.length; i++) {
        distance.push(distance[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
      }
      const fade = Math.max(1, Math.min(60, distance[distance.length - 1] / 2));
      const weights = distance.map((s) => {
        const t = Math.min(1, s / fade);
        return 1 - t * t * (3 - 2 * t);
      });
      if (!atStart) weights.reverse();
      let i = 0;
      path.setAttribute(
        "d",
        d.replace(pairPattern, (_, x, y) => {
          const w = weights[i++];
          return `${Number(x) + dx * w},${Number(y) + dy * w}`;
        }),
      );
    };

    // Put rows back in pin order: the rows keep their slots (y positions) and swap who sits where.
    for (const ids of pinOrders) {
      const rows = ids.map((id) => svg.querySelector(`g.node[data-id="${id}"]`));
      if (rows.some((r) => !r)) continue;
      const position = (row) => row.getAttribute("transform").match(/translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/);
      const slots = rows.map((r) => Number(position(r)[2])).sort((a, b) => a - b);
      rows.forEach((row, i) => {
        const [, x, y] = position(row);
        const dy = slots[i] - Number(y);
        if (Math.abs(dy) < 0.01) return;
        row.setAttribute("transform", `translate(${x}, ${slots[i]})`);
        for (const path of svg.querySelectorAll(`path.flowchart-link.LS-${CSS.escape(ids[i])}`)) bendWire(path, 0, dy, true);
        for (const path of svg.querySelectorAll(`path.flowchart-link.LE-${CSS.escape(ids[i])}`)) bendWire(path, 0, dy, false);
      });
    }

    // Anchor rows only steer the layout (see sexpr_to_mermaid.py); they aren't drawn.
    for (const anchor of svg.querySelectorAll("g.node.pin_anchor")) anchor.remove();
    const toLocal = (el, x, y) => {
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM().inverse());
      return [p.x, p.y];
    };
    const toScreen = (el, x, y) => {
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM());
      return [p.x, p.y];
    };
    const localBox = (frame, el) => {
      const r = el.getBoundingClientRect();
      const [left, top] = toLocal(frame, r.left, r.top);
      const [right, bottom] = toLocal(frame, r.right, r.bottom);
      return { left, top, right, bottom };
    };

    const clusters = [...svg.querySelectorAll("g.cluster")].filter((c) => c.id.startsWith("N_"));
    const ids = clusters.map((c) => c.id).sort((a, b) => b.length - a.length);
    const members = new Map(ids.map((id) => [id, []]));
    for (const node of svg.querySelectorAll("g.node[data-id]")) {
      if (node.classList.contains("pin_anchor")) continue; // invisible layout helper, not a pin row
      const owner = ids.find((id) => node.dataset.id.startsWith(id + "_"));
      if (owner) members.get(owner).push(node);
    }

    // How far mermaid stops wires short of a pin row (room for the arrowhead), measured on wires
    // that end on input rows; wires rerouted to a box border below keep the same gap.
    const rowGaps = [];
    for (const path of svg.querySelectorAll("path.flowchart-link[marker-end]")) {
      const end = [...path.classList].find((c) => c.startsWith("LE-"))?.slice(3);
      const row = end && svg.querySelector(`g.node[data-id="${CSS.escape(end)}"]`);
      if (!row) continue;
      const total = path.getTotalLength();
      const p = path.getPointAtLength(total);
      const [sx, sy] = toScreen(path, p.x, p.y);
      const gap = row.getBoundingClientRect().left - sx;
      if (gap > -1 && gap < 20) rowGaps.push(gap);
    }
    rowGaps.sort((a, b) => a - b);
    const arrowGap = rowGaps.length ? rowGaps[Math.floor(rowGaps.length / 2)] : 0;

    const boxes = new Map(); // cluster id -> { rect, old, now, wireY }
    for (const cluster of clusters) {
      const pins = members.get(cluster.id);
      const rect = cluster.querySelector(":scope > rect");
      const label = cluster.querySelector(":scope > g.cluster-label");
      if (!rect) continue;
      if (!pins.length || !label) {
        // Collapsed nodes keep their shape; wires to them attach at the middle of a side.
        const r = { left: rect.x.baseVal.value, top: rect.y.baseVal.value };
        r.right = r.left + rect.width.baseVal.value;
        r.bottom = r.top + rect.height.baseVal.value;
        boxes.set(cluster.id, { rect, old: r, now: r, wireY: (r.top + r.bottom) / 2, collapsed: true });
        continue;
      }
      const pinBoxes = pins.map((p) => localBox(rect, p));
      const pin = {
        left: Math.min(...pinBoxes.map((b) => b.left)),
        right: Math.max(...pinBoxes.map((b) => b.right)),
        top: Math.min(...pinBoxes.map((b) => b.top)),
        bottom: Math.max(...pinBoxes.map((b) => b.bottom)),
      };
      const old = {
        left: rect.x.baseVal.value,
        top: rect.y.baseVal.value,
        right: rect.x.baseVal.value + rect.width.baseVal.value,
        bottom: rect.y.baseVal.value + rect.height.baseVal.value,
      };
      const title = localBox(rect, label);
      const titleMargin = title.top - old.top; // subGraphTitleMargin.top
      // Some room beside the title, where wires to the box itself arrive and leave.
      const width = Math.max(pin.right - pin.left, title.right - title.left + 2 * TITLE_SIDE);
      const centre = (pin.left + pin.right) / 2;
      const now = {
        left: centre - width / 2,
        right: centre + width / 2,
        top: pin.top - 2 * titleMargin - (title.bottom - title.top),
        bottom: pin.bottom,
      };
      rect.setAttribute("x", now.left);
      rect.setAttribute("y", now.top);
      rect.setAttribute("width", now.right - now.left);
      rect.setAttribute("height", now.bottom - now.top);
      const [, tx, ty] = label.getAttribute("transform").match(/translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/);
      const dx = centre - (title.left + title.right) / 2;
      const dy = now.top + titleMargin - title.top;
      label.setAttribute("transform", `translate(${Number(tx) + dx}, ${Number(ty) + dy})`);
      // Wires to the box itself (omitted exec pins) attach beside the title, where the editor
      // has a node's exec pins.
      boxes.set(cluster.id, { rect, old, now, wireY: (now.top + pin.top) / 2 });

      // Input rows sit flush with the left border, output rows with the right one, so wires
      // reach their pins from outside the node. Their wires bend along.
      pins.forEach((row, i) => {
        const output = /text-align:\s*right/.test(row.innerHTML);
        const shift = output ? now.right - pinBoxes[i].right : now.left - pinBoxes[i].left;
        if (Math.abs(shift) < 0.5) return;
        const [, x, y] = row.getAttribute("transform").match(/translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/);
        row.setAttribute("transform", `translate(${Number(x) + shift}, ${y})`);
        const id = CSS.escape(row.dataset.id);
        for (const path of svg.querySelectorAll(`path.flowchart-link.LS-${id}`)) bendWire(path, shift, 0, true);
        for (const path of svg.querySelectorAll(`path.flowchart-link.LE-${id}`)) bendWire(path, shift, 0, false);
      });
    }
    // Pin rows now touch the border and their body-coloured fill would cover it, so draw the
    // borders once more on top of everything.
    for (const { rect, collapsed } of boxes.values()) {
      if (collapsed) continue;
      const border = rect.cloneNode();
      border.removeAttribute("id");
      border.style.fill = "none";
      border.style.pointerEvents = "none";
      const m = svg.getScreenCTM().inverse().multiply(rect.getScreenCTM());
      border.setAttribute("transform", `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`);
      svg.appendChild(border);
    }

    // Move a wire end that lies on a box's old border onto the same side of the new border,
    // keeping its small gap (room for the arrowhead).
    const moved = (box, x, y) => {
      const { old, now } = box;
      const sides = [
        ["left", Math.abs(x - old.left)],
        ["right", Math.abs(x - old.right)],
        ["top", Math.abs(y - old.top)],
        ["bottom", Math.abs(y - old.bottom)],
      ].sort((a, b) => a[1] - b[1]);
      const side = sides[0][0];
      const clamp = (v, lo, hi) => Math.min(Math.max(v, lo + 2), hi - 2);
      if (side === "left" || side === "right") {
        return [x - old[side] + now[side], clamp(y, now.top, now.bottom)];
      }
      return [clamp(x, now.left, now.right), y - old[side] + now[side]];
    };
    const number = "([-\\d.e]+)";
    // Split a path into its commands; each command's last pair is the point it ends at.
    const segments = (d) =>
      [...d.matchAll(/([MLC])([^MLC]*)/g)].map((m) => {
        const pairs = [...m[2].matchAll(pairPattern)].map((p) => [Number(p[1]), Number(p[2])]);
        return { text: m[0], end: pairs[pairs.length - 1] };
      });
    const curve = (from, to) => {
      const h = Math.max(20, Math.abs(to[0] - from[0]) / 2);
      return `C${from[0] + h},${from[1]},${to[0] - h},${to[1]},${to[0]},${to[1]}`;
    };
    const RUN = 40; // the new curve needs at least this much horizontal room
    // Incoming wires enter a box from the left, outgoing ones leave it to the right, like
    // Blueprint wires. The wire keeps its route up to where it is still RUN px clear of that
    // side, then curves in horizontally. Returns null if the route never gets clear (a wire
    // coming from the far side): those keep the old behaviour.
    // (screenX, screenY): the point on the border where the wire should arrive or leave.
    const enterFromLeft = (path, screenX, screenY) => {
      const parts = segments(path.getAttribute("d"));
      const [tx, ty] = toLocal(path, screenX, screenY);
      const target = [tx - arrowGap, ty];
      const last = parts[parts.length - 1].end;
      if (Math.abs(last[0] - target[0]) < 1.5 && Math.abs(last[1] - target[1]) < 4) return null; // already there
      let k = parts.length - 1;
      while (k >= 0 && parts[k].end[0] > target[0] - RUN) k--;
      if (k < 0) return null;
      return parts.slice(0, k + 1).map((p) => p.text).join("") + curve(parts[k].end, target);
    };
    const leaveToRight = (path, screenX, screenY) => {
      const parts = segments(path.getAttribute("d"));
      const [sx, sy] = toLocal(path, screenX, screenY);
      const first = parts[0].end;
      if (Math.abs(first[0] - sx) < 1.5 && Math.abs(first[1] - sy) < 4) return null; // already there
      let k = 0;
      while (k < parts.length && parts[k].end[0] < sx + RUN) k++;
      if (k >= parts.length) return null;
      return `M${sx},${sy}` + curve([sx, sy], parts[k].end) + parts.slice(k + 1).map((p) => p.text).join("");
    };

    // Wires of omitted exec pins end at the node's anchor rows (removed above); they belong to the box.
    const boxId = (id) => id?.replace(/_anchor_(in|out)$/, "");
    // The node (cluster id) a wire end belongs to: the box itself, or the node owning a pin row.
    const ownerBox = (id) => (id && (boxes.has(id) ? id : ids.find((c) => id.startsWith(c + "_")))) || null;
    // Does curve d (in path's coordinates) pass through any node box other than the skipped ones?
    const nodeRects = clusters.map((c) => [c.id, c.querySelector(":scope > rect")]).filter(([, r]) => r);
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const crossesNode = (path, d, skip) => {
      probe.setAttribute("d", d);
      path.parentNode.appendChild(probe);
      const total = probe.getTotalLength();
      const ctm = probe.getScreenCTM();
      const points = [];
      for (let s = 0; s <= total; s += 4) points.push(new DOMPoint(probe.getPointAtLength(s).x, probe.getPointAtLength(s).y).matrixTransform(ctm));
      probe.remove();
      return nodeRects.some(([id, rect]) => {
        if (skip.includes(id)) return false;
        const r = rect.getBoundingClientRect();
        return points.some((p) => p.x > r.left + 1 && p.x < r.right - 1 && p.y > r.top + 1 && p.y < r.bottom - 1);
      });
    };
    for (const path of svg.querySelectorAll("path.flowchart-link")) {
      const end = boxId([...path.classList].find((c) => c.startsWith("LE-"))?.slice(3));
      const start = boxId([...path.classList].find((c) => c.startsWith("LS-"))?.slice(3));
      const toAnchor = /_anchor_in$/.test([...path.classList].find((c) => c.startsWith("LE-")) ?? "");
      const fromAnchor = /_anchor_out$/.test([...path.classList].find((c) => c.startsWith("LS-")) ?? "");
      // Loop wires are drawn backwards without arrowhead (see back-edge comments); leave them.
      const forward = path.hasAttribute("marker-end");
      let endDone = false;
      let startDone = false;
      // A pin row: wires arrive at the middle of its left side and leave from its right side.
      const rowSide = (id, side) => {
        const row = id && svg.querySelector(`g.node[data-id="${CSS.escape(id)}"]`);
        if (!row) return null;
        const r = row.querySelector("rect, polygon")?.getBoundingClientRect() ?? row.getBoundingClientRect();
        return [side === "left" ? r.left : r.right, r.top + r.height / 2];
      };
      if (forward) {
        const box = boxes.get(end);
        const at = box ? toScreen(box.rect, box.now.left, box.wireY) : rowSide(end, "left");
        const rerouted = at && enterFromLeft(path, ...at);
        if (rerouted) path.setAttribute("d", rerouted);
        endDone = !!rerouted;
      }
      if (forward) {
        const box = boxes.get(start);
        const at = box ? toScreen(box.rect, box.now.right, box.wireY) : rowSide(start, "right");
        const rerouted = at && leaveToRight(path, ...at);
        if (rerouted) path.setAttribute("d", rerouted);
        startDone = !!rerouted;
      }
      // A wire to or from an anchor that can't be rerouted (it comes from the far side) would
      // end inside the box, where the anchor was: draw it as one curve between the borders.
      if ((toAnchor && !endDone) || (fromAnchor && !startDone)) {
        const parts = segments(path.getAttribute("d"));
        let first = parts[0].end;
        let last = parts[parts.length - 1].end;
        if (toAnchor && !endDone) {
          const box = boxes.get(end);
          const [x, y] = toLocal(path, ...toScreen(box.rect, box.now.left, box.wireY));
          last = [x - arrowGap, y];
        }
        if (fromAnchor && !startDone) {
          const box = boxes.get(start);
          first = toLocal(path, ...toScreen(box.rect, box.now.right, box.wireY));
        }
        path.setAttribute("d", `M${first[0]},${first[1]}` + curve(first, last));
        endDone = startDone = true;
      }

      // A wire is one curve, like in the editor, unless that curve would cross another node:
      // only then does it keep the layout's route around it.
      if (forward) {
        const parts = segments(path.getAttribute("d"));
        const first = parts[0].end;
        const last = parts[parts.length - 1].end;
        if (last[0] - first[0] > 20) {
          const direct = `M${first[0]},${first[1]}` + curve(first, last);
          if (!crossesNode(path, direct, [ownerBox(start), ownerBox(end)])) {
            path.setAttribute("d", direct);
            endDone = startDone = true;
          }
        }
      }

      // Otherwise extend a wire that ended on the box's old border to the new border.
      let d = path.getAttribute("d");
      if (!endDone && boxes.has(end) && !boxes.get(end).collapsed) {
        const box = boxes.get(end);
        const m = d.match(new RegExp(`${number}[ ,]${number}\\s*$`));
        const [sx, sy] = toScreen(path, Number(m[1]), Number(m[2]));
        const [lx, ly] = toLocal(box.rect, sx, sy);
        const [nx, ny] = toLocal(path, ...toScreen(box.rect, ...moved(box, lx, ly)));
        d += `L${nx},${ny}`;
      }
      if (!startDone && boxes.has(start) && !boxes.get(start).collapsed) {
        const box = boxes.get(start);
        const m = d.match(new RegExp(`^\\s*M\\s*${number}[ ,]${number}`));
        const [sx, sy] = toScreen(path, Number(m[1]), Number(m[2]));
        const [lx, ly] = toLocal(box.rect, sx, sy);
        const [nx, ny] = toLocal(path, ...toScreen(box.rect, ...moved(box, lx, ly)));
        d = d.replace(m[0], `M${nx},${ny}L${m[1]},${m[2]}`);
      }
      path.setAttribute("d", d);
    }

    // Comment boxes were laid out around the node boxes before these shrank. Fit each around
    // its nodes and inner comments again (innermost first), with its title above them. The
    // layout leaves no room for a subgraph's title, so a comment may grow upward for it, as
    // long as it doesn't cover another node box or comment; otherwise boxes only get smaller.
    const COMMENT_PAD = 12; // px between a comment's border and what it frames
    const descendants = (id) => (commentChildren[id] ?? []).flatMap((child) => [child, ...descendants(child)]);
    // A subgraph's drawn box: a cluster's rect, or, for an empty subgraph (a collapsed node such
    // as a pure getter), the node Mermaid draws instead.
    const boxOf = (id) =>
      svg.querySelector(`g.cluster[id="${CSS.escape(id)}"] > rect`) ?? svg.querySelector(`g.node[data-id="${CSS.escape(id)}"]`);
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const fitted = new Set();
    const fitComment = (id) => {
      if (fitted.has(id)) return;
      fitted.add(id);
      const cluster = svg.querySelector(`g.cluster[id="${CSS.escape(id)}"]`);
      const rect = cluster?.querySelector(":scope > rect");
      const label = cluster?.querySelector(":scope > g.cluster-label");
      if (!rect) return;
      const inner = (commentChildren[id] ?? [])
        .map((child) => {
          if (child.startsWith("C_")) fitComment(child);
          const childBox = boxOf(child);
          return childBox && localBox(rect, childBox);
        })
        .filter(Boolean);
      if (!inner.length) return;
      const title = label ? localBox(rect, label) : { left: 0, right: 0, top: 0, bottom: 0 };
      const content = {
        left: Math.min(...inner.map((b) => b.left)),
        right: Math.max(...inner.map((b) => b.right)),
        top: Math.min(...inner.map((b) => b.top)),
        bottom: Math.max(...inner.map((b) => b.bottom)),
      };
      // Never past the box the layout made, which the drawing's size already includes.
      const old = {
        left: rect.x.baseVal.value,
        top: rect.y.baseVal.value,
        right: rect.x.baseVal.value + rect.width.baseVal.value,
        bottom: rect.y.baseVal.value + rect.height.baseVal.value,
      };
      // Is this area free of other node boxes and comments (not counting what this comment frames,
      // or boxes around it)?
      const inside = new Set([id, ...descendants(id)]);
      const isInside = (otherId) => [...inside].some((i) => otherId === i || otherId.startsWith(i + "_"));
      const others = [
        ...[...svg.querySelectorAll("g.cluster")].map((c) => [c.id, c.querySelector(":scope > rect")]),
        ...[...svg.querySelectorAll("g.node[data-id]")].map((n) => [n.dataset.id, n]),
      ];
      const free = (band) =>
        !others.some(([otherId, element]) => {
          if (!element || !/^[NC]_/.test(otherId) || isInside(otherId)) return false;
          const box = localBox(rect, element);
          const encloses = box.left <= old.left && box.right >= old.right && box.top <= old.top && box.bottom >= old.bottom;
          return !encloses && overlaps(box, band);
        });
      const width = Math.max(content.right - content.left + 2 * COMMENT_PAD, title.right - title.left + 2 * COMMENT_PAD);
      const centre = (content.left + content.right) / 2;
      const wantedTop = content.top - COMMENT_PAD - (title.bottom - title.top) - COMMENT_PAD / 2;
      const top =
        wantedTop < old.top && free({ left: old.left, right: old.right, top: wantedTop, bottom: old.top })
          ? wantedTop
          : Math.max(old.top, wantedTop);
      const bottom = Math.min(old.bottom, content.bottom + COMMENT_PAD);
      // Sideways too, for a title wider than the box.
      const wantedLeft = centre - width / 2;
      const wantedRight = centre + width / 2;
      const left =
        wantedLeft < old.left && free({ left: wantedLeft, right: old.left, top, bottom }) ? wantedLeft : Math.max(old.left, wantedLeft);
      const right =
        wantedRight > old.right && free({ left: old.right, right: wantedRight, top, bottom }) ? wantedRight : Math.min(old.right, wantedRight);
      rect.setAttribute("x", left);
      rect.setAttribute("y", top);
      rect.setAttribute("width", right - left);
      rect.setAttribute("height", bottom - top);
      if (label) {
        // A title that still doesn't fit (something is in the way) ends in "…" inside the box.
        const room = right - left - 2 * COMMENT_PAD;
        const shown = Math.min(title.right - title.left, room);
        if (shown < title.right - title.left) {
          const frame = label.querySelector("foreignObject");
          const text = label.querySelector("foreignObject > div");
          if (frame && text) {
            frame.setAttribute("width", room);
            Object.assign(text.style, { display: "block", maxWidth: `${room}px`, overflow: "hidden", textOverflow: "ellipsis" });
          }
        }
        const [, tx, ty] = label.getAttribute("transform").match(/translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/);
        const dx = (left + right) / 2 - (title.left + shown / 2);
        const dy = top + COMMENT_PAD / 2 - title.top;
        label.setAttribute("transform", `translate(${Number(tx) + dx}, ${Number(ty) + dy})`);
      }
    };
    Object.keys(commentChildren).forEach(fitComment);
    // A comment that grew past the edge of the drawing: let the drawing grow with it.
    const view = svg.viewBox.baseVal;
    const edges = [...fitted]
      .map((id) => svg.querySelector(`g.cluster[id="${CSS.escape(id)}"] > rect`))
      .filter(Boolean)
      .map((rect) => {
        const r = rect.getBoundingClientRect();
        const [left, top] = toLocal(svg, r.left, r.top);
        const [right] = toLocal(svg, r.right, r.bottom);
        return { left, right, top };
      });
    for (const { left, right, top } of edges) {
      if (top - 2 < view.y) {
        view.height += view.y - (top - 2);
        view.y = top - 2;
      }
      if (left - 2 < view.x) {
        view.width += view.x - (left - 2);
        view.x = left - 2;
      }
      if (right + 2 > view.x + view.width) {
        view.width = right + 2 - view.x;
      }
    }
    // Mermaid caps the drawing at its natural width; keep that cap in step.
    if (svg.style.maxWidth) svg.style.maxWidth = `${view.width}px`;

    return new XMLSerializer().serializeToString(svg);
  }, pinOrders, commentChildren);
}

// This script and its helpers live in Tools/; the documentation it renders in Doc/.
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(toolsDir, "node_modules", "@mermaid-js", "mermaid-cli", "src", "cli.js");
const puppeteerConfig = path.join(toolsDir, "puppeteer.json");

if (!existsSync(cli)) {
  console.error("Mermaid CLI is missing. Run `npm install` in Tools/ first.");
  process.exit(1);
}

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: toolsDir, encoding: "utf8" }).trim();

// The documentation being worked on: diffs, diagrams and tables in Transient/graph/transient,
// SVGs and doc.html directly in Transient.
const outputRoot = path.join(repoRoot, "Doc", "commits", "Transient");
const graphRoot = path.join(outputRoot, "graph", "transient");

/** Files below a folder (absolute paths), recursively. */
function filesBelow(folder) {
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    return entry.isDirectory() ? filesBelow(full) : [full];
  });
}

/** Paths (relative to the repo) of every diagram in Transient/graph/transient. */
function transientSources() {
  return filesBelow(graphRoot)
    .filter((file) => /\.mmd$/i.test(file))
    .map((file) => path.relative(repoRoot, file).split(path.sep).join("/"))
    .sort();
}

/** Transient/graph/transient/Game/X.mmd -> Game/X.svg */
function packageRelativeSvg(file) {
  return path.relative(graphRoot, path.join(repoRoot, file)).replace(/\.mmd$/i, ".svg");
}

function xml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Loop wires are declared backwards and without an arrowhead in the .mmd (marked with
 * "%% back-edge <from> <to>" comments), so the layout sees no cycle. Give them their
 * arrowhead at the start, which is where the wire really ends.
 */
function arrowheadsOnBackEdges(svg, mmdSource) {
  const pairs = [...mmdSource.matchAll(/^\s*%% back-edge (\S+) (\S+)\s*$/gm)].map((m) => [m[1], m[2]]);
  const svgId = /<svg\b[^>]*\bid="([^"]+)"/.exec(svg)?.[1];
  if (!pairs.length || !svgId) {
    return svg;
  }
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let result = svg;
  for (const [from, to] of pairs) {
    const tag = new RegExp(`<path\\b[^>]*\\bid="L-${escape(from)}-${escape(to)}-\\d+"[^>]*?(\\/?)>`, "g");
    result = result.replace(tag, (match, selfClosing) =>
      match.includes("marker-start=")
        ? match
        : match.slice(0, match.length - (selfClosing ? 2 : 1)) + ` marker-start="url(#${svgId}_flowchart-pointStart)"` + (selfClosing ? "/>" : ">"),
    );
  }
  return result;
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

/** Insert the asset metadata (assetMetadata in doc_sources.mjs) right after the opening <svg> tag. */
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

// With file arguments (node Tools/export_svg.mjs a.mmd b.mmd), render exactly those files and
// write each SVG next to its source. Without arguments, render everything in Transient.
// Up-to-date SVGs (newer than their source, diff, this script, doc_sources.mjs and
// palette.json) are skipped; --force renders everything again.
const force = process.argv.includes("--force");
const explicitFiles = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"))
  .map((file) => path.relative(repoRoot, path.resolve(process.cwd(), file)).split(path.sep).join("/"));
const sources = explicitFiles.length ? explicitFiles : transientSources();
if (sources.length === 0) {
  console.log(`No .mmd files in ${path.relative(process.cwd(), graphRoot)}.`);
}
if (!explicitFiles.length) {
  // Remove SVGs whose diagram is gone, so nothing outdated stays in the doc. This also removes
  // table SVGs from before tables became HTML.
  const expected = new Set(sources.map((file) => path.join(outputRoot, packageRelativeSvg(file)).toLowerCase()));
  for (const file of filesBelow(outputRoot)) {
    const isSvg = file.toLowerCase().endsWith(".svg") && !file.startsWith(path.join(outputRoot, "graph") + path.sep);
    if (isSvg && !expected.has(file.toLowerCase())) {
      rmSync(file);
      console.log(`Removed ${path.relative(repoRoot, file)} (its source is gone)`);
    }
  }
}

const written = new Map();
let failures = 0;
let browser = null;

const modified = (file) => (existsSync(file) ? statSync(file).mtimeMs : 0);
// An SVG depends on its source, the diff its metadata comes from, the scripts and the palette.
const toolsModified = Math.max(
  modified(fileURLToPath(import.meta.url)),
  modified(path.join(toolsDir, "doc_sources.mjs")),
  modified(path.join(toolsDir, "palette.json")),
);
let upToDate = 0;

/** The SVG to write for a source, or null if it's up to date (or another source claims it). */
function claimOutput(file) {
  if (explicitFiles.length) {
    return path.join(repoRoot, file).replace(/\.mmd$/i, ".svg");
  }
  const relative = packageRelativeSvg(file);
  if (written.has(relative)) {
    console.warn(`Skipped ${file}: ${written.get(relative)} already renders to ${relative}`);
    return null;
  }
  written.set(relative, file);
  const output = path.join(outputRoot, relative);
  const source = path.join(repoRoot, file);
  const inputs = Math.max(modified(source), modified(diffFileOf(source)), toolsModified);
  if (!force && modified(output) >= inputs) {
    upToDate++;
    return null;
  }
  mkdirSync(path.dirname(output), { recursive: true });
  return output;
}

for (const file of sources.filter((f) => f.toLowerCase().endsWith(".md"))) {
  console.log(`${file}: tables aren't rendered to SVG any more (export_doc.mjs writes them as HTML), skipped`);
}

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
    const metadata = assetMetadata(path.join(repoRoot, file), repoRoot);
    browser ??= await puppeteer.launch(JSON.parse(readFileSync(puppeteerConfig, "utf8")));
    const page = await browser.newPage();
    const mmdSource = readFileSync(path.join(repoRoot, file), "utf8");
    const tightened = await tightenNodeBoxes(page, output, mmdSource);
    await page.close();
    const rendered = arrowheadsOnBackEdges(tightened, mmdSource);
    const svg = withPalette(useColourVariables(colourArrowheads(rendered)));
    writeFileSync(output, prettySvg(withMetadata(svg, metadata)), "utf8");
    console.log(`${file} -> ${path.relative(repoRoot, output)}`);
  } else {
    failures++;
    console.error(`Failed to render ${file}:\n${result.stderr || result.stdout}`);
  }
}
await browser?.close();
if (upToDate) {
  console.log(`${upToDate} SVG(s) up to date, not rendered again.`);
}

process.exit(failures ? 1 : 0);
