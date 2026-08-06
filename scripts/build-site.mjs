import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

function validateSnapshot(snapshot, name, expectedDate) {
  if (!snapshot || snapshot.group?.version !== 3 || snapshot.group?.source?.group !== "【官方】DSH内测群") {
    throw new Error(`${name} 不是合法的 DSH 内测群快照`);
  }
  if (!Number.isInteger(snapshot.group?.stats?.accepted_messages) || !Array.isArray(snapshot.group?.signals)) {
    throw new Error(`${name} 的群聊统计或信号数据不完整`);
  }
  if (snapshot.issues?.version !== 2 || !Array.isArray(snapshot.issues?.issues) || !Array.isArray(snapshot.issues?.issue_groups)) {
    throw new Error(`${name} 的 Issue 数据不完整`);
  }
  if (snapshot.snapshotDate !== expectedDate) throw new Error(`${name} 的 snapshotDate 与文件日期不一致`);
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
  entries.push({
    date,
    generatedAt: snapshot.generatedAt ?? null,
    cutoff: snapshot.group.stats.date_end,
    messages: snapshot.group.stats.accepted_messages,
    issues: snapshot.issues.issues.length,
  });
}

const sitePath = path.join(siteDir, "index.html");
const faviconPath = path.join(siteDir, "favicon.png");
const guidePath = path.join(contentDir, "newcomer-guide.json");
await assertReadable(sitePath, "缺少唯一站点外壳 site/index.html");
await assertReadable(faviconPath, "缺少站点图标 site/favicon.png");
await assertReadable(guidePath, "缺少新人导引数据 content/newcomer-guide.json");
const siteHtml = await readFile(sitePath, "utf8");
const guideText = await readFile(guidePath, "utf8");
assertPublishable(siteHtml, "site/index.html");
assertPublishable(guideText, "content/newcomer-guide.json");
if (!siteHtml.includes('id="datePicker"') || !siteHtml.includes('id="panel-guide"') || !siteHtml.includes("/data/manifest.json")) {
  throw new Error("站点外壳缺少日期切换或新人导引入口");
}
if (!siteHtml.includes('rel="icon"') || !siteHtml.includes('/favicon.png?v=20260806')) {
  throw new Error("站点外壳缺少指定 favicon");
}
if (!siteHtml.includes('fetch("/data/newcomer-guide.json"') || !siteHtml.includes("固定内容 · 不随日期切换")) {
  throw new Error("新人导引必须使用独立的全局内容源，并明确不随日期切换");
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
if (!siteHtml.includes('[...(state.group?.chronicles ?? [])].sort((left, right) =>')) {
  throw new Error("纪事必须按时间倒序渲染");
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
if (guide?.version !== 1 || !Array.isArray(guide.sections)) throw new Error("newcomer-guide.json 格式不合法");

if (process.argv.includes("--check")) {
  console.log(`校验通过：${snapshotNames.length} 份 JSON 快照，首页默认 ${latestMatch[1]}，站点 HTML 仅 1 份`);
  process.exit(0);
}

await rm(output, { recursive: true, force: true });
await mkdir(dataOutput, { recursive: true });
await copyFile(sitePath, path.join(output, "index.html"));
await copyFile(faviconPath, path.join(output, "favicon.png"));
for (const name of snapshotNames) await copyFile(path.join(snapshotsDir, name), path.join(dataOutput, name));
await copyFile(guidePath, path.join(dataOutput, "newcomer-guide.json"));

await writeFile(path.join(dataOutput, "manifest.json"), `${JSON.stringify({
  version: 1,
  latest: latestMatch[1],
  dates: entries.map((entry) => entry.date),
  entries,
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

console.log(`构建完成：1 个站点 HTML，${snapshotNames.length} 份日期快照，默认 ${latestMatch[1]}`);
