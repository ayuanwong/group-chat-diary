#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { assertPrivateContent, projectRoot, queryD1 } from "./lib/data-sync.mjs";

const REVIEW_PATH = path.join(projectRoot, ".local", "runtime", "member-star-review.json");
const OVERRIDES_PATH = path.join(projectRoot, ".local", "runtime", "member-star-overrides.json");
const OUTPUT_PATH = path.join(projectRoot, "worker", "member-star-representatives.ts");
const EXPECTED_GROUP_MESSAGES = 66_187;

const TOPICS = [
  ["插件与生态", /插件|plugin|skill|mcp|cordis|扩展|生态/iu],
  ["Agent 与任务", /agent|子代理|subagent|goal|任务|计划|执行|并行|委派/iu],
  ["会话与上下文", /session|会话|上下文|context|历史|恢复|resume|archive/iu],
  ["模型与调用", /模型|model|deepseek|v4|gpt|claude|provider|api|token/iu],
  ["Issue 与协作", /issue|\bpr\b|pull request|仓库|repo|github|反馈|协作|合并/iu],
  ["Web UI", /web\s*ui|webui|网页|网站|浏览器|前端|页面|按钮|侧栏|交互/iu],
  ["性能稳定性", /性能|内存|cpu|卡顿|卡死|崩溃|超时|慢|稳定|中断|失败/iu],
  ["权限与环境", /权限|sandbox|沙箱|安全|macos|windows|linux|wsl|docker|环境/iu],
  ["文件与产物", /文件|路径|markdown|html|代码|产物|预览|目录|workspace|工作区/iu],
  ["数据与记忆", /数据|记忆|memory|存储|数据库|缓存|同步|采集|检索/iu],
  ["CLI / TUI", /\bcli\b|\btui\b|终端|命令行|shell|bash|zsh|powershell/iu],
  ["产品体验", /产品|功能|体验|需求|建议|设计|流程/iu],
];

const GENERIC = /^(?:收到|好的?|嗯+|哦+|ok|okay|哈哈+|hhh+|谢谢|感谢|辛苦了?|已提交|已填写|附议|同意|确实|是的|对的?|行|可以|牛|nb|666|\+1|1|[.。!！?？~～]+)$/iu;
const LOW_CONTEXT = /^(?:这个|那个|然后|所以|但是|不过|而且|其实|感觉|好像|确实|可能|应该是|是不是|有没有|怎么|为什么|请问)/u;
const BUILD = /我(?:做|写|改|测|试|实现|加|发布|开源|整理|修|跑|接|用|设计)|做了|写了|实现|完成|发布|上线|开源|修复|修好|重构|新增|支持|接入|提供|整理|贡献|提交了?\s*(?:pr|issue)/iu;
const EVIDENCE = /实测|测试|复现|发现|验证|对比|日志|结果|原因|因为|所以|性能|数据|步骤|表现为|问题在|本质|核心|关键/iu;
const JUDGMENT = /我觉得|我认为|建议|应该|需要|最好|不应该|不能|只能|可以考虑|更适合|优先|取舍|方案|思路|设计/iu;
const TECHNICAL = /`[^`]+`|\b[A-Za-z][A-Za-z0-9_.\/-]{2,}\b|\b\d+(?:\.\d+)?(?:ms|s|mb|gb|%|个|次|条)?\b|[#/@][A-Za-z0-9_-]+/iu;
const QUESTION_START = /^(?:请问|问下|有人|有没有|是不是|为什么|怎么|如何|能不能|可不可以|是否|啥时候|哪里)/u;
const LOGISTICS = /入群|群二维码|邀请码|邀请邮件|额度|充值|表单|已提交|收到邀请|拉我|加我|签到|吃饭|睡觉/iu;
const BOT_LOG = /公共仓库监测|事件:\s*public repo|当前 public repo|新增:\s*-|删除:\s*-/iu;
const REDACTION_ONLY = /^(?:\[(?:图片|表情|视频|语音|文件|链接\/文件|系统|撤回|微信引用内容已隐去|本机路径已隐去)\]|\[链接\])+$/u;
const PLACEHOLDER_OR_REACTION = /^(?:\[[^\]]+\](?:\s*\([^)]*\))?\s*)+$/u;
const CHAIN_LIST = /#接龙|OMDSH|(?:^|\s)\d+[.)、]\s*[^\s]+(?:\s+\d+[.)、]\s*[^\s]+){2,}/iu;
const EXCLUDED_CARD_SENDERS = new Set(["【内测】DSH官方内测群", "【官方】DSH内测群"]);

function compact(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/<\?xml[^>]*\?>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/```[\s\S]*?```/gu, "[代码片段]")
    .replace(/https?:\/\/\S+/giu, "[链接]")
    .replace(/(?:\s*\[链接\]){2,}/gu, " [链接]")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function authored(value) {
  return compact(String(value ?? "").split("↳ 回复", 1)[0])
    .replace(/^\s*@[^\s，,：:]+[，,：:]?\s*/u, "")
    .trim();
}

function characters(value) {
  return Array.from(value);
}

function normalizedKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 220);
}

function candidateKey(row, excerpt) {
  return createHash("sha256").update(`${row.document_key}\n${excerpt}`).digest("hex").slice(0, 16);
}

function cleanSegment(value) {
  return compact(value)
    .replace(/^\s*(?:[-*•·]|\d+[.)、])\s*/u, "")
    .replace(/^\s*(?:✨\s*新增|🐛\s*修复|🎨\s*优化|⚠️\s*调整)\s*[:：]?\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[，,。；;：:]+|[，,；;：:]+$/gu, "");
}

function sentenceCandidates(value) {
  const text = authored(value);
  if (!text) return [];
  const raw = [];
  if (characters(text).length <= 190) raw.push(text);
  for (const line of text.split(/\n+/u)) {
    const cleaned = cleanSegment(line);
    if (cleaned) raw.push(cleaned);
    const sentences = cleaned.match(/[^。！？!?；;]+[。！？!?；;]?/gu) ?? [];
    raw.push(...sentences.map(cleanSegment));
    if (characters(cleaned).length > 190) {
      const clauses = cleaned.split(/(?<=[，,：:])\s*/u).map(cleanSegment).filter(Boolean);
      raw.push(...clauses);
      for (let index = 0; index + 1 < clauses.length; index += 1) {
        const pair = `${clauses[index]}${clauses[index + 1]}`;
        if (characters(pair).length <= 170) raw.push(pair);
      }
    }
  }
  const seen = new Set();
  return raw.filter((item) => {
    const length = characters(item).length;
    const key = normalizedKey(item);
    if (!key || seen.has(key) || length < 2 || length > 220) return false;
    seen.add(key);
    return true;
  });
}

function topicFor(text, traits = []) {
  const matchedTrait = traits.find((trait) => TOPICS.some(([topic]) => topic === trait)
    && TOPICS.find(([topic]) => topic === trait)?.[1].test(text));
  if (matchedTrait) return matchedTrait;
  return TOPICS.find(([, pattern]) => pattern.test(text))?.[0]
    ?? traits.find((trait) => TOPICS.some(([topic]) => topic === trait))
    ?? "群内讨论";
}

function categoryFor(text) {
  if (BUILD.test(text)) return "成果与实践";
  if (/bug|报错|失败|崩溃|卡死|丢失|不生效|无法|复现|定位/iu.test(text)) return "问题定位";
  if (EVIDENCE.test(text)) return "实测与判断";
  if (JUDGMENT.test(text)) return "方案与建议";
  if (/[?？]/u.test(text)) return "关键追问";
  return "观点表达";
}

function scoreCandidate(text, traits, globalFrequency) {
  const length = characters(text).length;
  const substantive = text.replace(/[^\p{L}\p{N}]/gu, "").length;
  let score = 0;
  const reasons = [];
  if (length >= 24 && length <= 125) {
    score += 20;
    reasons.push("完整且适合卡片");
  } else if (length >= 15 && length <= 180) {
    score += 13;
  } else if (length >= 10) {
    score += 5;
  }
  if (substantive >= 20) score += 6;
  if (BUILD.test(text)) {
    score += 20;
    reasons.push("包含实际产出");
  }
  if (EVIDENCE.test(text)) {
    score += 13;
    reasons.push("包含事实或推理");
  }
  if (JUDGMENT.test(text)) {
    score += 10;
    reasons.push("包含明确判断");
  }
  if (TECHNICAL.test(text)) score += 7;
  const topic = topicFor(text, traits);
  if (traits.includes(topic)) {
    score += 12;
    reasons.push("贴合长期关注");
  } else if (topic !== "群内讨论") score += 5;
  if (/我|我们/u.test(text)) score += 4;
  if (/因为|所以|但|而是|意味着|这样|从而|避免|导致/u.test(text)) score += 5;
  if (/[?？]\s*$/u.test(text)) score -= 18;
  if (QUESTION_START.test(text)) score -= 12;
  if (LOW_CONTEXT.test(text)) score -= 4;
  if (LOGISTICS.test(text)) score -= 18;
  if (BOT_LOG.test(text)) score -= 35;
  if (CHAIN_LIST.test(text)) score -= 100;
  if (GENERIC.test(text) || REDACTION_ONLY.test(text) || PLACEHOLDER_OR_REACTION.test(text)) score -= 100;
  if ((text.match(/\[链接\]/gu) ?? []).length && substantive < 18) score -= 18;
  if (globalFrequency > 1) score -= Math.min(30, (globalFrequency - 1) * 6);
  if (length > 170) score -= 7;
  return { score, reasons, topic, category: categoryFor(text) };
}

function displayTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value ?? "").slice(0, 16).replace("T", " ");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function loadMembers() {
  const rows = queryD1("CONTENT_DB", `
    WITH archived AS (
      SELECT v.date, v.payload
      FROM content_active_group_days AS a
      JOIN content_group_versions AS v ON v.date = a.date AND v.ingest_id = a.ingest_id
    ), latest AS (SELECT MAX(date) AS date FROM archived), live AS (
      SELECT v.date, v.payload
      FROM content_active_live_group AS a
      JOIN content_group_versions AS v ON v.date = a.date AND v.ingest_id = a.ingest_id
      WHERE a.scope = 'chronicle' AND v.date > (SELECT date FROM latest)
    ), payloads AS (SELECT * FROM archived UNION ALL SELECT * FROM live)
    SELECT p.date, m.value AS member
    FROM payloads AS p JOIN json_each(p.payload, '$.group.members') AS m
    ORDER BY p.date;
  `);
  const members = new Map();
  for (const row of rows) {
    const value = JSON.parse(row.member);
    const name = String(value?.name ?? "").trim();
    if (!name || EXCLUDED_CARD_SENDERS.has(name)) continue;
    const current = members.get(name) ?? { name, messages: 0, activeDays: 0, traits: new Map() };
    const count = Number(value.count ?? 0);
    current.messages += count;
    current.activeDays += 1;
    for (const trait of Array.isArray(value.traits) ? value.traits : []) {
      const label = String(trait ?? "").trim();
      if (label) current.traits.set(label, (current.traits.get(label) ?? 0) + Math.max(1, count));
    }
    members.set(name, current);
  }
  return new Map([...members].map(([name, member]) => [name, {
    name,
    messages: member.messages,
    activeDays: member.activeDays,
    traits: [...member.traits].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh")).slice(0, 3).map(([trait]) => trait),
  }]));
}

function loadGroupRows(memberNames) {
  const meta = queryD1("QA_DB", `
    SELECT key, value FROM qa_corpus_meta
    WHERE key IN ('active_group_sync_id', 'group_message_count', 'latest_group_date_v2');
  `);
  const values = new Map(meta.map((row) => [row.key, row.value]));
  if (Number(values.get("group_message_count")) !== EXPECTED_GROUP_MESSAGES) {
    throw new Error(`固定群聊总数不是 ${EXPECTED_GROUP_MESSAGES}，拒绝生成星卡。`);
  }
  const rows = queryD1("QA_DB", `
    SELECT document_key, source_date, occurred_at, sender, content
    FROM qa_group_documents
    WHERE sync_id = (SELECT value FROM qa_corpus_meta WHERE key = 'active_group_sync_id' LIMIT 1)
      AND sender IS NOT NULL AND trim(sender) <> ''
    ORDER BY occurred_at, position;
  `).filter((row) => memberNames.has(String(row.sender ?? "").trim()));
  return {
    syncId: String(values.get("active_group_sync_id") ?? ""),
    latestDate: String(values.get("latest_group_date_v2") ?? ""),
    rows,
  };
}

function loadOverrides() {
  if (!existsSync(OVERRIDES_PATH)) return {};
  const value = JSON.parse(readFileSync(OVERRIDES_PATH, "utf8"));
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function typescriptModule(metadata, selected) {
  const mapping = Object.fromEntries([...selected].sort(([left], [right]) => left.localeCompare(right, "zh")));
  return `// Generated once from the frozen, redacted QA group corpus. Do not refresh from live sources.\n`
    + `export const FROZEN_STAR_CARD_SOURCE = ${JSON.stringify(metadata, null, 2)} as const;\n\n`
    + `export const FROZEN_MEMBER_REPRESENTATIVES = ${JSON.stringify(mapping, null, 2)} as const;\n`;
}

mkdirSync(path.dirname(REVIEW_PATH), { recursive: true });
const members = loadMembers();
const group = loadGroupRows(new Set(members.keys()));
const rowsByMember = new Map([...members.keys()].map((name) => [name, []]));
const segmentFrequency = new Map();
for (const row of group.rows) {
  const name = String(row.sender ?? "").trim();
  const segments = sentenceCandidates(row.content);
  rowsByMember.get(name)?.push({ row, segments });
  for (const segment of segments) {
    const key = normalizedKey(segment);
    if (key) segmentFrequency.set(key, (segmentFrequency.get(key) ?? 0) + 1);
  }
}

const overrides = loadOverrides();
const reviewMembers = [];
const selected = new Map();
for (const member of members.values()) {
  const candidates = [];
  for (const entry of rowsByMember.get(member.name) ?? []) {
    for (const excerpt of entry.segments) {
      const key = normalizedKey(excerpt);
      const scored = scoreCandidate(excerpt, member.traits, segmentFrequency.get(key) ?? 1);
      candidates.push({
        key: candidateKey(entry.row, excerpt),
        excerpt,
        time: displayTime(entry.row.occurred_at),
        sourceDate: entry.row.source_date,
        score: scored.score,
        topic: scored.topic,
        category: scored.category,
        reasons: scored.reasons,
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score
    || Math.abs(characters(left.excerpt).length - 82) - Math.abs(characters(right.excerpt).length - 82)
    || right.time.localeCompare(left.time)
    || left.key.localeCompare(right.key));
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = normalizedKey(candidate.excerpt);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
    if (unique.length >= 8) break;
  }
  if (!unique.length) {
    unique.push({
      key: `no-text-${createHash("sha256").update(member.name).digest("hex").slice(0, 8)}`,
      excerpt: "固定语料中没有可独立引用的完整文本发言。",
      time: "--",
      sourceDate: group.latestDate,
      score: 0,
      topic: "样本有限",
      category: "样本说明",
      reasons: ["仅有非文本互动"],
    });
  }
  if (unique[0].category !== "样本说明") {
    const sampleNote = {
      key: `no-valuable-text-${createHash("sha256").update(member.name).digest("hex").slice(0, 8)}`,
      excerpt: "固定语料中没有足够完整、可独立引用的文本发言。",
      time: "--",
      sourceDate: group.latestDate,
      score: 0,
      topic: "样本有限",
      category: "样本说明",
      reasons: ["仅有表情、媒体、接龙或低信息回复"],
    };
    if (unique[0].score < -40) unique.unshift(sampleNote);
    else unique.push(sampleNote);
  }
  const overrideKey = String(overrides[member.name] ?? "");
  const chosen = unique.find((candidate) => candidate.key === overrideKey) ?? unique[0];
  assertPrivateContent(chosen.excerpt, `${member.name} 星卡代表句`);
  selected.set(member.name, {
    headline: `${chosen.topic} · ${chosen.category}`,
    excerpt: chosen.excerpt,
    category: chosen.category,
    time: chosen.time,
  });
  reviewMembers.push({
    name: member.name,
    messages: member.messages,
    activeDays: member.activeDays,
    traits: member.traits,
    candidateCount: candidates.length,
    selectedKey: chosen.key,
    selectedRank: unique.findIndex((candidate) => candidate.key === chosen.key) + 1,
    candidates: unique.map((candidate, index) => ({ rank: index + 1, ...candidate })),
  });
}

if (selected.size !== members.size) throw new Error("星卡代表句覆盖率不是 100%。");
const selectedCandidates = reviewMembers.map((member) => member.candidates[member.selectedRank - 1]);
const metadata = {
  version: 2,
  policy: "frozen-full-corpus-individual-review",
  sourceMessageCount: EXPECTED_GROUP_MESSAGES,
  latestGroupDate: group.latestDate,
  memberCount: members.size,
  reviewedMemberCount: Object.keys(overrides).length,
  candidateSentenceCount: reviewMembers.reduce((sum, member) => sum + member.candidateCount, 0),
  representativeCount: selectedCandidates.filter((candidate) => candidate.category !== "样本说明").length,
  sampleNoteCount: selectedCandidates.filter((candidate) => candidate.category === "样本说明").length,
};
writeFileSync(REVIEW_PATH, `${JSON.stringify({
  metadata: { ...metadata, sourceGroupSyncId: group.syncId },
  members: reviewMembers,
}, null, 2)}\n`, { mode: 0o600 });
writeFileSync(OUTPUT_PATH, typescriptModule(metadata, selected), "utf8");

console.log(JSON.stringify({
  generated: true,
  members: members.size,
  coverage: selected.size,
  sourceMessages: EXPECTED_GROUP_MESSAGES,
  candidateSentences: reviewMembers.reduce((sum, member) => sum + member.candidateCount, 0),
  manualOverrides: Object.keys(overrides).length,
  selectedBelow30: selectedCandidates.filter((candidate) => candidate.score < 30).length,
  selectedQuestions: selectedCandidates.filter((candidate) => /[?？]\s*$/u.test(candidate.excerpt)).length,
  noTextMembers: selectedCandidates.filter((candidate) => candidate.category === "样本说明").length,
  output: "worker/member-star-representatives.ts",
  review: ".local/runtime/member-star-review.json",
}));
