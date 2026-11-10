// Shared script of the documentation pages. Tools/export_doc.mjs copies it to Doc/doc.js, the
// website root; every Doc/commits/<step>/doc.html loads it as ../../doc.js, on disk and online.
//
// 1. Colour palette switch: applies the palette picked in the page's <select id="palette">
//    (palette CSS and options are written into each page from Tools/palette.json), remembers it
//    per browser (localStorage "doc-palette") and accepts ?palette=<name> in the address.
// 2. Step navigation: "‹ Step 2 · Step 3 of 4 · Step 4 ›" in the page's <header>, with
//    left/right arrow keys. The order of the steps comes from steps.json next to this script
//    (Doc/steps.json). Browsers don't let pages opened from disk load it, so there the page
//    shows no bar; on the website it does.

// Where this script was loaded from; only known while it first runs.
const docScriptUrl = document.currentScript?.src ?? new URL("../../doc.js", location.href).href;

(function palette() {
  const select = document.getElementById("palette");
  if (!select) {
    return;
  }
  const apply = (name) => {
    document.body.dataset.palette = name;
    select.value = name;
    try { localStorage.setItem("doc-palette", name); } catch { /* storage unavailable */ }
  };
  let saved = null;
  try { saved = localStorage.getItem("doc-palette"); } catch { /* storage unavailable */ }
  const requested = new URLSearchParams(location.search).get("palette") || saved;
  const known = [...select.options].map((option) => option.value);
  apply(known.includes(requested) ? requested : "default");
  select.addEventListener("change", () => apply(select.value));
})();

(async function stepNavigation() {
  let steps;
  try {
    const response = await fetch(new URL("steps.json", docScriptUrl));
    steps = await response.json();
  } catch {
    return; // no step list: a page opened from disk
  }
  const parts = location.pathname.split("/").filter(Boolean);
  const index = steps.indexOf(decodeURIComponent(parts[parts.length - 2] || ""));
  if (index < 0) {
    return; // not one of the website's steps
  }

  const style = document.createElement("style");
  style.textContent = `
    .step-nav { display: flex; align-items: center; gap: 16px; margin-right: auto; font-size: 15px; }
    .step-nav a { color: #7cc4ff; text-decoration: none; }
    .step-nav a:hover { text-decoration: underline; }
    .step-nav .step-off { color: #666666; }
    .step-nav .step-here { color: #ffffff; }
  `;
  document.head.appendChild(style);

  const link = (target, text) => {
    if (target < 0 || target >= steps.length) {
      const span = document.createElement("span");
      span.className = "step-off";
      span.textContent = text;
      return span;
    }
    const a = document.createElement("a");
    a.href = `../${steps[target]}/doc.html`;
    a.textContent = text;
    return a;
  };

  const nav = document.createElement("nav");
  nav.className = "step-nav";
  nav.setAttribute("aria-label", "Steps");
  const here = document.createElement("a");
  here.href = "../../index.html";
  here.className = "step-here";
  here.textContent = `Step ${index + 1} of ${steps.length}`;
  here.title = "All steps";
  nav.append(link(index - 1, `‹ Step ${index}`), here, link(index + 1, `Step ${index + 2} ›`));

  let header = document.querySelector("body > header");
  if (!header) {
    header = document.createElement("header");
    document.body.prepend(header);
  }
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.prepend(nav);

  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) {
      return;
    }
    const target = event.key === "ArrowLeft" ? index - 1 : event.key === "ArrowRight" ? index + 1 : -1;
    if (target >= 0 && target < steps.length) {
      location.href = `../${steps[target]}/doc.html`;
    }
  });
})();
