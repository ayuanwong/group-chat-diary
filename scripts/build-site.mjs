import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { officialChronicles } from "./lib/chronicle-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const dataOutput = path.join(output, "data");
const snapshotsDir = path.join(root, "snapshots");
const siteDir = path.join(root, "site");
const contentDir = path.join(root, "content");
const snapshotPattern = /^(\d{4}-\d{2}-\d{2})\.json$/;
const blockedContent = [
  { pattern: /file:\/\/\//i, label: "本机 file URL" },
  { pattern: /\/Users\/[^/]+\//, label: "macOS 本机绝对路径" },
  { pattern: /github_pat_[A-Za-z0-9_]+/, label: "GitHub token" },
  { pattern: /gho_[A-Za-z0-9]+/, label: "GitHub OAuth token" },
  { pattern: /raw-messages\.local\.json/iu, label: "本地原始消息文件名" },
];

async function assertReadable(filePath, message) {
  try {
    await access(filePath);
  } catch {
    throw new Error(message);
  }
}

function assertPublishable(text, name) {
  for (const rule of blockedContent) {
    if (rule.pattern.test(text)) throw new Error(`${name} 包含不应发布的${rule.label}`);
  }
}

function publishableSnapshot(snapshot) {
  const source = snapshot?.group?.source ?? {};
  return {
    ...snapshot,
    group: {
      ...snapshot.group,
      chronicles: officialChronicles(snapshot?.group?.chronicles),
      source: {
        group: source.group,
        identity_rules: source.identity_rules,
        privacy: source.privacy,
      },
    },
  };
}

function validateSnapshot(snapshot, name, expectedDate) {
  if (!snapshot || snapshot.group?.version !== 3 || snapshot.group?.source?.group !== "【官方】DSH内测群") {
    throw new Error(`${name} 不是合法的 DSH 内测群快照`);
  }
  if (!Number.isInteger(snapshot.group?.stats?.accepted_messages) || !Array.isArray(snapshot.group?.signals)) {
    throw new Error(`${name} 的群聊统计或信号数据不完整`);
  }
  if (!Array.isArray(snapshot.group?.chronicles)
    || officialChronicles(snapshot.group.chronicles).length !== snapshot.group.chronicles.length) {
    throw new Error(`${name} 的纪事包含非 DSH 官方项目更新`);
  }
  if (snapshot.issues?.version !== 2 || !Array.isArray(snapshot.issues?.issues) || !Array.isArray(snapshot.issues?.issue_groups)) {
    throw new Error(`${name} 的 Issue 数据不完整`);
  }
  if (snapshot.snapshotDate !== expectedDate) throw new Error(`${name} 的 snapshotDate 与文件日期不一致`);
  const sourceKeys = Object.keys(snapshot.group.source ?? {});
  if (sourceKeys.some((key) => !["group", "identity_rules", "privacy"].includes(key))) {
    throw new Error(`${name} 的页面快照包含证据源元数据`);
  }
}

const latestName = (await readFile(path.join(root, "latest.txt"), "utf8")).trim();
const latestMatch = latestName.match(snapshotPattern);
if (!latestMatch || path.basename(latestName) !== latestName) {
  throw new Error("latest.txt 必须只包含一个 YYYY-MM-DD.json 快照文件名");
}

const snapshotNames = (await readdir(snapshotsDir))
  .filter((name) => snapshotPattern.test(name))
  .sort((a, b) => b.localeCompare(a));
if (!snapshotNames.includes(latestName)) throw new Error(`最新快照不存在：${latestName}`);

const entries = [];
const publishableSnapshots = new Map();
for (const name of snapshotNames) {
  const filePath = path.join(snapshotsDir, name);
  const text = await readFile(filePath, "utf8");
  assertPublishable(text, name);
  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch {
    throw new Error(`${name} 不是合法 JSON`);
  }
  const date = name.match(snapshotPattern)?.[1];
  validateSnapshot(snapshot, name, date);
  const publishable = publishableSnapshot(snapshot);
  assertPublishable(JSON.stringify(publishable), `${name} 发布副本`);
  publishableSnapshots.set(name, publishable);
  entries.push({
    date,
    generatedAt: snapshot.generatedAt ?? null,
    cutoff: snapshot.group.stats.date_end,
    messages: snapshot.group.stats.accepted_messages,
    issues: snapshot.issues.issues.length,
  });
}

// Consecutive-day snapshot diffs for the 快照 Diff tab (newest snapshot last).
const datesAsc = [...publishableSnapshots.keys()].sort();
const snapshotDiffs = datesAsc.map((name, index) => {
  const snap = publishableSnapshots.get(name);
  const group = snap.group ?? {};
  const issues = snap.issues?.issues ?? [];
  const cmp = snap.comparison;
  const previous = index > 0 ? publishableSnapshots.get(datesAsc[index - 1]) : null;
  const issueByNumber = Object.fromEntries(issues.map((issue) => [issue.n, issue]));
  const signalById = new Map((group.signals ?? []).map((signal) => [signal.message_id, signal]));
  return {
    date: name.replace(/\.json$/, ""),
    previousLabel: cmp?.previousLabel ?? null,
    stats: {
      messages: group.stats?.accepted_messages ?? 0,
      signals: group.signals?.length ?? 0,
      members: group.members?.length ?? 0,
      issues: issues.length,
      chronicles: group.chronicles?.length ?? 0,
    },
    delta: cmp && cmp.status === "ready" ? {
      newMessages: cmp.newMessageCount ?? 0,
      newIssues: (cmp.newIssueNumbers ?? []).map((number) => issueByNumber[number]).filter(Boolean)
        .map((issue) => ({ n: issue.n, title: issue.title, cat: issue.cat ?? "其他", url: issue.url })),
      newSignals: (cmp.newSignalMessageIds ?? []).map((id) => signalById.get(id)).filter(Boolean)
        .map((signal) => ({ sender: signal.sender, time: signal.time, cat: signal.cat ?? "", text: signal.text })),
      newMembers: Math.max(0, (group.members?.length ?? 0) - (previous?.group?.members?.length ?? 0)),
      newChronicles: Math.max(0, (group.chronicles?.length ?? 0) - (previous?.group?.chronicles?.length ?? 0)),
      topicDeltas: cmp.topicDeltas ?? [],
    } : null,
  };
});
assertPublishable(JSON.stringify(snapshotDiffs), "snapshot-diffs 数据");

const sitePath = path.join(siteDir, "index.html");
const groupChroniclePath = path.join(siteDir, "group-chronicle.mjs");
const faviconPath = path.join(siteDir, "favicon.png");
const guidePath = path.join(contentDir, "newcomer-guide.json");
const agentNotesPath = path.join(contentDir, "agent-notes.json");
await assertReadable(sitePath, "缺少唯一站点外壳 site/index.html");
await assertReadable(groupChroniclePath, "缺少群聊纪事聚合模块 site/group-chronicle.mjs");
await assertReadable(faviconPath, "缺少站点图标 site/favicon.png");
await assertReadable(guidePath, "缺少新人导引数据 content/newcomer-guide.json");
await assertReadable(agentNotesPath, "缺少 Agent Notes 数据 content/agent-notes.json");
const siteHtml = await readFile(sitePath, "utf8");
const groupChronicleModule = await readFile(groupChroniclePath, "utf8");
const guideText = await readFile(guidePath, "utf8");
const agentNotesText = await readFile(agentNotesPath, "utf8");
assertPublishable(siteHtml, "site/index.html");
assertPublishable(groupChronicleModule, "site/group-chronicle.mjs");
assertPublishable(guideText, "content/newcomer-guide.json");
assertPublishable(agentNotesText, "content/agent-notes.json");
if (!siteHtml.includes('id="datePicker"') || !siteHtml.includes('id="panel-guide"') || !siteHtml.includes("/data/manifest.json")) {
  throw new Error("站点外壳缺少日期切换或新人导引入口");
}
if (!siteHtml.includes('/api/content/manifest') || !siteHtml.includes('/api/content/group-history') || !siteHtml.includes('id="boardRepos"')
  || !siteHtml.includes('id="repoList"') || !siteHtml.includes('Issue / Repo')) {
  throw new Error("站点外壳缺少实时内容 API 或 Issue/Repo Board");
}
if (!siteHtml.includes('import { buildGroupChronicle } from "./group-chronicle.mjs"')
  || !siteHtml.includes('id="chronicleTabs"') || !siteHtml.includes('id="chronicleOfficial"')
  || !siteHtml.includes('id="chronicleGroup"') || !siteHtml.includes('id="groupChronicle"')) {
  throw new Error("纪事页必须包含官方纪事与群聊纪事双 Tab，并加载群聊时间线聚合模块");
}
if (!siteHtml.includes("ALLOW_STATIC_CONTENT") || !siteHtml.includes("未启用静态快照")
  || !siteHtml.includes("checkForContentUpdate") || !siteHtml.includes("manifest.liveGroup?.syncedAt")
  || !siteHtml.includes("manifest.liveChronicle?.activatedAt")) {
  throw new Error("生产站必须使用 D1 实时内容、禁止静默回退旧快照，并自动检查数据版本");
}
if (!siteHtml.includes('id="chronicleFreshness"') || !siteHtml.includes("最新采集至")
  || !siteHtml.includes('"completed-days-plus-live"')) {
  throw new Error("纪事视图必须显示独立实时采集点，数据总览继续使用完成自然日");
}
if (!siteHtml.includes("它是什么") || !siteHtml.includes("最近发生") || !siteHtml.includes("为什么看")) {
  throw new Error("Repo Board 必须逐仓库提供用途、动态与价值解释");
}
if (siteHtml.includes("这不是另一份仓库清单") || siteHtml.includes("当前先看")
  || siteHtml.includes('id="repoNarrative"') || siteHtml.includes('id="repoHighlights"')) {
  throw new Error("Repo Board 不得显示内部设计说明或含义不清的优先阅读区");
}
if (!siteHtml.includes('rel="icon"') || !siteHtml.includes('/favicon.png?v=20260807')) {
  throw new Error("站点外壳缺少指定 favicon");
}
if (!siteHtml.includes('fetch("/data/newcomer-guide.json"') || !siteHtml.includes("固定内容 · 不随日期切换")
  || !siteHtml.includes("NEWCOMER_GUIDE.author") || !siteHtml.includes("renderBlock")) {
  throw new Error("新人导引必须使用独立的全局内容源，并明确不随日期切换");
}
if (siteHtml.includes("header{position:sticky") || siteHtml.includes(".delta-subtabs{position:sticky")) {
  throw new Error("页面头部和二级导航不得吸顶，避免新人指引与内容重叠");
}
if (siteHtml.includes('date === SITE_MANIFEST.latest ? " · 最新"')) {
  throw new Error("日期选择器不得把“最新”拼进日期文本，避免窄屏截断");
}
if (siteHtml.includes('$("snapshotMeta").textContent = `${formatDateLabel(SELECTED_DATE)}')) {
  throw new Error("日期选择器后不得重复显示当前日期");
}
if (siteHtml.includes("refreshBtn") || siteHtml.includes("检查更新")) {
  throw new Error("站点不得保留无效的手动检查更新按钮");
}
if (!siteHtml.includes('id="accountLogin"') || !siteHtml.includes('fetch("/api/me"') || !siteHtml.includes('action="/auth/logout"')) {
  throw new Error("顶部导航必须显示当前 GitHub 账户并提供退出入口");
}
if (!siteHtml.includes('id="qaConsole"') || !siteHtml.includes('id="qaForm"') || !siteHtml.includes('fetch("/api/ask"')) {
  throw new Error("今日最新顶部必须保留检索问答入口");
}
if (!siteHtml.includes('Repo 用 R') || !siteHtml.includes('repoCount')) {
  throw new Error("实时问答必须显示并支持 Repo 私有语料");
}
if (!siteHtml.includes('[...(state.history?.chronicles ?? [])].sort((left, right) =>')
  || !siteHtml.includes('state.history?.signals ?? []') || !siteHtml.includes('state.history?.members ?? []')) {
  throw new Error("纪事、信号与星卡必须从全量群聊视图读取，纪事按时间倒序渲染");
}
if (!siteHtml.includes("@少女阿原")) {
  throw new Error("页脚必须保留内容疑问联系人");
}
let guide;
try {
  guide = JSON.parse(guideText);
} catch {
  throw new Error("newcomer-guide.json 不是合法 JSON");
}
const guideBlockTypes = new Set(["heading", "paragraph", "list", "code", "callout", "table", "links"]);
if (guide?.version !== 2 || guide.status !== "published" || typeof guide.title !== "string"
  || guide.author !== "@inschrift-spruch-raum" || !Array.isArray(guide.sections) || guide.sections.length === 0
  || guide.sections.some((section) => typeof section.id !== "string" || typeof section.title !== "string"
    || !Array.isArray(section.blocks) || section.blocks.length === 0
    || section.blocks.some((block) => !guideBlockTypes.has(block?.type)))) {
  throw new Error("newcomer-guide.json 格式、发布状态或作者署名不合法");
}

if (process.argv.includes("--check")) {
  console.log(`校验通过：${snapshotNames.length} 份迁移期静态回退快照，回退基线 ${latestMatch[1]}；生产内容读取 CONTENT_DB，站点 HTML 仅 1 份`);
  process.exit(0);
}

await rm(output, { recursive: true, force: true });
await mkdir(dataOutput, { recursive: true });
await copyFile(sitePath, path.join(output, "index.html"));
await copyFile(groupChroniclePath, path.join(output, "group-chronicle.mjs"));
await copyFile(faviconPath, path.join(output, "favicon.png"));
for (const name of snapshotNames) {
  await writeFile(path.join(dataOutput, name), `${JSON.stringify(publishableSnapshots.get(name))}\n`, "utf8");
}
await copyFile(guidePath, path.join(dataOutput, "newcomer-guide.json"));
await copyFile(agentNotesPath, path.join(dataOutput, "agent-notes.json"));
await writeFile(path.join(dataOutput, "snapshot-diffs.json"), `${JSON.stringify(snapshotDiffs)}\n`, "utf8");

await writeFile(path.join(dataOutput, "manifest.json"), `${JSON.stringify({
  version: 1,
  latest: latestMatch[1],
  dates: entries.map((entry) => entry.date),
  entries,
  agentNotes: JSON.parse(agentNotesText)?.counts ?? null,
})}\n`, "utf8");

await writeFile(path.join(output, "robots.txt"), "User-agent: *\nDisallow: /\n", "utf8");
await writeFile(path.join(output, "_headers"), `/*
  Cache-Control: private, no-store, max-age=0
  X-Robots-Tag: noindex, nofollow, noarchive
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
`, "utf8");

console.log(`构建完成：1 个站点 HTML，${snapshotNames.length} 份迁移期静态回退快照，回退基线 ${latestMatch[1]}；生产内容读取 CONTENT_DB`);
