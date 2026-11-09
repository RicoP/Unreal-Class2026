// Step navigation for the documentation website: "‹ Step 2 | Step 3 of 4 | Step 4 ›".
// Each doc page (<step folder>/doc.html) loads ../nav.js, which Doc/build_pages.mjs copies to
// the site root unchanged. The list of step folders is steps.json next to it, written by the same
// build. The whole bar is created here and inserted into the page's <header>, so doc pages
// need nothing but the <script> tag. Left and right arrow keys go to the previous and next step.
(async function () {
  let steps;
  try {
    // steps.json sits next to this script, at the site root.
    const script = document.currentScript?.src ?? new URL("../nav.js", location.href).href;
    const response = await fetch(new URL("steps.json", script));
    steps = await response.json();
  } catch {
    return; // no step list (e.g. a page opened from disk)
  }
  const parts = location.pathname.split("/").filter(Boolean);
  const index = steps.indexOf(decodeURIComponent(parts[parts.length - 2] || ""));
  if (index < 0) {
    return; // not a step page of this site (e.g. a local export)
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
  here.href = "../index.html";
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
