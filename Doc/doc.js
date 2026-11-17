// Shared script of the documentation pages. Edited here, in Doc/doc.js, the website root (not generated,
// no copy in Tools/); every Doc/commits/<step>/doc.html loads it as ../../doc.js, on disk and online.
//
// 1. Colour palette switch: applies the palette picked in the page's <select id="palette">
//    (palette CSS and options are written into each page from Tools/palette.json), remembers it
//    per browser (localStorage "doc-palette") and accepts ?palette=<name> in the address.
// 2. Step navigation: "‹ Step 2 · Step 3 of 4 · Step 4 ›" in the page's <header>, with
//    left/right arrow keys. The order of the steps comes from steps.js next to this script
//    (Doc/steps.js), a script that calls docSteps([...]) with the step folders. It is loaded
//    with a <script> element, not fetched, because browsers don't let a page opened from disk
//    fetch files; so the bar works on disk and on the website alike.

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

// 3. Editor views: a graph as the Blueprint editor shows it, drawn by blueprintUE's renderer
//    (Doc/bue-render) from the Blueprint text embedded in the page, in a hidden textarea next
//    to each <div class="bue-graph">. With a previous version too, its side-by-side diff.
(function editorViews() {
  const bue = window.blueprintUE;
  if (!bue?.render) {
    return; // a page without editor views doesn't load the renderer
  }
  for (const view of document.querySelectorAll(".editor-view")) {
    const target = view.querySelector(".bue-graph");
    const current = view.querySelector(".bue-current")?.value;
    const previous = view.querySelector(".bue-previous")?.value;
    if (!target || !current) {
      continue;
    }
    // The renderer pans with the right mouse button only (and draws a selection rectangle on a left
    // drag). Here the left button pans: its press on the canvas is handed to the renderer as a
    // right-button press, and it then follows the mouse as it moves. Presses on a node's fold arrows
    // (and everything outside the canvas: toolbar, buttons, change list) are left alone.
    target.addEventListener("mousedown", (event) => {
      const hit = event.target;
      if (event.button !== 0 || !event.isTrusted || !hit.closest?.(".layer") || hit.closest(".less, .more")) {
        return;
      }
      event.stopImmediatePropagation();
      event.preventDefault();
      hit.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true, cancelable: true, composed: true, view: window, button: 2, buttons: 2,
        clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY,
        ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
      }));
    }, true);
    try {
      // A share of the window's height, not pixels, so a view is as big on a small screen as on a large one.
      const options = { height: "70vh" };
      const comparing = Boolean(previous && bue.diff);
      (comparing ? new bue.diff.Main(previous, current, target, options) : new bue.render.Main(current, target, options)).start(() => {
        if (comparing) {
          // The watermark in each pane says which version it is (the renderer only knows one text for both).
          const marks = target.querySelectorAll(".blueprint-type");
          if (marks.length === 2) {
            marks[0].textContent = "Before";
            marks[1].textContent = "After";
          }
        }
      });
    } catch (error) {
      target.textContent = `The editor view could not be drawn: ${error}`;
    }
  }
})();

// Called by steps.js with the step folders in order.
window.docSteps = function stepNavigation(steps) {
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
};

// Load the step list. Without it (an old copy of the site) the page simply has no step bar.
{
  const stepList = document.createElement("script");
  stepList.src = new URL("steps.js", docScriptUrl).href;
  document.head.appendChild(stepList);
}
