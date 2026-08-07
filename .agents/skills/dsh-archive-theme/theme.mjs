/**
 * dsh-archive-theme — reusable single-file HTML theme for DSH archive pages.
 *
 * Design lineage: test-LoserFox-agent-notes-20260806.html (light/dark CSS
 * variables, stat tiles, per-day stacked timeline, lifecycle/class chips,
 * searchable bilingual table, TODO card, localStorage theme toggle).
 *
 * Usage: import { css, js } from this module and inline both into a single-file
 * HTML. The page must declare `globalThis.__DASH_NOTES__` (array of
 * {d, l, c, te, tz}) and may declare `globalThis.__DASH_CONF__` to override
 * labels/order. The script auto-renders on load; no external assets.
 */

export const css = `
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --page: #f9f9f7;
    --ink-1: #0b0b0b;
    --ink-2: #52514e;
    --ink-3: #898781;
    --hairline: #e1e0d9;
    --axis: #c3c2b7;
    --border: rgba(11,11,11,0.10);
    --series-1: #2a78d6;  /* architecture */
    --series-2: #eb6834;  /* feature */
    --series-3: #1baf7a;  /* bug-fix */
    --series-4: #eda100;  /* process */
    --series-5: #e87ba4;  /* simplification */
    --series-6: #008300;  /* testing */
    --status-good: #0ca30c;
    --status-warning: #fab219;
    --status-critical: #d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --page: #0d0d0d;
      --ink-1: #ffffff;
      --ink-2: #c3c2b7;
      --ink-3: #898781;
      --hairline: #2c2c2a;
      --axis: #383835;
      --border: rgba(255,255,255,0.10);
      --series-1: #3987e5;
      --series-2: #d95926;
      --series-3: #199e70;
      --series-4: #c98500;
      --series-5: #d55181;
      --series-6: #008300;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --page: #0d0d0d;
    --ink-1: #ffffff;
    --ink-2: #c3c2b7;
    --ink-3: #898781;
    --hairline: #2c2c2a;
    --axis: #383835;
    --border: rgba(255,255,255,0.10);
    --series-1: #3987e5;
    --series-2: #d95926;
    --series-3: #199e70;
    --series-4: #c98500;
    --series-5: #d55181;
    --series-6: #008300;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    background: var(--page);
    color: var(--ink-1);
    line-height: 1.5;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 20px 80px; }

  .toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .toolbar h1 { font-size: 22px; margin: 0; font-weight: 700; letter-spacing: -0.01em; }
  .toolbar .sub { color: var(--ink-3); font-size: 13px; }
  .spacer { flex: 1; }
  .theme-toggle {
    font: inherit; font-size: 13px; color: var(--ink-2);
    background: var(--surface-1); border: 1px solid var(--axis);
    border-radius: 8px; padding: 6px 12px; cursor: pointer;
  }
  .theme-toggle:hover { border-color: var(--ink-3); }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 24px 0 8px; }
  .tile {
    background: var(--surface-1); border: 1px solid var(--border);
    border-radius: 12px; padding: 14px 16px;
  }
  .tile .num { font-size: 30px; font-weight: 700; line-height: 1.1; }
  .tile .lbl { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
  .tile .num.implemented { color: var(--series-3); }
  .tile .num.proposed   { color: var(--series-4); }
  .tile .num.rejected   { color: var(--status-critical); }
  .tile .num.archived   { color: var(--ink-3); }
  .tile.total .num { color: var(--series-1); }

  .card {
    background: var(--surface-1); border: 1px solid var(--border);
    border-radius: 12px; padding: 18px 20px; margin-top: 14px;
  }
  .card h2 { font-size: 15px; margin: 0 0 14px; font-weight: 650; }
  .bar-row { display: grid; grid-template-columns: 62px 1fr 34px; align-items: center; gap: 10px; margin-bottom: 7px; }
  .bar-row .mk { font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; text-align: right; }
  .bar-row .bar { height: 14px; border-radius: 4px; display: flex; overflow: hidden; background: var(--hairline); }
  .bar-row .bar span { height: 100%; }
  .bar-row .bar .implemented { background: var(--series-3); }
  .bar-row .bar .proposed   { background: var(--series-4); }
  .bar-row .bar .rejected   { background: var(--status-critical); }
  .bar-row .bar .archived   { background: var(--ink-3); opacity: .55; }
  .bar-row .cnt { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 10px; font-size: 12px; color: var(--ink-2); }
  .legend .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }

  .filters { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  .filters input[type="search"] {
    flex: 1; min-width: 220px; font: inherit; font-size: 14px;
    padding: 8px 12px; border: 1px solid var(--axis); border-radius: 8px;
    background: var(--surface-1); color: var(--ink-1);
  }
  .filters input[type="search"]:focus { outline: 2px solid var(--series-1); outline-offset: 1px; border-color: transparent; }
  .chip-group { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip {
    font: inherit; font-size: 12.5px; color: var(--ink-2);
    background: var(--surface-1); border: 1px solid var(--axis);
    border-radius: 999px; padding: 5px 12px; cursor: pointer; user-select: none;
  }
  .chip:hover { border-color: var(--ink-3); }
  .chip.active { border-color: transparent; color: #fff; }
  .chip.lc-implemented.active { background: var(--series-3); }
  .chip.lc-proposed.active    { background: var(--series-4); color: #3a2c00; }
  .chip.lc-rejected.active    { background: var(--status-critical); }
  .chip.lc-archived.active    { background: var(--ink-3); }
  .chip.cls-architecture.active { background: var(--series-1); }
  .chip.cls-feature.active       { background: var(--series-2); }
  .chip.cls-bug-fix.active       { background: var(--series-3); }
  .chip.cls-process.active       { background: var(--series-4); color: #3a2c00; }
  .chip.cls-simplification.active { background: var(--series-5); }
  .chip.cls-testing.active       { background: var(--series-6); }

  .table-wrap { margin-top: 14px; overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-1); }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  thead th {
    position: sticky; top: 0; background: var(--surface-1); z-index: 1;
    text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--ink-3); padding: 10px 14px; border-bottom: 1px solid var(--hairline);
    font-weight: 600; white-space: nowrap;
  }
  tbody td { padding: 8px 14px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: rgba(128,128,128,0.06); }
  td.date { white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--ink-2); }
  .t-zh { font-weight: 550; }
  .t-en { color: var(--ink-3); font-size: 12px; margin-top: 1px; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 6px; }
  .dot.implemented { background: var(--series-3); }
  .dot.proposed    { background: var(--series-4); }
  .dot.rejected    { background: var(--status-critical); }
  .dot.archived    { background: var(--ink-3); }
  td.lifecycle { white-space: nowrap; color: var(--ink-2); }
  td.cls { white-space: nowrap; }
  .cls-tag { font-size: 11.5px; padding: 2px 9px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
  .cls-tag.architecture { color: var(--series-1); }
  .cls-tag.feature      { color: var(--series-2); }
  .cls-tag.bug-fix      { color: var(--series-3); }
  .cls-tag.process      { color: var(--series-4); }
  .cls-tag.simplification { color: var(--series-5); }
  .cls-tag.testing      { color: var(--series-6); }
  .empty-row td { text-align: center; color: var(--ink-3); padding: 28px; }

  .todo { border-left: 3px solid var(--series-4); }
  .todo ol { margin: 0; padding-left: 22px; font-size: 13.5px; }
  .todo li { margin-bottom: 7px; }
  .todo .d { color: var(--ink-3); font-variant-numeric: tabular-nums; font-size: 12.5px; margin-right: 8px; }
  .todo .t-zh { display: block; }
  .todo .t-en { display: block; }
  .todo .ct { font-size: 11.5px; margin-left: 8px; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
  .todo .ct.architecture { color: var(--series-1); }
  .todo .ct.feature      { color: var(--series-2); }
  .todo .ct.process      { color: var(--series-4); }
  .todo .ct.simplification { color: var(--series-5); }
  .todo .ct.testing      { color: var(--series-6); }

  .foot { margin-top: 28px; color: var(--ink-3); font-size: 12px; }
  .result-count { font-size: 12.5px; color: var(--ink-3); margin-top: 10px; }
  @media (max-width: 640px) {
    .wrap { padding: 20px 14px 60px; }
    .toolbar h1 { font-size: 18px; }
  }
`

export const js = `
"use strict";
(() => {
  const NOTES = globalThis.__DASH_NOTES__ ?? [];
  const CONF = globalThis.__DASH_CONF__ ?? {};
  const LC_LABEL = Object.assign(
    { implemented: "已实现", proposed: "计划中", rejected: "已否决", archived: "已封存" },
    CONF.lcLabels ?? {});
  const CLS_LABEL = Object.assign(
    { architecture: "架构", feature: "功能", "bug-fix": "缺陷修复", process: "流程", simplification: "简化", testing: "测试" },
    CONF.clsLabels ?? {});
  const CLS_ORDER = CONF.clsOrder ?? ["architecture", "feature", "bug-fix", "process", "simplification", "testing"];
  const LC_ORDER = CONF.lcOrder ?? ["implemented", "proposed", "rejected", "archived"];
  const $ = (id) => document.getElementById(id);

  // ── Stat tiles ──────────────────────────────
  const counts = {};
  NOTES.forEach(n => counts[n.l] = (counts[n.l] || 0) + 1);
  const tileDefs = [
    { key: "total", cls: "total", num: NOTES.length, lbl: "总计" },
    ...LC_ORDER.map(l => ({ key: l, cls: l, num: counts[l] || 0, lbl: LC_LABEL[l] })),
  ];
  const tiles = $("tiles");
  if (tiles) tileDefs.forEach(t => {
    const el = document.createElement("div");
    el.className = "tile";
    el.innerHTML = \`<div class="num \${t.cls}">\${t.num}</div><div class="lbl">\${t.lbl}</div>\`;
    tiles.appendChild(el);
  });

  // ── Timeline by day ─────────────────────────
  const byDate = {};
  NOTES.forEach(n => { (byDate[n.d] = byDate[n.d] || []).push(n); });
  const dates = Object.keys(byDate).sort();
  const maxDay = Math.max(1, ...dates.map(d => byDate[d].length));
  const tl = $("timeline");
  if (tl) dates.forEach(d => {
    const row = document.createElement("div");
    row.className = "bar-row";
    const segs = LC_ORDER.map(lc => {
      const c = byDate[d].filter(n => n.l === lc).length;
      return c ? \`<span class="\${lc}" style="width:\${(c / maxDay * 100).toFixed(1)}%"></span>\` : "";
    }).join("");
    row.innerHTML = \`<div class="mk">\${d.slice(5)}</div><div class="bar">\${segs}</div><div class="cnt">\${byDate[d].length}</div>\`;
    row.title = \`\${d} · \${byDate[d].length} 篇\`;
    tl.appendChild(row);
  });

  // ── Filters ─────────────────────────────────
  let lcActive = new Set();
  let clsActive = new Set();
  let query = "";
  function makeChips(container, keys, activeSet, prefix) {
    keys.forEach(k => {
      const chip = document.createElement("button");
      chip.className = \`chip \${prefix}\${k}\`;
      chip.type = "button";
      chip.textContent = LC_LABEL[k] || CLS_LABEL[k];
      chip.addEventListener("click", () => {
        if (activeSet.has(k)) activeSet.delete(k); else activeSet.add(k);
        chip.classList.toggle("active", activeSet.has(k));
        render();
      });
      container.appendChild(chip);
    });
  }
  makeChips($("lcFilters"), LC_ORDER, lcActive, "lc-");
  makeChips($("clsFilters"), CLS_ORDER, clsActive, "cls-");
  const qEl = $("q");
  if (qEl) qEl.addEventListener("input", e => { query = e.target.value.toLowerCase(); render(); });

  // ── Render table ────────────────────────────
  const tbody = $("rows");
  function render() {
    const rows = NOTES.filter(n => {
      if (lcActive.size && !lcActive.has(n.l)) return false;
      if (clsActive.size && !clsActive.has(n.c)) return false;
      if (query) {
        const hay = (n.tz + " " + n.te + " " + n.d + " " + n.c).toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
    tbody.innerHTML = "";
    if (!rows.length) {
      tbody.innerHTML = \`<tr class="empty-row"><td colspan="4">没有匹配的记录</td></tr>\`;
    } else {
      rows.forEach(n => {
        const tr = document.createElement("tr");
        tr.innerHTML = \`<td class="date">\${n.d}</td>
          <td class="lifecycle"><span class="dot \${n.l}"></span>\${LC_LABEL[n.l]}</td>
          <td class="cls"><span class="cls-tag \${n.c}">\${CLS_LABEL[n.c]}</span></td>
          <td><div class="t-zh">\${n.tz}</div><div class="t-en">\${n.te}</div></td>\`;
        tbody.appendChild(tr);
      });
    }
    const rc = $("resultCount");
    if (rc) rc.textContent = \`显示 \${rows.length} / \${NOTES.length} 篇\`;
  }

  // ── TODO list (proposed) ────────────────────
  const todo = NOTES.filter(n => n.l === "proposed").sort((a, b) => a.d.localeCompare(b.d));
  const tc = $("todoCount");
  if (tc) tc.textContent = todo.length;
  const tl2 = $("todoList");
  if (tl2) tl2.innerHTML = todo.map((n, i) =>
    \`<li>
       <span class="d">\${n.d}</span><span class="ct \${n.c}">\${CLS_LABEL[n.c]}</span>
       <span class="t-zh">\${i + 1}. \${n.tz}</span>
       <span class="t-en">\${n.te}</span>
     </li>\`
  ).join("");

  // ── Theme toggle ────────────────────────────
  const btn = $("themeBtn");
  const root = document.documentElement;
  const saved = localStorage.getItem("dsh-theme");
  if (saved) root.setAttribute("data-theme", saved);
  if (btn) btn.addEventListener("click", () => {
    const cur = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("dsh-theme", next);
  });

  if (tbody) render();
})();
`
