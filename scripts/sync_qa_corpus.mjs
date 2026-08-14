import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tokenize } from "../qa/retrieval.mjs";
import { isOfficialInformationRecord } from "../shared/official-chronicle.mjs";
import { enforceFixedArchive } from "./lib/frozen-archive-policy.mjs";

enforceFixedArchive("旧式 QA 语料");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpusRoot = path.join(root, "corpus");
const target = process.env.QA_D1_TARGET === "local" ? "--local" : "--remote";
const database = "QA_DB";
const corpusFormatVersion = "3-official-information";
const blockedContent = [
  /file:\/\/\//iu,
  /\/Users\/[^/]+\//u,
  /[A-Za-z]:\\Users\\[^\\]+\\/iu,
  /github_pat_[A-Za-z0-9_]+/u,
  /gho_[A-Za-z0-9]+/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
];

function runWrangler(args, options = {}) {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function query(sql) {
  const output = runWrangler(["d1", "execute", database, target, "--command", sql, "--json", "--yes"]);
  const payload = JSON.parse(output);
  return payload.flatMap((entry) => Array.isArray(entry.results) ? entry.results : []);
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("\0", "").replaceAll("'", "''")}'`;
}

function nullableString(value) {
  return value === null || value === undefined || value === "" ? "NULL" : sqlString(value);
}

function nullableInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : "NULL";
}

function trimText(value, limit = 900) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function assertPrivateContent(text, name) {
  if (blockedContent.some((pattern) => pattern.test(text))) {
    throw new Error(`${name} 命中隐私或凭据保护规则；拒绝同步问答语料。`);
  }
}

function insertStatements(table, columns, rows, maxRows = 30, maxCharacters = 80_000) {
  const statements = [];
  let chunk = [];
  let characters = 0;
  const flush = () => {
    if (!chunk.length) return;
    statements.push(`INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES\n${chunk.join(",\n")};`);
    chunk = [];
    characters = 0;
  };
  for (const row of rows) {
    if (chunk.length && (chunk.length >= maxRows || characters + row.length > maxCharacters)) flush();
    chunk.push(row);
    characters += row.length;
  }
  flush();
  return statements;
}

const manifestText = readFileSync(path.join(corpusRoot, "manifest.json"), "utf8");
assertPrivateContent(manifestText, "corpus/manifest.json");
const manifest = JSON.parse(manifestText);
const groupDates = Array.isArray(manifest.groupChat?.dates) ? manifest.groupChat.dates : [];
const issueDates = Array.isArray(manifest.issues?.dates) ? manifest.issues.dates : [];
if (!groupDates.length || !issueDates.length) throw new Error("私有问答语料清单不完整。");

const hash = createHash("sha256");
hash.update(corpusFormatVersion);
hash.update(manifestText);
const groupRows = [];
for (const entry of groupDates) {
  const name = `corpus/group-chat/${entry.date}.jsonl`;
  const content = readFileSync(path.join(root, name), "utf8");
  assertPrivateContent(content, name);
  hash.update(content);
  for (const line of content.split("\n")) if (line.trim()) groupRows.push(JSON.parse(line));
}

const latestIssueDate = issueDates.at(-1)?.date;
const issueName = `corpus/issues/${latestIssueDate}.json`;
const issueText = readFileSync(path.join(root, issueName), "utf8");
assertPrivateContent(issueText, issueName);
hash.update(issueText);
const issuePayload = JSON.parse(issueText);
const issues = Array.isArray(issuePayload.issues) ? issuePayload.issues : [];
if (groupRows.length !== Number(manifest.groupChat.totalMessages) || issues.length !== Number(issueDates.at(-1)?.issueCount)) {
  throw new Error("私有问答语料计数与清单不一致。");
}
if (!groupRows.length || !issues.length) throw new Error("拒绝用空语料覆盖线上问答库。");

const syncId = hash.digest("hex").slice(0, 20);
const currentMetaRows = query("SELECT key, value FROM qa_corpus_meta WHERE key IN ('active_sync_id', 'message_count', 'issue_count');");
const currentMeta = new Map(currentMetaRows.map((row) => [row.key, row.value]));
if (currentMeta.get("active_sync_id") === syncId) {
  const currentCounts = query(`SELECT kind, COUNT(*) AS count FROM qa_corpus_documents WHERE sync_id = ${sqlString(syncId)} GROUP BY kind;`);
  const byKind = new Map(currentCounts.map((row) => [row.kind, Number(row.count)]));
  if (Number(currentMeta.get("message_count")) !== groupRows.length
    || Number(currentMeta.get("issue_count")) !== issues.length
    || byKind.get("group") !== groupRows.length
    || byKind.get("issue") !== issues.length) {
    throw new Error("线上问答库元数据与当前语料哈希冲突；保持现状。");
  }
  console.log(`问答语料未变化：${groupRows.length} 条群消息，${issues.length} 条 Issue，sync ${syncId}。`);
  process.exit(0);
}

const documents = [];
const ftsRows = [];
groupRows.forEach((row, position) => {
  const documentKey = `${syncId}:g:${row.id}`;
  const sourceDate = String(row.timestamp ?? "").slice(0, 10);
  const content = String(row.text ?? "");
  const isChangelog = isOfficialInformationRecord(row) ? 1 : 0;
  const tokens = tokenize([row.sender, row.messageType, content, row.timestamp].filter(Boolean).join(" ")).slice(0, 2_000).join(" ");
  documents.push(`(${[
    sqlString(documentKey), sqlString(syncId), sqlString("group"), sqlString(sourceDate), String(position),
    sqlString(row.timestamp), nullableString(row.sender), "NULL", "NULL", "NULL", "NULL", "NULL", String(isChangelog),
    nullableString(trimText(content, 320)), sqlString(content),
  ].join(", ")})`);
  ftsRows.push(`(${sqlString(documentKey)}, ${sqlString(tokens)})`);
});

issues.forEach((issue, position) => {
  const documentKey = `${syncId}:i:${issue.n}`;
  const title = `#${issue.n} · ${String(issue.title ?? "Issue")}`;
  const content = [title, issue.summary, issue.excerpt, issue.cat, issue.group, ...(Array.isArray(issue.labels) ? issue.labels : [])]
    .filter(Boolean).join("\n");
  const tokens = tokenize(content).slice(0, 2_000).join(" ");
  documents.push(`(${[
    sqlString(documentKey), sqlString(syncId), sqlString("issue"), sqlString(String(issue.created ?? latestIssueDate).slice(0, 10)),
    String(position), sqlString(issue.created ?? `${latestIssueDate}T00:00:00Z`), "NULL", sqlString(title),
    nullableString(issue.url), nullableString(issue.state), nullableString(issue.cat), nullableInteger(issue.priority), "0",
    nullableString(trimText(issue.summary || issue.excerpt, 900)), sqlString(content),
  ].join(", ")})`);
  ftsRows.push(`(${sqlString(documentKey)}, ${sqlString(tokens)})`);
});

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "dsh-qa-sync-"));
const sqlFile = path.join(temporaryDirectory, "qa-corpus.sql");
try {
  runWrangler(["d1", "execute", database, target, "--command",
    `DELETE FROM qa_corpus_fts WHERE document_key LIKE ${sqlString(`${syncId}:%`)}; DELETE FROM qa_corpus_documents WHERE sync_id = ${sqlString(syncId)};`,
    "--yes"]);
  const statements = [
    ...insertStatements("qa_corpus_documents", [
      "document_key", "sync_id", "kind", "source_date", "position", "occurred_at", "sender", "title",
      "url", "state", "category", "priority", "is_changelog", "excerpt", "content",
    ], documents),
    ...insertStatements("qa_corpus_fts", ["document_key", "tokens"], ftsRows),
  ];
  writeFileSync(sqlFile, `${statements.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  runWrangler(["d1", "execute", database, target, "--file", sqlFile, "--yes"]);

  const counts = query(`SELECT kind, COUNT(*) AS count FROM qa_corpus_documents WHERE sync_id = ${sqlString(syncId)} GROUP BY kind;`);
  const byKind = new Map(counts.map((row) => [row.kind, Number(row.count)]));
  if (byKind.get("group") !== groupRows.length || byKind.get("issue") !== issues.length) {
    throw new Error("D1 写入计数校验失败；旧版线上语料保持激活。");
  }

  const syncedAt = new Date().toISOString();
  const metadata = new Map([
    ["active_sync_id", syncId],
    ["message_count", String(groupRows.length)],
    ["issue_count", String(issues.length)],
    ["group_date_count", String(groupDates.length)],
    ["latest_group_date", String(groupDates.at(-1)?.date ?? "")],
    ["latest_issue_date", String(latestIssueDate)],
    ["synced_at", syncedAt],
  ]);
  const metadataSql = [...metadata].map(([key, value]) => `
    INSERT INTO qa_corpus_meta (key, value, updated_at) VALUES (${sqlString(key)}, ${sqlString(value)}, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;
  `).join("\n");
  runWrangler(["d1", "execute", database, target, "--command", `${metadataSql}
    DELETE FROM qa_corpus_fts WHERE document_key NOT LIKE ${sqlString(`${syncId}:%`)};
    DELETE FROM qa_corpus_documents WHERE sync_id <> ${sqlString(syncId)};
    DELETE FROM qa_rate_limits WHERE updated_at < datetime('now', '-1 day');
  `, "--yes"]);

  const verified = query("SELECT key, value FROM qa_corpus_meta WHERE key IN ('active_sync_id', 'message_count', 'issue_count', 'synced_at');");
  const verifiedMeta = new Map(verified.map((row) => [row.key, row.value]));
  if (verifiedMeta.get("active_sync_id") !== syncId
    || Number(verifiedMeta.get("message_count")) !== groupRows.length
    || Number(verifiedMeta.get("issue_count")) !== issues.length) {
    throw new Error("D1 激活后的问答语料校验失败。");
  }
  console.log(`已同步问答语料：${groupRows.length} 条群消息，${issues.length} 条 Issue，${verifiedMeta.get("synced_at")}，sync ${syncId}。`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
