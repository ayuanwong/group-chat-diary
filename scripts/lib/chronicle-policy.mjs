import { createHash } from "node:crypto";

const OFFICIAL_PRODUCT_SENDERS = new Set(["Baymax", "崔小天"]);

const OFFICIAL_DSH_SUBJECT = /deepseek\s+harness|dsh(?:2026|-external)|snapshot-\d{8}|changelog\s+\d{4}-\d{2}-\d{2}|内测版代码|github\s+repo.{0,40}(?:新版本|推送)|issues\s+repo/iu;
const STRUCTURED_CHANGELOG = /✨\s*新增[\s\S]*?🐛\s*修复/iu;

function authoredText(value) {
  return String(value ?? "").split("↳ 回复", 1)[0].trim();
}

function changelogDate(value) {
  const evidence = typeof value === "string"
    ? value
    : [value?.title, value?.quote, value?.detail].map((part) => String(part ?? "")).join("\n");
  return evidence.match(/changelog\s+(\d{4}-\d{2}-\d{2})/iu)?.[1] ?? null;
}

function changelogDetail(text, date) {
  const groups = { "新增": [], "修复": [], "调整": [], "优化": [] };
  let section = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^[-*•\s]+/u, "").trim();
    if (!line || /^changelog\s+/iu.test(line)) continue;
    const heading = line.match(/^(?:✨|🐛|⚠️?|🎨)?\s*(新增|修复|调整|优化)\s*[:：]?$/u)?.[1];
    if (heading) {
      section = heading;
    } else if (section && groups[section]) {
      groups[section].push(line);
    }
  }
  const limits = { "新增": 2, "修复": 2, "调整": 1, "优化": 1 };
  const parts = Object.entries(groups).flatMap(([label, lines]) => lines.length
    ? [`${label}：${lines.slice(0, limits[label]).join("；")}`]
    : []);
  return parts.length ? `Changelog ${date}｜${parts.join("；")}。` : `Changelog ${date}｜官方已发布该版本更新。`;
}

function rowChangelogDate(text, timestamp) {
  const explicitDate = changelogDate(text);
  if (explicitDate) return { date: explicitDate, derived: false };
  const sourceDate = String(timestamp ?? "").match(/^(\d{4}-\d{2}-\d{2})T/u)?.[1] ?? null;
  if (!sourceDate || !STRUCTURED_CHANGELOG.test(text)) return null;
  return { date: sourceDate, derived: true };
}

function changelogChronicle(row) {
  const text = authoredText(row?.text);
  const timestamp = String(row.timestamp ?? "");
  const release = rowChangelogDate(text, timestamp);
  if (!release || !OFFICIAL_PRODUCT_SENDERS.has(String(row?.sender ?? "").trim())) return null;
  return {
    message_id: String(row.id ?? ""),
    title: "内测版本更新",
    time: timestamp.slice(0, 16).replace("T", " "),
    timestamp,
    sender: String(row.sender),
    quote: `Changelog ${release.date}`,
    detail: changelogDetail(text, release.date),
    source_ref: `sha256:${createHash("sha256").update(String(row.id ?? "")).digest("hex")}`,
    confidence: "candidate",
    basis: release.derived ? "官方账号结构化更新原话 + 消息自然日" : "官方账号完成态 Changelog 原话",
  };
}

export function isOfficialChronicle(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const sender = String(item.sender ?? "").trim();
  if (!OFFICIAL_PRODUCT_SENDERS.has(sender)) return false;
  const evidence = [item.title, item.quote, item.detail]
    .map((value) => String(value ?? ""))
    .join("\n");
  return OFFICIAL_DSH_SUBJECT.test(evidence);
}

export function officialChronicles(items) {
  return Array.isArray(items) ? items.filter(isOfficialChronicle) : [];
}

export function chronicleReleaseKey(item) {
  const date = changelogDate(item);
  if (date) return `changelog:${date}`;
  const evidence = [item?.title, item?.quote, item?.detail].map((part) => String(part ?? "")).join("\n");
  const snapshot = evidence.match(/snapshot-\d{8}T\d{6}Z-[a-z0-9]+/iu)?.[0]?.toLowerCase();
  return snapshot ? `snapshot:${snapshot}` : null;
}

export function mergeOfficialChronicles(items, records) {
  const merged = new Map();
  for (const item of officialChronicles(items)) {
    const key = chronicleReleaseKey(item) ?? String(item.message_id ?? item.source_ref ?? "");
    if (key) merged.set(key, item);
  }
  for (const row of Array.isArray(records) ? records : []) {
    const item = changelogChronicle(row);
    if (!item) continue;
    const key = chronicleReleaseKey(item) ?? item.message_id;
    const previous = merged.get(key);
    if (!previous || String(item.timestamp) < String(previous.timestamp ?? "")) merged.set(key, item);
  }
  return [...merged.values()].sort((left, right) => String(left.timestamp ?? "").localeCompare(String(right.timestamp ?? "")));
}

export function withoutRepeatedChronicles(items, previousItems) {
  const previousReleases = new Set(officialChronicles(previousItems).map(chronicleReleaseKey).filter(Boolean));
  return officialChronicles(items).filter((item) => {
    const key = chronicleReleaseKey(item);
    return !key || !previousReleases.has(key);
  });
}
