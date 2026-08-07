import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { tokenize } from "../qa/retrieval.mjs";
import { mergeOfficialChronicles, withoutRepeatedChronicles } from "./lib/chronicle-policy.mjs";
import {
  assertPrivateContent,
  d1Target,
  executeSqlFile,
  insertStatements,
  nullableString,
  projectRoot,
  queryD1,
  run,
  runWrangler,
  sqlString,
  trimText,
} from "./lib/data-sync.mjs";

const CONTENT_DB = "CONTENT_DB";
const QA_DB = "QA_DB";
const GROUP = "【官方】DSH内测群";
const SELF = "少女阿原";
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const trackedRoot = path.join(projectRoot, "corpus", "group-chat");
const localRoot = path.join(projectRoot, ".local", "corpus", "group-chat");
const groupBuilder = path.resolve(projectRoot, "../dsh-archive/scripts/build_group_data.py");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function availableFiles() {
  const files = new Map();
  for (const directory of [trackedRoot, localRoot]) {
    try {
      for (const name of readdirSync(directory)) {
        const date = name.replace(/\.jsonl$/u, "");
        if (datePattern.test(date)) files.set(date, path.join(directory, name));
      }
    } catch {
      // The ignored local directory does not exist before the first new-style run.
    }
  }
  return new Map([...files.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function readRecords(file, date) {
  const text = readFileSync(file, "utf8");
  assertPrivateContent(text, `${date} 群聊语料`);
  const rows = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  if (!rows.length) throw new Error(`${date} 群聊语料为空。`);
  const ids = new Set();
  for (const row of rows) {
    if (!row.id || ids.has(row.id) || !String(row.timestamp ?? "").startsWith(`${date}T`)) {
      throw new Error(`${date} 群聊语料 ID 或日期无效。`);
    }
    if (row.side === "right" && row.sender !== SELF) throw new Error(`${date} 右侧消息归属错误。`);
    if (row.side === "left" && (!row.sender || row.sender === SELF)) throw new Error(`${date} 左侧消息归属错误。`);
    if (!['left', 'right', 'system'].includes(row.side)) throw new Error(`${date} 消息左右归属无效。`);
    ids.add(row.id);
  }
  return { rows, text };
}

function buildDigest(date, rows) {
  const directory = mkdtempSync(path.join(tmpdir(), "dsh-group-digest-"));
  const input = path.join(directory, "input.json");
  const output = path.join(directory, "output.json");
  try {
    const messages = rows.map((row) => ({
      id: row.id,
      group: GROUP,
      side: row.side,
      sender: row.sender ?? "",
      text: row.text,
      timestamp: row.timestamp,
      message_type: row.messageType,
      source: { kind: "wechat-local-database", evidence_ref: `sha256:${createHash("sha256").update(row.id).digest("hex")}` },
    }));
    writeFileSync(input, `${JSON.stringify({
      group: GROUP,
      source: { kind: "wechat-4.x-local-sqlcipher", parser: "wechat-cli 0.2.4" },
      messages,
    })}\n`, { encoding: "utf8", mode: 0o600 });
    run("python3", [groupBuilder, input, "--output", output]);
    const digest = JSON.parse(readFileSync(output, "utf8"));
    if (digest?.version !== 3 || digest?.source?.group !== GROUP || digest?.stats?.source_messages !== rows.length) {
      throw new Error(`${date} 群聊摘要与完整语料计数不一致。`);
    }
    digest.chronicles = mergeOfficialChronicles(digest.chronicles, rows);
    digest.source = {
      group: GROUP,
      identity_rules: digest.source.identity_rules,
      privacy: "完整脱敏语料仅保存在私有 QA_DB；页面只读取聚合与精选内容",
    };
    return digest;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function previousDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function beijingDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function comparison(date, current, previous) {
  const currentMessageCount = Number(current.stats?.accepted_messages ?? 0);
  if (!previous) return {
    version: 2,
    status: "unavailable",
    timeZone: "Asia/Shanghai",
    currentDate: date,
    previousDate: previousDate(date),
    currentMessageCount,
  };
  const previousTopics = new Map((previous.group_topic_words ?? []).map((item) => [item.t, Number(item.n ?? 0)]));
  const topicDeltas = (current.group_topic_words ?? []).map((item) => ({
    label: item.t,
    delta: Number(item.n ?? 0) - Number(previousTopics.get(item.t) ?? 0),
    current: Number(item.n ?? 0),
    previous: Number(previousTopics.get(item.t) ?? 0),
  })).filter((item) => item.delta > 0)
    .sort((left, right) => right.delta - left.delta || String(left.label).localeCompare(String(right.label), "zh"));
  const previousMembers = new Set((previous.members ?? []).map((member) => member.name));
  const previousChronicles = new Set((previous.chronicles ?? []).map((item) => item.message_id));
  return {
    version: 2,
    status: "ready",
    timeZone: "Asia/Shanghai",
    currentDate: date,
    previousDate: previousDate(date),
    currentMessageCount,
    previousMessageCount: Number(previous.stats?.accepted_messages ?? 0),
    messageCountChange: currentMessageCount - Number(previous.stats?.accepted_messages ?? 0),
    newMessageCount: currentMessageCount,
    newSignalMessageIds: (current.signals ?? []).map((item) => item.message_id),
    newMemberNames: (current.members ?? []).map((member) => member.name).filter((name) => !previousMembers.has(name)),
    newChronicleMessageIds: (current.chronicles ?? []).map((item) => item.message_id)
      .filter((messageId) => !previousChronicles.has(messageId)),
    topicDeltas,
  };
}

function stageGroupDay(date, rows, text, digest, previousDigest) {
  const generatedAt = new Date().toISOString();
  const ingestId = createHash("sha256").update("group-day-v2").update(text).digest("hex").slice(0, 24);
  const start = `${date}T00:00:00+08:00`;
  const endDate = new Date(`${date}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const payload = {
    version: 2,
    snapshotDate: date,
    period: { timeZone: "Asia/Shanghai", start, end: `${endDate.toISOString().slice(0, 10)}T00:00:00+08:00` },
    group: digest,
    comparison: comparison(date, digest, previousDigest),
    generatedAt,
  };
  const payloadText = JSON.stringify(payload);
  assertPrivateContent(payloadText, `${date} 展示摘要`);
  const stats = digest.stats;
  const values = {
    source: Number(stats.source_messages),
    accepted: Number(stats.accepted_messages),
    signals: digest.signals.length,
    participants: digest.members.length,
    chronicles: digest.chronicles.length,
  };
  if (values.source !== rows.length || values.accepted <= 0 || values.participants <= 0) {
    throw new Error(`${date} 展示摘要统计无效。`);
  }
  executeSqlFile(CONTENT_DB, `
    INSERT OR REPLACE INTO content_sync_runs
      (sync_id, source, source_date, status, item_count, started_at)
    VALUES (${sqlString(ingestId)}, 'group', ${sqlString(date)}, 'staged', ${rows.length}, ${sqlString(generatedAt)});
    INSERT OR REPLACE INTO content_group_versions
      (date, ingest_id, generated_at, source_message_count, accepted_message_count,
       signal_count, participant_count, chronicle_count, payload)
    VALUES (${sqlString(date)}, ${sqlString(ingestId)}, ${sqlString(generatedAt)},
      ${values.source}, ${values.accepted}, ${values.signals}, ${values.participants}, ${values.chronicles}, ${sqlString(payloadText)});
  `, "dsh-content-group-");
  const staged = queryD1(CONTENT_DB, `
    SELECT source_message_count, accepted_message_count, signal_count, participant_count,
      chronicle_count, json_valid(payload) AS valid
    FROM content_group_versions WHERE date = ${sqlString(date)} AND ingest_id = ${sqlString(ingestId)};
  `)[0];
  if (!staged || Number(staged.valid) !== 1 || Number(staged.source_message_count) !== rows.length
    || Number(staged.accepted_message_count) !== values.accepted) {
    throw new Error(`${date} CONTENT_DB 暂存校验失败，旧版本保持激活。`);
  }
  executeSqlFile(CONTENT_DB, `
    INSERT INTO content_active_group_days (date, ingest_id, activated_at)
    VALUES (${sqlString(date)}, ${sqlString(ingestId)}, ${sqlString(generatedAt)})
    ON CONFLICT(date) DO UPDATE SET ingest_id = excluded.ingest_id, activated_at = excluded.activated_at;
    UPDATE content_sync_runs SET status = 'active', finished_at = ${sqlString(generatedAt)}
    WHERE sync_id = ${sqlString(ingestId)};
  `, "dsh-content-group-activate-");
  const active = queryD1(CONTENT_DB, `
    SELECT ingest_id FROM content_active_group_days WHERE date = ${sqlString(date)};
  `)[0]?.ingest_id;
  if (active !== ingestId) throw new Error(`${date} CONTENT_DB 激活校验失败。`);
  return { date, ingestId, ...values, generatedAt };
}

function syncQaGroup(files) {
  const allRows = [];
  const hash = createHash("sha256").update("qa-group-v2");
  const globalIds = new Set();
  for (const [date, file] of files) {
    const { rows, text } = readRecords(file, date);
    hash.update(date).update(text);
    for (const row of rows) {
      if (globalIds.has(row.id)) throw new Error(`群聊完整语料存在跨日期重复 ID：${row.id}`);
      globalIds.add(row.id);
      allRows.push(row);
    }
  }
  if (!allRows.length) throw new Error("完整群聊语料为空，拒绝覆盖 QA_DB。");
  allRows.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
  const syncId = hash.digest("hex").slice(0, 24);
  const current = queryD1(QA_DB, "SELECT key, value FROM qa_corpus_meta WHERE key IN ('active_group_sync_id', 'group_message_count');");
  const currentMeta = new Map(current.map((row) => [row.key, row.value]));
  if (currentMeta.get("active_group_sync_id") === syncId && Number(currentMeta.get("group_message_count")) === allRows.length) {
    return { syncId, messages: allRows.length, unchanged: true, syncedAt: null };
  }

  const documents = [];
  const fts = [];
  allRows.forEach((row, position) => {
    const documentKey = `${syncId}:g:${row.id}`;
    const content = String(row.text ?? "");
    assertPrivateContent(content, `群消息 ${row.id}`);
    const authored = content.split("↳ 回复", 1)[0];
    const isChangelog = /deepseek harness changelog|changelog\s+\d{4}-\d{2}-\d{2}|✨\s*新增|🐛\s*修复|🎨\s*优化/iu.test(authored) ? 1 : 0;
    const tokens = tokenize([row.sender, row.messageType, content, row.timestamp].filter(Boolean).join(" ")).slice(0, 2_000).join(" ");
    documents.push(`(${[
      sqlString(documentKey), sqlString(syncId), sqlString("group"), sqlString(row.timestamp.slice(0, 10)),
      String(position), sqlString(row.timestamp), nullableString(row.sender), "NULL", "NULL", "NULL", "NULL", "NULL",
      String(isChangelog), nullableString(trimText(content, 320)), sqlString(content),
    ].join(", ")})`);
    fts.push(`(${sqlString(documentKey)}, ${sqlString(tokens)})`);
  });
  const statements = [
    `DELETE FROM qa_group_fts WHERE document_key LIKE ${sqlString(`${syncId}:%`)};`,
    `DELETE FROM qa_group_documents WHERE sync_id = ${sqlString(syncId)};`,
    ...insertStatements("qa_group_documents", [
      "document_key", "sync_id", "kind", "source_date", "position", "occurred_at", "sender", "title",
      "url", "state", "category", "priority", "is_changelog", "excerpt", "content",
    ], documents),
    ...insertStatements("qa_group_fts", ["document_key", "tokens"], fts),
  ];
  const stagedCounts = () => queryD1(QA_DB, `
    SELECT
      (SELECT COUNT(*) FROM qa_group_documents WHERE sync_id = ${sqlString(syncId)}) AS documents,
      (SELECT COUNT(*) FROM qa_group_fts AS f
        JOIN qa_group_documents AS d ON d.document_key = f.document_key
        WHERE d.sync_id = ${sqlString(syncId)}) AS fts_documents;
  `)[0];
  let staged = stagedCounts();
  if (Number(staged?.documents ?? 0) !== allRows.length
    || Number(staged?.fts_documents ?? 0) !== allRows.length) {
    executeSqlFile(QA_DB, `${statements.join("\n")}\n`, "dsh-qa-group-");
    staged = stagedCounts();
  }
  if (Number(staged?.documents ?? 0) !== allRows.length
    || Number(staged?.fts_documents ?? 0) !== allRows.length) {
    throw new Error("QA_DB 群聊暂存或检索索引计数不一致，旧索引保持激活。");
  }

  const syncedAt = new Date().toISOString();
  const latestDate = [...files.keys()].at(-1);
  const previousSyncId = currentMeta.get("active_group_sync_id");
  executeSqlFile(QA_DB, `
    INSERT INTO qa_corpus_meta (key, value, updated_at) VALUES
      ('active_group_sync_id', ${sqlString(syncId)}, CURRENT_TIMESTAMP),
      ('group_message_count', ${sqlString(allRows.length)}, CURRENT_TIMESTAMP),
      ('group_date_count_v2', ${sqlString(files.size)}, CURRENT_TIMESTAMP),
      ('latest_group_date_v2', ${sqlString(latestDate)}, CURRENT_TIMESTAMP),
      ('group_synced_at', ${sqlString(syncedAt)}, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;
  `, "dsh-qa-group-activate-");
  const verified = new Map(queryD1(QA_DB, `
    SELECT key, value FROM qa_corpus_meta
    WHERE key IN ('active_group_sync_id', 'group_message_count');
  `).map((row) => [row.key, row.value]));
  if (verified.get("active_group_sync_id") !== syncId || Number(verified.get("group_message_count")) !== allRows.length) {
    throw new Error("QA_DB 群聊激活校验失败。");
  }
  const keep = [syncId, previousSyncId].filter(Boolean);
  runWrangler(["d1", "execute", QA_DB, d1Target(), "--command", `
    DELETE FROM qa_group_fts WHERE document_key IN (
      SELECT document_key FROM qa_group_documents WHERE sync_id NOT IN (${keep.map(sqlString).join(",")})
    );
    DELETE FROM qa_group_documents WHERE sync_id NOT IN (${keep.map(sqlString).join(",")});
  `, "--yes"]);
  return { syncId, messages: allRows.length, unchanged: false, syncedAt };
}

const requestedDate = argValue("--date");
const backfill = process.argv.includes("--backfill");
if (!backfill && !datePattern.test(requestedDate ?? "")) throw new Error("需要 --date YYYY-MM-DD 或 --backfill。");
const files = availableFiles();
if (!files.size) throw new Error("没有可同步的群聊语料。");
const today = beijingDate();
if (!backfill && requestedDate >= today) {
  throw new Error("只能发布已经结束的北京时间自然日；当前日语料可进入实时 QA，但不能成为页面日档案。");
}
const targetDates = backfill ? [...files.keys()].filter((date) => date < today) : [requestedDate];
if (!targetDates.length) throw new Error("没有已经结束的完整自然日可同步到页面。实时 QA 语料未被覆盖。");
if (backfill) {
  // Natural-day pages are final only after the Beijing calendar day has ended.
  // Keep any staged version for recovery, but never expose a partial current/future day.
  executeSqlFile(CONTENT_DB, `
    DELETE FROM content_active_group_days WHERE date >= ${sqlString(today)};
  `, "dsh-content-finalized-days-");
}
const results = [];
const digestCache = new Map();
for (const date of targetDates) {
  const file = files.get(date);
  if (!file) throw new Error(`${date} 的群聊语料不存在。`);
  const { rows, text } = readRecords(file, date);
  const digest = digestCache.get(date) ?? buildDigest(date, rows);
  digestCache.set(date, digest);
  const priorDate = previousDate(date);
  let priorDigest = null;
  if (files.has(priorDate)) {
    const prior = readRecords(files.get(priorDate), priorDate);
    priorDigest = digestCache.get(priorDate) ?? buildDigest(priorDate, prior.rows);
    digestCache.set(priorDate, priorDigest);
  }
  digest.chronicles = withoutRepeatedChronicles(digest.chronicles, priorDigest?.chronicles);
  results.push(stageGroupDay(date, rows, text, digest, priorDigest));
}
const qa = syncQaGroup(files);
console.log(JSON.stringify({ source: "group-day", dates: results, qa, target: d1Target().slice(2) }));
