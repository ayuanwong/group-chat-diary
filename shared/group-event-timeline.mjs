const OFFICIAL_SENDERS = new Set(["Baymax", "崔小天", "少女阿原"]);

const ENTITY_RULES = [
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", pattern: /(?:deepseek[-_\s]*)?v\s*4[-_\s]*pro|\bv4pro\b/iu, specific: true },
  { id: "claude-opus", label: "Claude Opus", pattern: /claude.{0,10}opus|opus[-_\s]*\d(?:\.\d)?/iu, specific: true },
  { id: "claude-sonnet", label: "Claude Sonnet", pattern: /claude.{0,10}sonnet|sonnet[-_\s]*\d(?:\.\d)?/iu, specific: true },
  { id: "gpt", label: "GPT", pattern: /\bgpt[-_\s]*\d(?:\.\d+)?/iu, specific: true },
  { id: "dsh-desktop", label: "DSH Desktop", pattern: /deepseek-harness-desktop|dsh.{0,12}desktop|desktop.{0,12}dsh/iu },
  { id: "dsh-web-ui", label: "DSH Web UI", pattern: /dsh-web-ui|dsh.{0,12}web\s*ui|web\s*ui.{0,12}dsh/iu },
  { id: "tui", label: "DSH TUI", pattern: /dsh.{0,12}\btui\b|\btui\b.{0,12}dsh/iu },
  { id: "mcp", label: "MCP", pattern: /\bmcp\b|model context protocol/iu },
];

const RELEASE = /发布|发版|上线|推出|开放|推送|更新版本|新版本|release(?:d)?|正式版|production|现已|可(?:调用|使用)|接口.{0,12}(?:开放|可用)|api.{0,12}(?:开放|可用)/iu;
const TESTING = /试用|体验|测试|实测|评测|benchmark|效果|能力|速度|延迟|调用|api|token|推理|代码能力|coding/iu;
const INCIDENT = /bug|报错|失败|崩溃|闪退|卡死|卡顿|超时|无法|不能用|不工作|故障|内存.{0,8}(?:爆|高)/iu;
const FIXED = /修复|修好|解决|恢复|可用|正常运行|不再复现/iu;
const PLAN = /计划|预计|将于|准备|接下来|后续|定于|暂定|今夜|今晚|明天|明日|次日|翌日/iu;
const FINAL_RELEASE = /(?:最后|最终|收官).{0,28}(?:内测|版本|发版|发布)|(?:内测|版本|发版|发布).{0,28}(?:最后|最终|收官)/iu;
const PUBLIC_RELEASE = /公测|公开|对外|正式.{0,16}(?:发布|上线|开放)|(?:发布|上线|开放).{0,16}正式/iu;
const DSH_SUBJECT = /deepseek\s+harness|dsh(?:2026|-external)?/iu;
const QUESTION_OR_UNCERTAIN = /[?？]|为什么|怎么|如何|能否|是否|是不是|有没有|听说|据说|貌似|猜测|可能|也许|好像|感觉/iu;
const DISCUSSION_TERMS = [
  ["API 调用", /api|接口|调用|token/iu],
  ["能力与评测", /能力|评测|benchmark|测试集|coding|代码能力/iu],
  ["实际体验", /试用|体验|实测|效果|好用|难用/iu],
  ["速度与稳定性", /速度|延迟|慢|快|稳定|报错|失败/iu],
  ["与 DSH 的适配", /dsh|harness|插件|plugin|适配/iu],
];

function oneLine(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function authoredText(value) {
  return String(value ?? "").split("↳ 回复", 1)[0].trim();
}

function sanitizeEvidence(value, limit = 180) {
  let text = authoredText(value);
  if (/^\s*<\?xml|<msg\b|bigheadimgurl=|smallheadimgurl=|antispamticket=/iu.test(text)) {
    return "[微信消息元数据已脱敏]";
  }
  text = text
    .replace(/```[\s\S]*?```/gu, "[代码片段]")
    .replace(/https?:\/\/\S+/giu, "[链接]")
    .replace(/(?<![\w:])(?:\/Users\/[^\s<>"'，。；)）]+|[A-Za-z]:\\Users\\[^\s<>"'，。；)）]+)/giu, "[本机路径]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}/giu, "Bearer [凭据已脱敏]")
    .replace(/((?:密码|口令|密钥|password|secret|api[_ -]?key|access[_ -]?token)\s*(?:是|为|[:：=])?\s*)([^\s，。；]{4,})/giu, "$1[凭据已脱敏]");
  const compact = oneLine(text);
  return Array.from(compact).length > limit
    ? `${Array.from(compact).slice(0, limit - 1).join("")}…`
    : compact;
}

function stableId(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function parsedTime(value) {
  const timestamp = String(value ?? "");
  const match = timestamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/u);
  if (!match) return null;
  const epoch = Date.parse(timestamp);
  if (!Number.isFinite(epoch)) return null;
  return {
    timestamp,
    date: match[1],
    clock: `${match[2]}:${match[3]}`,
    epoch,
  };
}

function normalizeRecord(row, index) {
  const time = parsedTime(row?.timestamp ?? row?.occurred_at);
  const sender = oneLine(row?.sender);
  const text = String(row?.text ?? row?.content ?? "");
  if (!time || !sender || !text || row?.side === "system") return null;
  return {
    id: String(row?.id ?? row?.message_id ?? row?.document_key ?? `${time.timestamp}:${index}`),
    sender,
    text,
    authored: authoredText(text),
    time,
  };
}

function entityMatches(text) {
  const matches = ENTITY_RULES.filter((rule) => rule.pattern.test(text));
  return matches.some((rule) => rule.specific) ? matches.filter((rule) => rule.specific) : matches;
}

function cueForEntity(record, entity, cue) {
  const text = record.authored;
  if (!cue.test(text)) return false;
  if (cue === RELEASE && QUESTION_OR_UNCERTAIN.test(text)) return false;
  if (!entity.specific || text.length <= 220) return true;
  const clauses = text.split(/[。！？!?；;\n]+/u).filter(Boolean);
  if (clauses.some((clause) => entity.pattern.test(clause) && cue.test(clause))) return true;
  const entityIndex = text.search(entity.pattern);
  const cueIndex = text.search(cue);
  return entityIndex >= 0 && cueIndex >= 0 && Math.abs(entityIndex - cueIndex) <= 72;
}

function splitEpisodes(records, gapMinutes = 75) {
  const episodes = [];
  for (const record of records) {
    const current = episodes.at(-1);
    if (!current || record.time.epoch - current.at(-1).time.epoch > gapMinutes * 60_000) episodes.push([record]);
    else current.push(record);
  }
  return episodes;
}

function quotedEvidence(records, maximum = 3) {
  const ranked = [...records].sort((left, right) => {
    const score = (record) => Number(RELEASE.test(record.authored)) * 8
      + Number(TESTING.test(record.authored)) * 4
      + Number(INCIDENT.test(record.authored)) * 3
      + Math.min(3, Math.floor(record.authored.length / 32));
    return score(right) - score(left) || left.time.timestamp.localeCompare(right.time.timestamp);
  });
  const result = [];
  const senders = new Set();
  const evidence = new Set();
  for (const record of ranked) {
    if (result.length >= maximum) break;
    const quote = sanitizeEvidence(record.authored);
    const key = quote.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 120);
    if (!quote || quote.length < 8 || senders.has(record.sender) || evidence.has(key)) continue;
    result.push({ sender: record.sender, time: record.time.clock, quote });
    senders.add(record.sender);
    evidence.add(key);
  }
  return result;
}

function discussionFocus(records) {
  const ranked = DISCUSSION_TERMS.map(([label, pattern], index) => ({
    label,
    index,
    count: records.filter((record) => pattern.test(record.text)).length,
  })).filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.index - right.index);
  return ranked.slice(0, 3).map((item) => item.label);
}

function communityEvent(entity, episode, date) {
  const speakers = new Set(episode.map((record) => record.sender));
  const releases = episode.filter((record) => cueForEntity(record, entity, RELEASE));
  const tests = episode.filter((record) => cueForEntity(record, entity, TESTING));
  const incidents = episode.filter((record) => cueForEntity(record, entity, INCIDENT));
  const releaseReady = releases.length >= 1 && episode.length >= 3 && speakers.size >= 3;
  const incidentReady = incidents.length >= 2 && episode.length >= 4 && speakers.size >= 3;
  const testingReady = tests.length >= 2 && episode.length >= 5 && speakers.size >= 4;
  if (!releaseReady && !incidentReady && !testingReady) return null;

  const primary = releaseReady ? "release" : incidentReady ? "incident" : "testing";
  const anchor = (primary === "release" ? releases : primary === "incident" ? incidents : tests)[0] ?? episode[0];
  const end = episode.at(-1);
  const focus = discussionFocus(episode);
  const focusText = focus.length ? focus.join("、") : "实际使用体验";
  const action = primary === "release"
    ? "出现已发布或可调用的明确信息"
    : primary === "incident"
      ? "出现集中问题反馈和复现线索"
      : "出现连续实测与体验反馈";
  const title = primary === "release"
    ? `${entity.label} 发布并引发群内讨论`
    : primary === "incident"
      ? `${entity.label} 问题进入集中复现`
      : `${entity.label} 进入集中试用与评测`;
  const summary = `${anchor.time.clock}，群内关于 ${entity.label} ${action}；随后讨论集中到${focusText}。`
    + `当天共有 ${episode.length} 条消息直接提及该对象，来自 ${speakers.size} 位成员。`;
  const milestones = [{ time: anchor.time.clock, label: primary === "release" ? "发布信息出现" : primary === "incident" ? "问题集中出现" : "实测开始集中", detail: action }];
  if (end.time.clock !== anchor.time.clock && speakers.size > 1) {
    milestones.push({ time: end.time.clock, label: "讨论持续推进", detail: `相关发言扩展到${focusText}` });
  }
  return {
    id: `group-event:${date}:${entity.id}:${stableId(`${anchor.id}:${end.id}`)}`,
    date,
    timestamp: anchor.time.timestamp,
    endTimestamp: end.time.timestamp,
    timeRange: anchor.time.clock === end.time.clock ? `${date} · ${anchor.time.clock}` : `${date} · ${anchor.time.clock}–${end.time.clock}`,
    eventType: primary,
    status: "observed",
    title,
    summary,
    relatedMessageCount: episode.length,
    speakerCount: speakers.size,
    topics: [entity.label, ...focus].slice(0, 4),
    milestones,
    quotes: quotedEvidence(primary === "release" ? [...releases, ...tests, ...episode] : episode),
    evidenceBoundary: "完整当日群聊中的直接相关发言",
    score: (releaseReady ? 40 : incidentReady ? 28 : 20) + episode.length + speakers.size * 2,
  };
}

function explicitCalendarDate(text, sourceDate) {
  const compact = oneLine(text);
  const iso = compact.match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|号)?\b/u);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;
  const monthDay = compact.match(/(?:^|[^\d])(?:0?(\d{1,2}))[月./-](0?(\d{1,2}))(?:日|号)?(?:[^\d]|$)/u);
  if (monthDay) return `${sourceDate.slice(0, 4)}-${String(Number(monthDay[1])).padStart(2, "0")}-${String(Number(monthDay[2])).padStart(2, "0")}`;
  const compressed = compact.match(/(?:^|[^\d])(0[1-9]|1[0-2])([0-2]\d|3[01])(?:[^\d]|$)/u);
  if (compressed) return `${sourceDate.slice(0, 4)}-${compressed[1]}-${compressed[2]}`;
  if (/明天|明日|次日|翌日/u.test(compact)) {
    const date = new Date(`${sourceDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }
  return null;
}

function relatedOfficialRecords(item, records) {
  const timestamp = parsedTime(item?.timestamp ?? item?.time);
  if (!timestamp) return [];
  const evidence = [item?.quote, item?.detail].join(" ");
  const dshRelease = DSH_SUBJECT.test(evidence) && (FINAL_RELEASE.test(evidence) || PUBLIC_RELEASE.test(evidence));
  return records.filter((record) => {
    const distance = record.time.epoch - timestamp.epoch;
    if (distance < -5 * 60_000 || distance > 12 * 60_000) return false;
    if (dshRelease) return DSH_SUBJECT.test(record.text) || FINAL_RELEASE.test(record.text)
      || PUBLIC_RELEASE.test(record.text) || /#dsh|插件.{0,16}兼容|0813/iu.test(record.text);
    return OFFICIAL_SENDERS.has(record.sender) || RELEASE.test(record.text) || PLAN.test(record.text);
  });
}

function officialEvent(item, records, date, index) {
  const time = parsedTime(item?.timestamp ?? String(item?.time ?? "").replace(" ", "T"));
  if (!time || time.date !== date) return null;
  const evidence = oneLine([item?.quote, item?.detail].filter(Boolean).join(" "));
  const officialText = oneLine(item?.quote ?? item?.detail);
  const status = oneLine(item?.status) || "announced";
  const finalRelease = DSH_SUBJECT.test(evidence) && FINAL_RELEASE.test(evidence);
  const publicRelease = DSH_SUBJECT.test(evidence) && PUBLIC_RELEASE.test(evidence)
    && (PUBLIC_RELEASE.test(officialText) || /\b(?:0[1-9]|1[0-2])[0-3]\d\b.{0,24}(?:计划|发布|公测)/iu.test(evidence));
  const releaseDate = explicitCalendarDate(evidence, date);
  const related = relatedOfficialRecords(item, records);
  const relatedMessages = related.length || 1;
  const relatedSpeakers = new Set(related.map((record) => record.sender));
  const quote = sanitizeEvidence(item?.quote ?? item?.detail, 220);
  const normalizedTitle = oneLine(item?.title);
  const subject = evidence.match(/deepseek\s+harness|dsh(?:2026|-external)?/iu)?.[0]
    ?? evidence.match(/deepseek[-_\s]*v\s*4[-_\s]*pro|\bv4pro\b/iu)?.[0]
    ?? "DSH";
  let title = oneLine(item?.title) || "官方信息发布";
  let summary = status === "completed" ? `官方确认已经完成：${quote}`
    : status === "planned" ? `官方明确了后续安排：${quote}`
      : `官方发布了有效信息：${quote}`;
  let topics = [status === "planned" ? "官方计划" : status === "completed" ? "已完成发布" : "官方公告"];
  let milestones = [{ time: time.clock, label: status === "planned" ? "官方安排明确" : status === "completed" ? "官方确认完成" : "官方信息发布", detail: quote }];

  if (normalizedTitle === "版本与产品发布") {
    title = `${subject} 版本发布`;
  } else if (normalizedTitle === "官方计划与安排") {
    title = `${subject} 后续安排明确`;
  } else if (normalizedTitle === "仓库与工具发布") {
    title = `${subject} 仓库或工具发布`;
  }

  if (finalRelease && publicRelease) {
    title = "DSH 最后一个内测版本与公测排期确定";
    const datePhrase = releaseDate ?? "后续日期";
    summary = `官方明确：今夜推送 DSH 最后一个内测版本；${datePhrase} 计划发布 DSH 公测版。`
      + "插件需完成兼容并为仓库添加 #dsh topic，公测后可迁移至个人账号公开。";
    topics = ["DSH 发布", "内测收官", "公测计划"];
    milestones = [
      { time: time.clock, label: "最后一个内测版本确定", detail: "今夜晚些时候推送，插件进入最终兼容阶段" },
      { time: releaseDate ?? "后续", label: "公测发布节点明确", detail: "DSH 公测版计划对外发布" },
    ];
  }
  if (relatedMessages >= 3 && relatedSpeakers.size >= 2) {
    summary += ` 这项信息随后在群内被集中转发和讨论，相关时间段有 ${relatedMessages} 条直接相关消息，来自 ${relatedSpeakers.size} 位成员。`;
  }
  return {
    id: `group-event:${date}:official:${stableId(item?.event_key ?? item?.message_id ?? `${time.timestamp}:${index}`)}`,
    date,
    timestamp: time.timestamp,
    endTimestamp: related.at(-1)?.time.timestamp ?? time.timestamp,
    timeRange: `${date} · ${time.clock}`,
    eventType: oneLine(item?.event_type) || (status === "planned" ? "plan" : "announcement"),
    status,
    title,
    summary,
    relatedMessageCount: relatedMessages,
    speakerCount: Math.max(1, relatedSpeakers.size),
    topics,
    milestones,
    quotes: quote ? [{ sender: oneLine(item?.sender) || "官方", time: time.clock, quote }] : [],
    evidenceBoundary: "官方信息原话及其相邻群聊响应",
    score: 100 + relatedMessages + relatedSpeakers.size * 2,
  };
}

function eventSort(left, right) {
  return left.timestamp.localeCompare(right.timestamp) || left.title.localeCompare(right.title, "zh");
}

export function buildGroupEventTimeline(rows, { officialChronicles = [], date = null, maximum = 8 } = {}) {
  const records = (Array.isArray(rows) ? rows : []).map(normalizeRecord).filter(Boolean)
    .sort((left, right) => left.time.timestamp.localeCompare(right.time.timestamp) || left.id.localeCompare(right.id));
  const sourceDate = date ?? records[0]?.time.date ?? null;
  if (!sourceDate) return [];
  const events = (Array.isArray(officialChronicles) ? officialChronicles : [])
    .map((item, index) => officialEvent(item, records, sourceDate, index)).filter(Boolean);

  for (const entity of ENTITY_RULES) {
    const direct = records.filter((record) => record.time.date === sourceDate && entity.pattern.test(record.text));
    for (const episode of splitEpisodes(direct)) {
      const event = communityEvent(entity, episode, sourceDate);
      if (!event) continue;
      const overlapsOfficial = events.some((official) => {
        const distance = Math.abs(Date.parse(official.timestamp) - Date.parse(event.timestamp));
        return distance <= 25 * 60_000 && (official.title.includes(entity.label) || official.topics.some((topic) => topic.includes(entity.label)));
      });
      if (!overlapsOfficial) events.push(event);
    }
  }

  const official = events.filter((event) => event.score >= 100);
  const community = events.filter((event) => event.score < 100)
    .sort((left, right) => right.score - left.score || eventSort(left, right))
    .slice(0, Math.max(0, maximum - official.length));
  return [...official, ...community].sort(eventSort).map(({ score, ...event }) => event);
}

export { sanitizeEvidence };
