import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotsDir = path.join(root, "snapshots");
const siteDir = path.join(root, "site");
const contentDir = path.join(root, "content");
const legacyPattern = /^DSH内测群每日档案-(\d{4})\.html$/;
const snapshotScriptPattern = /<script>globalThis\.__DSH_SNAPSHOT__=([\s\S]*?);<\/script>\s*/;

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`无法迁移站点外壳：没有找到 ${label}`);
  return source.replace(before, after);
}

const legacyNames = (await readdir(root)).filter((name) => legacyPattern.test(name)).sort();
if (!legacyNames.length) throw new Error("没有找到旧版按日 HTML");

await mkdir(snapshotsDir, { recursive: true });
await mkdir(siteDir, { recursive: true });
await mkdir(contentDir, { recursive: true });

const snapshots = [];
for (const name of legacyNames) {
  const html = await readFile(path.join(root, name), "utf8");
  const match = html.match(snapshotScriptPattern);
  if (!match) throw new Error(`${name} 缺少内嵌快照`);
  const snapshot = JSON.parse(match[1]);
  const date = String(snapshot.group?.stats?.date_end || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${name} 缺少有效截止日期`);
  snapshot.snapshotDate = snapshot.snapshotDate || date;
  snapshots.push({ date, snapshot, html });
  await writeFile(path.join(snapshotsDir, `${date}.json`), `${JSON.stringify(snapshot)}\n`, "utf8");
}

snapshots.sort((a, b) => a.date.localeCompare(b.date));
const latest = snapshots.at(-1);
let shell = latest.html.replace(snapshotScriptPattern, "");

const extraStyles = `
.date-switch{display:flex;align-items:center;gap:7px;margin-right:8px;color:var(--faint);font-size:10px;letter-spacing:.1em;white-space:nowrap}
.nav{max-width:1400px}
.nav .tabs button{white-space:nowrap;flex:0 0 auto}
.date-switch select{max-width:150px;font:inherit;font-size:11px;color:var(--ink);background:#071008;border:1px solid var(--dim);padding:5px 26px 5px 9px;outline:none;cursor:pointer;color-scheme:dark}
.date-switch select:hover,.date-switch select:focus{border-color:var(--gr)}
.nav .tabs button.guide-tab{color:var(--amber);border-color:rgba(255,179,71,.28);position:relative}
.nav .tabs button.guide-tab::before{content:"🔥";display:inline-block;margin-right:5px;filter:drop-shadow(0 0 5px rgba(255,179,71,.7));animation:guidePulse 1.8s ease-in-out infinite}
.nav .tabs button.guide-tab.on{background:var(--amber);border-color:var(--amber);color:#160b00}
@keyframes guidePulse{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-1px) scale(1.12)}}
.guide-empty{min-height:420px;display:grid;place-items:center;text-align:center;border:1px solid var(--dim);background:radial-gradient(circle at 50% 35%,rgba(255,179,71,.09),transparent 34%),var(--panel);padding:48px 24px}
.guide-empty .icon{font-size:54px;line-height:1;filter:drop-shadow(0 0 16px rgba(255,179,71,.55));animation:guidePulse 1.8s ease-in-out infinite}
.guide-empty h3{color:var(--ink);font-size:20px;margin-top:18px;letter-spacing:.06em}
.guide-empty p{max-width:540px;color:var(--mut);font-size:12px;margin-top:10px;line-height:1.8}
.guide-empty .status{display:inline-block;margin-top:18px;border:1px solid rgba(255,179,71,.4);color:var(--amber);font-size:10px;padding:4px 10px;letter-spacing:.14em}
.guide-content{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.guide-section{border:1px solid var(--dim);background:var(--panel);padding:18px}
.guide-section h3{color:var(--ink);font-size:15px;letter-spacing:.05em}
.guide-section p{color:var(--mut);font-size:12px;line-height:1.8;margin-top:8px}
.guide-section ul{margin:12px 0 0 18px;color:var(--mut);font-size:11.5px;line-height:1.8}
@media(max-width:860px){.nav{height:auto;min-height:50px;flex-wrap:wrap;padding-top:8px;padding-bottom:8px}.nav .tabs{order:3;flex-basis:100%}.date-switch{margin-left:auto}.nav .meta{display:none}}
@media(max-width:520px){.date-switch .label{display:none}.date-switch select{max-width:125px}#refreshBtn{padding:4px 8px;margin-right:0}.guide-empty{min-height:340px}}
`;
shell = replaceOnce(shell, "</style>", `${extraStyles}</style>`, "样式结束标签");

const oldNav = `    <div class="tabs" id="tabs"></div>
    <button id="refreshBtn" style="font:inherit;font-size:12px;color:var(--gr);background:none;border:1px solid var(--dim);padding:4px 12px;cursor:pointer;letter-spacing:.1em;margin-right:10px" title="重新载入当前文件内嵌的数据">↻ 重新载入本文件</button><div class="meta">本地快照 · 08-05 11:25 · EOF</div>`;
const newNav = `    <div class="tabs" id="tabs"></div>
    <label class="date-switch" for="datePicker"><span class="label">日期</span><select id="datePicker" aria-label="切换档案日期"></select></label>
    <button id="refreshBtn" title="检查当前日期的最新数据">↻ 检查更新</button><div class="meta" id="snapshotMeta">读取快照…</div>`;
shell = replaceOnce(shell, oldNav, newNav, "顶部导航");

const guidePanel = `<section class="panel" id="panel-guide" hidden>
    <div class="wrap">
      <div class="p-head"><div class="k">00 // NEWCOMER GUIDE</div><h2>新人导引</h2>
      <p class="desc">给第一次进入 DSH 内测群的成员准备的起步信息。</p></div>
      <div class="guide-empty" id="guideContent">
        <div><div class="icon" aria-hidden="true">🔥</div><h3>新人导引正在整理</h3><p>这里已经预留为独立内容入口。后续资料上传到私有 GitHub 仓库后，会自动同步到这个位置。</p><span class="status">COMING SOON</span></div>
      </div>
    </div>
  </section>

  `;
shell = replaceOnce(shell, '<main id="main">\n  ', `<main id="main">\n  ${guidePanel}`, "主内容入口");

const modulePrelude = `<script type="module">"use strict";

const manifestResponse = await fetch("/data/manifest.json", { cache: "no-store" });
if (!manifestResponse.ok) throw new Error(\`manifest.json: HTTP \${manifestResponse.status}\`);
const SITE_MANIFEST = await manifestResponse.json();
if (!Array.isArray(SITE_MANIFEST.dates) || !SITE_MANIFEST.dates.length || !SITE_MANIFEST.latest) {
  throw new Error("站点日期清单无效");
}
const requestedDate = new URL(location.href).searchParams.get("date");
const SELECTED_DATE = SITE_MANIFEST.dates.includes(requestedDate) ? requestedDate : SITE_MANIFEST.latest;
const snapshotResponse = await fetch(\`/data/\${SELECTED_DATE}.json\`, { cache: "no-store" });
if (!snapshotResponse.ok) throw new Error(\`\${SELECTED_DATE}.json: HTTP \${snapshotResponse.status}\`);
const EMBEDDED_SNAPSHOT = await snapshotResponse.json();
const guideResponse = await fetch("/data/newcomer-guide.json", { cache: "no-store" });
const NEWCOMER_GUIDE = guideResponse.ok ? await guideResponse.json() : { version: 1, status: "empty", sections: [] };
document.title = \`DSH 档案馆 · \${SELECTED_DATE}\`;
`;
shell = replaceOnce(shell, '<script>"use strict";\n', modulePrelude, "应用脚本入口");
shell = replaceOnce(shell, "const EMBEDDED_SNAPSHOT = globalThis.__DSH_SNAPSHOT__ ?? null;\n", "", "旧内嵌快照变量");

const dateFunctions = `function formatDateLabel(date) {
  const [year, month, day] = date.split("-").map(Number);
  return \`\${year}年\${month}月\${day}日\`;
}

function initDatePicker() {
  const picker = $("datePicker");
  picker.innerHTML = "";
  for (const date of SITE_MANIFEST.dates) {
    const option = document.createElement("option");
    option.value = date;
    option.textContent = \`\${formatDateLabel(date)}\${date === SITE_MANIFEST.latest ? " · 最新" : ""}\`;
    picker.appendChild(option);
  }
  picker.value = SELECTED_DATE;
  picker.addEventListener("change", () => {
    const next = new URL(location.href);
    if (picker.value === SITE_MANIFEST.latest) next.searchParams.delete("date");
    else next.searchParams.set("date", picker.value);
    location.href = next.toString();
  });
  const entry = SITE_MANIFEST.entries?.find((item) => item.date === SELECTED_DATE);
  $("snapshotMeta").textContent = \`\${formatDateLabel(SELECTED_DATE)} · \${entry?.messages ?? 0} 条消息 · EOF\`;
}

function renderGuide() {
  const content = $("guideContent");
  const sections = Array.isArray(NEWCOMER_GUIDE?.sections) ? NEWCOMER_GUIDE.sections : [];
  if (!sections.length) return;
  content.className = "guide-content";
  content.innerHTML = sections.map((section) => {
    const items = Array.isArray(section.items) && section.items.length
      ? \`<ul>\${section.items.map((item) => \`<li>\${escapeHtml(item)}</li>\`).join("")}</ul>\`
      : "";
    return \`<article class="guide-section"><h3>\${escapeHtml(section.title || "未命名章节")}</h3>\` +
      \`<p>\${escapeHtml(section.body || "")}</p>\${items}</article>\`;
  }).join("");
}

`;
shell = replaceOnce(shell, "function initTabs() {\n", `${dateFunctions}function initTabs() {\n`, "标签初始化函数");
shell = replaceOnce(shell,
  '  const tabs = [["delta", "今日新增"], ["cards", "星卡"], ["signals", "信号"], ["chronicle", "纪事"], ["issues", "Issue"], ["data", "数据"]];',
  '  const tabs = [["delta", "今日最新"], ["guide", "新人导引"], ["cards", "星卡"], ["signals", "信号"], ["chronicle", "纪事"], ["issues", "Issue"], ["data", "数据"]];',
  "主标签列表",
);
shell = replaceOnce(shell,
  '  let current = EMBEDDED_SNAPSHOT?.comparison?.status === "ready" ? "delta" : "cards";',
  '  const requestedTab = new URL(location.href).searchParams.get("tab");\n  let current = tabs.some(([key]) => key === requestedTab) ? requestedTab : "delta";',
  "默认标签",
);
shell = replaceOnce(shell,
  "    button.textContent = label;\n    button.classList.toggle(\"on\", key === current);",
  "    button.textContent = label;\n    button.dataset.tab = key;\n    button.classList.toggle(\"guide-tab\", key === \"guide\");\n    button.classList.toggle(\"on\", key === current);",
  "标签按钮样式",
);
shell = replaceOnce(shell,
  '      document.querySelectorAll(".panel").forEach((panel) => { panel.hidden = panel.id !== `panel-${key}`; });\n      window.scrollTo({ top: 0, behavior: "instant" });',
  '      document.querySelectorAll(".panel").forEach((panel) => { panel.hidden = panel.id !== `panel-${key}`; });\n      const next = new URL(location.href);\n      if (key === "delta") next.searchParams.delete("tab");\n      else next.searchParams.set("tab", key);\n      history.replaceState({}, "", next);\n      window.scrollTo({ top: 0, behavior: "instant" });',
  "标签地址状态",
);
shell = shell
  .replace('<div class="k">00 // DAILY DELTA</div><h2>今日新增</h2>', '<div class="k">00 // DAILY DELTA</div><h2>今日最新</h2>')
  .replaceAll("正在载入本文件内嵌的群聊与 Issue 快照…", "正在载入当前日期的群聊与 Issue 快照…")
  .replaceAll("已载入本文件快照：", "已载入站点快照：")
  .replaceAll("文件生成于", "快照生成于")
  .replaceAll("单文件快照中没有", "当前日期快照中没有");
shell = replaceOnce(shell,
  'initTabs();\ninitWarp();',
  'initDatePicker();\nrenderGuide();\ninitTabs();\ninitWarp();',
  "应用初始化",
);
shell = replaceOnce(shell,
  '$("refreshBtn").addEventListener("click", () => refreshAll());',
  '$("refreshBtn").addEventListener("click", () => location.reload());',
  "检查更新按钮",
);

await writeFile(path.join(siteDir, "index.html"), shell, "utf8");
const guidePath = path.join(contentDir, "newcomer-guide.json");
try {
  await access(guidePath);
} catch {
  await writeFile(guidePath, `${JSON.stringify({
    version: 1,
    status: "empty",
    updatedAt: null,
    sections: [],
  })}\n`, "utf8");
}
await writeFile(path.join(root, "latest.txt"), `${latest.date}.json\n`, "utf8");

console.log(`迁移完成：${snapshots.length} 份 JSON 快照，唯一站点外壳为 site/index.html，默认 ${latest.date}`);
