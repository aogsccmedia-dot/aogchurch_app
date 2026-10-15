// Reports on small screens: every number stays, nothing scrolls sideways.
// - Tables with several text columns turn into labelled cards on phones; number tables just tighten up.
// - Bar charts squeeze to fit, or become labelled rows when there are too many bars for a phone.
// - Any report document can be downloaded as a spreadsheet (CSV that opens in Excel / Google Sheets).

const txt = (el) => (el?.innerText ?? el?.textContent ?? "").replace(/\s+/g, " ").trim();

export function fitTable(t) {
  if (t.dataset.fit) return;
  t.dataset.fit = "1";
  const heads = [...t.querySelectorAll("thead th")].map(txt);
  if (!heads.length) return;
  let textCols = 0;
  heads.forEach((_, i) => {
    const cells = [...t.querySelectorAll(`tbody tr > :nth-child(${i + 1})`)];
    if (cells.some((c) => !c.classList.contains("n") && /[A-Za-z]{3,}/.test(txt(c)) && !c.querySelector("button"))) textCols++;
  });
  for (const tr of t.querySelectorAll("tbody tr, tfoot tr")) {
    let col = 0;
    for (const c of tr.children) {
      if (heads[col] && !c.hasAttribute("data-label")) c.setAttribute("data-label", heads[col]);
      if (!txt(c) && !c.querySelector("button, a, input")) c.classList.add("rt-empty");
      col += Number(c.getAttribute("colspan")) || 1;
    }
  }
  if (heads.length > 4 && textCols > 1) t.classList.add("rt-stack");
  else if (heads.length > 6) t.classList.add("rt-stack", "rt-nums");
}

export function fitBars(b) {
  if (b.dataset.fit) return;
  b.dataset.fit = "1";
  const bars = [...b.children];
  for (const r of bars) { const i = r.querySelector("i"); if (i && i.style.height) i.style.setProperty("--p", i.style.height); }
  if (bars.length > 8) b.classList.add("rb-many");
}

export function fitReports(root = document) {
  root.querySelectorAll("table.rep-table").forEach(fitTable);
  root.querySelectorAll(".rep-bars").forEach(fitBars);
}

/** Watches the admin area and fits reports as they are drawn. */
export function watchReports(root) {
  if (!root) return;
  let queued = false;
  const run = () => { queued = false; fitReports(root); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(root, { childList: true, subtree: true });
  run();
}

const cell = (v) => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Turns a report document (headings, figure boxes, tables, chart) into CSV rows, in reading order. */
export function docToCsv(doc) {
  const rows = [];
  const push = (...r) => rows.push(r.map(cell).join(","));
  const walk = (el) => {
    for (const n of el.children) {
      if (n.matches(".no-print, .ledger-add, button, script, style")) continue;
      if (n.matches("h1, h2, h3")) { if (rows.length) push(""); push(txt(n)); continue; }
      if (n.matches(".rep-head")) { const h = n.querySelector("h1"); push(txt(h)); n.querySelectorAll("p, span").forEach((s) => { if (txt(s) && !s.closest("h1")) push(txt(s)); }); continue; }
      if (n.matches(".rep-kpis, .kpis")) { for (const k of n.children) { const b = k.querySelector("b"), l = [...k.children].find((x) => x !== b); push(txt(l) || txt(k).replace(txt(b), "").trim(), txt(b)); } continue; }
      if (n.matches("table")) {
        const heads = [...n.querySelectorAll("thead th")].map(txt);
        const keep = heads.map((_, i) => [...n.querySelectorAll(`tbody tr > :nth-child(${i + 1})`)].some((c) => !c.querySelector("button") || txt(c) !== txt(c.querySelector("button"))));
        if (heads.length) push(...heads.filter((_, i) => keep[i] !== false));
        for (const tr of n.querySelectorAll("tbody tr, tfoot tr")) {
          const out = []; let col = 0;
          for (const c of tr.children) { const span = Number(c.getAttribute("colspan")) || 1; if (keep[col] !== false) out.push(txt(c)); for (let s = 1; s < span; s++) out.push(""); col += span; }
          push(...out);
        }
        continue;
      }
      if (n.matches(".rep-bars")) { push("Date", "Attendance"); for (const r of n.children) push(txt(r.querySelector(".rb-l")), txt(r.querySelector(".rb-v"))); continue; }
      if (n.matches("p, li") && !n.children.length) { if (txt(n)) push(txt(n)); continue; }
      if (n.matches("p")) { if (txt(n)) push(txt(n)); continue; }
      walk(n);
    }
  };
  walk(doc);
  return rows.join("\r\n");
}

export function downloadCsv(doc, name) {
  const csv = "﻿" + docToCsv(doc);   // BOM so Excel reads R and accents correctly
  const slug = (name || txt(doc.querySelector("h1")) || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${slug || "report"}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
