// How distinguishable are the key colours of each palette under colour blindness?
//
//   node Doc/check_palette.mjs [palette.json] [palette name]
//
// For each palette and each vision type, prints the three closest pairs of key colours
// (pins with pins, event border with setter border) and any key colour with less than 3:1
// contrast on the node body. Rough guide: 25+ is clearly distinct, under 15 is easy to confuse.
// Simulation: Machado et al. 2009, severity 1.0, in linear RGB. Distance: CIE76 delta E in Lab.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const paletteFile = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "palette.json");
const palettes = JSON.parse(readFileSync(paletteFile, "utf8")).palettes;
const KEY = ["pin-exec", "pin-float", "pin-object", "pin-boolean", "pin-integer", "pin-vector", "pin-string", "border-event", "border-setter"];
const MATRICES = {
  none: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
  achromatopsia: "grey",
};

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
const simulate = (lin, m) => {
  if (m === "grey") {
    const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    return [y, y, y];
  }
  return m.map((row) => Math.min(1, Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
};
const lab = ([r, g, b]) => {
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const luminance = (lin) => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];

const only = process.argv[3];
for (const [name, palette] of Object.entries(palettes)) {
  if (only && name !== only) continue;
  const colours = { ...palettes.default.colors, ...palette.colors };
  const body = luminance(rgb(colours["node-body"]));
  const lowContrast = KEY.filter((k) => (luminance(rgb(colours[k])) + 0.05) / (body + 0.05) < 3);
  console.log(`\n${name}${lowContrast.length ? "  (contrast < 3:1 on body: " + lowContrast.join(", ") + ")" : ""}`);
  for (const [vision, matrix] of Object.entries(MATRICES)) {
    const pairs = [];
    for (let i = 0; i < KEY.length; i++) {
      for (let j = i + 1; j < KEY.length; j++) {
        // Compare pins with pins, and the event border with the setter border.
        if (KEY[i].startsWith("pin-") !== KEY[j].startsWith("pin-")) continue;
        const a = lab(simulate(rgb(colours[KEY[i]]), matrix));
        const b = lab(simulate(rgb(colours[KEY[j]]), matrix));
        pairs.push([Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), KEY[i], KEY[j]]);
      }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const worst = pairs.slice(0, 3).map(([d, a, b]) => `${a.replace(/^(pin|border)-/, "")}~${b.replace(/^(pin|border)-/, "")} ${d.toFixed(0)}`);
    console.log(`  ${vision.padEnd(14)} closest: ${worst.join(" | ")}`);
  }
}
