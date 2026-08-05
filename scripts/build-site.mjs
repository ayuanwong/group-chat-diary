import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const archiveOutput = path.join(output, "archive");
const diaryPattern = /^DSH内测群每日档案-(\d{4})\.html$/;
const blockedContent = [
  { pattern: /file:\/\/\//i, label: "本机 file URL" },
  { pattern: /\/Users\/[^/]+\//, label: "macOS 本机绝对路径" },
  { pattern: /github_pat_[A-Za-z0-9_]+/, label: "GitHub token" },
  { pattern: /gho_[A-Za-z0-9]+/, label: "GitHub OAuth token" },
];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function assertReadable(filePath, message) {
  try {
    await access(filePath);
  } catch {
    throw new Error(message);
  }
}

const latestName = (await readFile(path.join(root, "latest.txt"), "utf8")).trim();
if (!diaryPattern.test(latestName) || path.basename(latestName) !== latestName) {
  throw new Error("latest.txt 必须只包含一个合法的档案文件名");
}

const latestPath = path.join(root, latestName);
await assertReadable(latestPath, `latest.txt 指向的文件不存在：${latestName}`);

const diaryFiles = (await readdir(root))
  .filter((name) => diaryPattern.test(name))
  .sort((a, b) => b.localeCompare(a, "zh-CN", { numeric: true }));
if (!diaryFiles.includes(latestName)) {
  throw new Error(`最新档案未进入归档列表：${latestName}`);
}

for (const name of diaryFiles) {
  const html = await readFile(path.join(root, name), "utf8");
  if (!html.includes("globalThis.__DSH_SNAPSHOT__")) {
    throw new Error(`${name} 不是可独立打开的内嵌快照`);
  }
  for (const rule of blockedContent) {
    if (rule.pattern.test(html)) {
      throw new Error(`${name} 包含不应发布的${rule.label}`);
    }
  }
}

if (process.argv.includes("--check")) {
  console.log(`校验通过：${diaryFiles.length} 份档案，首页为 ${latestName}`);
  process.exit(0);
}

await rm(output, { recursive: true, force: true });
await mkdir(archiveOutput, { recursive: true });

await copyFile(latestPath, path.join(output, "index.html"));
for (const name of diaryFiles) {
  await copyFile(path.join(root, name), path.join(archiveOutput, name));
}

const archiveLinks = diaryFiles.map((name) => {
  const label = name.match(diaryPattern)?.[1] ?? name;
  return `<li><a href="./${encodeURIComponent(name)}">${escapeHtml(label)}</a>${name === latestName ? " <strong>最新</strong>" : ""}</li>`;
}).join("\n");

await writeFile(path.join(archiveOutput, "index.html"), `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>DSH 内测群每日档案</title>
  <style>
    :root{color-scheme:dark}body{max-width:760px;margin:64px auto;padding:0 24px;background:#030703;color:#c8ffd6;font:16px/1.8 ui-monospace,SFMono-Regular,Menlo,monospace}a{color:#33ff66}strong{font-size:12px;color:#ffb347}li{margin:12px 0}
  </style>
</head>
<body>
  <h1>DSH 内测群每日档案</h1>
  <p>仅限通过 GitHub 组织权限验证的成员查看。</p>
  <ol>${archiveLinks}</ol>
  <p><a href="/">返回最新档案</a></p>
</body>
</html>
`, "utf8");

await writeFile(path.join(output, "robots.txt"), "User-agent: *\nDisallow: /\n", "utf8");
await writeFile(path.join(output, "_headers"), `/*
  Cache-Control: private, no-store, max-age=0
  X-Robots-Tag: noindex, nofollow, noarchive
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
`, "utf8");

console.log(`构建完成：${diaryFiles.length} 份档案，首页为 ${latestName}`);
