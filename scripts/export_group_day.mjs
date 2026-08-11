import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertPrivateContent, projectRoot, sanitizeText } from "./lib/data-sync.mjs";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const input = argValue("--input");
const date = argValue("--date");
const allowEmpty = process.argv.includes("--allow-empty");
if (!input) throw new Error("缺少 --input。");
if (!/^\d{4}-\d{2}-\d{2}$/u.test(date ?? "")) throw new Error("--date 必须是 YYYY-MM-DD。");

const source = JSON.parse(await readFile(path.resolve(input), "utf8"));
if (source?.group !== "【官方】DSH内测群" || !Array.isArray(source.messages)) {
  throw new Error("输入不是【官方】DSH内测群的权威消息集合。");
}

const ids = new Set();
const records = [];
for (const raw of source.messages) {
  const timestamp = String(raw?.timestamp ?? "");
  if (!timestamp.startsWith(`${date}T`)) continue;
  const id = String(raw?.id ?? "");
  const side = String(raw?.side ?? "");
  const sender = raw?.sender ? String(raw.sender) : null;
  if (!id || ids.has(id)) throw new Error("当天消息存在空 ID 或重复 ID。");
  if (!['left', 'right', 'system'].includes(side)) throw new Error(`消息 ${id} 左右归属无效。`);
  if (side === "right" && sender !== "少女阿原") throw new Error(`消息 ${id} 的右侧发送者不正确。`);
  if (side === "left" && (!sender || sender === "少女阿原")) throw new Error(`消息 ${id} 的左侧发送者不正确。`);
  ids.add(id);
  const originalText = String(raw?.text ?? "");
  const text = sanitizeText(originalText);
  records.push({
    sequence: records.length + 1,
    id,
    timestamp,
    sender,
    side,
    messageType: String(raw?.message_type ?? "未知"),
    text,
    redacted: text !== originalText.trim(),
  });
}

const outputDirectory = path.join(projectRoot, ".local", "corpus", "group-chat");
const output = path.join(outputDirectory, `${date}.jsonl`);
if (!records.length) {
  if (!allowEmpty) throw new Error(`${date} 没有群聊消息，拒绝上传空语料。`);
  try {
    await access(output);
    throw new Error(`${date} 已有本地语料但本次权威输入为空，拒绝保留或覆盖不一致数据。`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  console.log(JSON.stringify({ date, messages: 0, redactedMessages: 0, output: null }));
  process.exit(0);
}
records.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
records.forEach((record, index) => { record.sequence = index + 1; });
const content = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
assertPrivateContent(content, `${date} 群聊语料`);

await mkdir(outputDirectory, { recursive: true });
const temporary = path.join(outputDirectory, `.${date}.${process.pid}.tmp`);
await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
await rename(temporary, output);

console.log(JSON.stringify({
  date,
  messages: records.length,
  redactedMessages: records.filter((record) => record.redacted).length,
  output: `.local/corpus/group-chat/${date}.jsonl`,
}));
