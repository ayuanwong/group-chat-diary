import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpusRoot = path.join(root, "corpus");
const groupOutput = path.join(corpusRoot, "group-chat");
const issueOutput = path.join(corpusRoot, "issues");
const snapshotsDir = path.join(root, "snapshots");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function requiredArg(name) {
  const value = argValue(name);
  if (!value) throw new Error(`缺少参数 ${name}`);
  return path.resolve(value);
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

function visibleXmlSummary(block) {
  const title = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
  const description = block.match(/<des>([\s\S]*?)<\/des>/i)?.[1];
  const visible = decodeEntities(title || description || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return visible ? `[引用] ${visible}` : "[引用媒体]";
}

function sanitizeText(value) {
  const original = String(value ?? "").replace(/\r\n?/g, "\n");
  let text = original
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<msg\b[\s\S]*?<\/msg>/gi, (block) => visibleXmlSummary(block))
    .replace(/<msg\b[\s\S]*$/gi, (block) => visibleXmlSummary(block))
    .replace(/\b(aeskey|cdnthumbaeskey|cdnmidimgurl|cdnthumburl)\s*=\s*(["'])[^"']*\2/gi, '$1="[已隐去]"');

  text = text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[私钥已隐去]")
    .replace(/(?<![\w:])\/Users\/[^\s<>"'，。；)）]+/gi, "[本机路径已隐去]")
    .replace(/\b[A-Za-z]:\\Users\\[^\s<>"'，。；)）]+/gi, "[本机路径已隐去]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[GitHub 凭据已隐去]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "[GitHub 凭据已隐去]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/gi, "[API Key 已隐去]")
    .replace(/((?:api[_ -]?key|access[_ -]?token|bearer|secret|password|密码|口令)\s*(?:是|为|[:：=])\s*)([^\s,，;；]{6,})/gi, "$1[已隐去]")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  return { text, changed: text !== original.trim() };
}

function sanitizeValue(value, state) {
  if (typeof value === "string") {
    const cleaned = sanitizeText(value);
    if (cleaned.changed) state.redactedFields += 1;
    return cleaned.text;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, state));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, state)]));
  }
  return value;
}

function assertPublishable(text, name) {
  const blocked = [
    /(?<![\w:])\/Users\/[^\s<>"']+/i,
    /\b[A-Za-z]:\\Users\\/i,
    /\bgithub_pat_[A-Za-z0-9_]+\b/,
    /\bgh[pousr]_[A-Za-z0-9_]+\b/,
    /\bsk-[A-Za-z0-9_-]{16,}\b/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /<msg\b|<appmsg\b|\baeskey\s*=/i,
  ];
  if (blocked.some((pattern) => pattern.test(text))) throw new Error(`${name} 仍包含不允许入库的本机或凭据信息`);
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  await writeFile(temporary, content, "utf8");
  await rename(temporary, filePath);
}

async function readJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error(`${label} 不是合法 JSON`);
  }
  return value;
}

function normalizeMessage(raw, sequence) {
  const timestamp = String(raw?.timestamp ?? "");
  const date = timestamp.slice(0, 10);
  if (!datePattern.test(date)) throw new Error(`第 ${sequence} 条群消息缺少合法时间`);
  if (!raw?.id || !["left", "right", "system"].includes(raw?.side)) {
    throw new Error(`第 ${sequence} 条群消息缺少 ID 或左右归属`);
  }
  const cleaned = sanitizeText(raw.text);
  return {
    sequence,
    id: String(raw.id),
    timestamp,
    sender: raw.sender ? String(raw.sender) : null,
    side: raw.side,
    messageType: String(raw.message_type ?? "未知"),
    text: cleaned.text,
    redacted: cleaned.changed,
  };
}

async function writeGroupCorpus(groupInput, requestedDate, backfill) {
  const source = await readJson(groupInput, "群聊输入");
  if (source?.group !== "【官方】DSH内测群" || !Array.isArray(source?.messages) || source.messages.length === 0) {
    throw new Error("群聊输入不是【官方】DSH内测群的完整消息集合");
  }
  const ids = new Set();
  const records = source.messages.map((message, index) => {
    const record = normalizeMessage(message, index + 1);
    if (ids.has(record.id)) throw new Error(`群聊输入存在重复消息 ID：${record.id}`);
    ids.add(record.id);
    return record;
  });
  const availableDates = [...new Set(records.map((record) => record.timestamp.slice(0, 10)))].sort();
  const dates = backfill ? availableDates : [requestedDate];
  for (const date of dates) {
    const dayRecords = records.filter((record) => record.timestamp.startsWith(`${date}T`));
    if (dayRecords.length === 0) throw new Error(`${date} 没有群聊消息，拒绝写入空语料`);
    const content = `${dayRecords.map((record) => JSON.stringify(record)).join("\n")}\n`;
    assertPublishable(content, `corpus/group-chat/${date}.jsonl`);
    await atomicWrite(path.join(groupOutput, `${date}.jsonl`), content);
  }
  return { records, availableDates };
}

async function verifyGroupCorpus(records, availableDates) {
  for (const date of availableDates) {
    const filePath = path.join(groupOutput, `${date}.jsonl`);
    let actual;
    try {
      const content = await readFile(filePath, "utf8");
      assertPublishable(content, `corpus/group-chat/${date}.jsonl`);
      actual = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      throw new Error(`${date} 的完整群聊语料缺失或损坏`);
    }
    const expected = records.filter((record) => record.timestamp.startsWith(`${date}T`));
    if (actual.length !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${date} 的完整群聊语料与本机权威数据不一致`);
    }
  }
}

async function writeIssueFile(date, generatedAt, issues) {
  if (!Array.isArray(issues) || issues.length === 0) throw new Error(`${date} 的 Issue 列表为空`);
  const state = { redactedFields: 0 };
  const payload = {
    version: 1,
    snapshotDate: date,
    generatedAt: generatedAt ?? new Date().toISOString(),
    source: { repository: "dsh-external/issues", kind: "github-issues-api" },
    issueCount: issues.length,
    redactedFields: state.redactedFields,
    issues: sanitizeValue(issues, state),
  };
  payload.redactedFields = state.redactedFields;
  const content = `${JSON.stringify(payload)}\n`;
  assertPublishable(content, `corpus/issues/${date}.json`);
  await atomicWrite(path.join(issueOutput, `${date}.json`), content);
}

async function writeIssueCorpus(issueInput, requestedDate, backfill) {
  if (backfill) {
    const names = (await readdir(snapshotsDir)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
    for (const name of names) {
      const snapshot = await readJson(path.join(snapshotsDir, name), name);
      await writeIssueFile(snapshot.snapshotDate, snapshot.generatedAt, snapshot.issues?.issues);
    }
    return;
  }
  const source = await readJson(issueInput, "Issue 输入");
  await writeIssueFile(requestedDate, source.updated_at, source.issues);
}

async function buildManifest() {
  const groupNames = (await readdir(groupOutput)).filter((name) => datePattern.test(name.replace(/\.jsonl$/, ""))).sort();
  const issueNames = (await readdir(issueOutput)).filter((name) => datePattern.test(name.replace(/\.json$/, ""))).sort();
  const groupDates = [];
  for (const name of groupNames) {
    const content = await readFile(path.join(groupOutput, name), "utf8");
    const rows = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    groupDates.push({
      date: name.slice(0, 10),
      messageCount: rows.length,
      redactedMessages: rows.filter((row) => row.redacted).length,
    });
  }
  const issueDates = [];
  for (const name of issueNames) {
    const payload = await readJson(path.join(issueOutput, name), name);
    issueDates.push({ date: name.slice(0, 10), issueCount: payload.issueCount, redactedFields: payload.redactedFields });
  }
  const manifest = {
    version: 1,
    group: "【官方】DSH内测群",
    access: "private-repository-only",
    updatedAt: new Date().toISOString(),
    groupChat: {
      format: "jsonl",
      dates: groupDates,
      totalMessages: groupDates.reduce((sum, item) => sum + item.messageCount, 0),
    },
    issues: {
      format: "json",
      dates: issueDates,
    },
  };
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  assertPublishable(content, "corpus/manifest.json");
  await atomicWrite(path.join(corpusRoot, "manifest.json"), content);
  return manifest;
}

const groupInput = requiredArg("--group");
const issueInput = requiredArg("--issues");
const requestedDate = argValue("--date");
const backfill = process.argv.includes("--backfill");
if (!requestedDate || !datePattern.test(requestedDate)) throw new Error("--date 必须是 YYYY-MM-DD");

const groupCorpus = await writeGroupCorpus(groupInput, requestedDate, backfill);
await verifyGroupCorpus(groupCorpus.records, groupCorpus.availableDates);
await writeIssueCorpus(issueInput, requestedDate, backfill);
const manifest = await buildManifest();
console.log(JSON.stringify({
  date: requestedDate,
  backfill,
  groupDates: manifest.groupChat.dates.length,
  totalMessages: manifest.groupChat.totalMessages,
  issueDates: manifest.issues.dates.length,
  latestIssueCount: manifest.issues.dates.at(-1)?.issueCount ?? 0,
}));
