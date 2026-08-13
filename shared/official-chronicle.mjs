const DIRECT_OFFICIAL_SENDERS = new Set(["Baymax", "崔小天"]);
const CURATOR_SENDER = "少女阿原";

const DSH_SUBJECT = /deepseek\s+harness|(?:^|[^\p{L}\p{N}])dsh(?:2026|-external)?(?:$|[^\p{L}\p{N}])|内测版(?:代码)?|github\.com\/dsh-external\/|【官方】\s*dsh/iu;
const OFFICIAL_REPOSITORY = /https?:\/\/github\.com\/dsh-external\//iu;
const EXPLICIT_CHANGELOG = /(?:deepseek\s+harness\s+)?changelog\s+(\d{4}-\d{2}-\d{2})/iu;
const STRUCTURED_CHANGELOG = /✨\s*新增[\s\S]*?🐛\s*修复/iu;
const BROADCAST_MARKER = /@所有人|本群所有成员|群公告|(?:^|[\n【[])(?:重要)?(?:公告|通知|须知|说明|提醒)|反馈入口|访问权限/iu;
const FORMAL_LEAD = /^(?:@[\p{L}\p{N}_-]+\s*)?(?:📢|🎉|🚀|✨|【|\[)?\s*(?:deepseek\s+harness|dsh|公告|通知|发布|上线|更新|版本|内测|重要)/iu;
const OFFICIAL_ACTION = /发布|上线|部署|推送|开放|开源|更新|升级|推出|新增|修复|优化|调整|合并|同步|启用|停用|恢复|迁移|邀请|开始|截止/iu;
const OFFICIAL_INFORMATION_NOUN = /公告|通知|说明|规则|须知|安排|计划|版本|tag|入口|名单|活动|招募|征集|投票|维护|访问权限/iu;
const COMPLETED_ACTION = /(?:已(?:经)?|现已|刚刚|成功|正式)\s*[^，。！？!?；;\n]{0,18}(?:完成|发布|上线|部署|推送|开放|开源|更新|升级|推出|新增|修复|优化|调整|合并|同步|启用|恢复|邀请)|(?:完成|发布|上线|部署|推送|开放|开源|更新|升级|合并|同步)(?:了|完成|成功|到|至)|(?:可以|可)(?:访问|使用|下载|查看|体验|安装)/iu;
const PLANNED_ACTION = /计划|安排|准备|预计|将于|将会|接下来|后续|拟于|暂定|定于|开放时间|截止时间/iu;
const QUESTION = /[?？]|为什么|怎么|怎样|如何|能否|是否|可不可以|能不能|是不是|有没有|哪些|哪个|什么|谁|何时|几时|吗(?:\s|$)/iu;
const UNCERTAIN = /可能|也许|感觉|似乎|好像|记得|听说|据说|貌似|猜测|估计/iu;
const SUGGESTION = /建议|希望|最好|要不要|想要|想做|应该(?:要)?/iu;
const ACCESS_OR_RULE = /访问权限|邀请|反馈入口|规则|须知|公告|通知|维护|停用|恢复|截止|活动|招募|征集|投票/iu;
const REPOSITORY_OR_TOOL = /github|仓库|repos?(?:itory)?|issues?|插件|plugin|skill|mcp|工具/iu;

function oneLine(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function authoredOfficialText(value) {
  return String(value ?? "").split("↳ 回复", 1)[0].trim();
}

function sourceDate(row) {
  const timestamp = String(row?.timestamp ?? row?.occurred_at ?? "");
  const fromTimestamp = timestamp.match(/^(\d{4}-\d{2}-\d{2})T/u)?.[1];
  return fromTimestamp ?? String(row?.source_date ?? "").match(/^\d{4}-\d{2}-\d{2}$/u)?.[0] ?? null;
}

function withoutUrls(value) {
  return value.replace(/https?:\/\/\S+/giu, "[链接]");
}

function compactExcerpt(value, limit) {
  const text = oneLine(withoutUrls(value)).replace(/^@[\p{L}\p{N}_-]+\s*/u, "");
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function stableKey(value) {
  const text = String(value ?? "");
  const hash = (seed) => {
    let result = seed >>> 0;
    for (const character of text) {
      result ^= character.codePointAt(0) ?? 0;
      result = Math.imul(result, 16777619) >>> 0;
    }
    return result.toString(16).padStart(8, "0");
  };
  return `${hash(2166136261)}${hash(3339675911)}`;
}

function changelogDate(value) {
  const evidence = typeof value === "string"
    ? value
    : [value?.title, value?.quote, value?.detail].map((part) => String(part ?? "")).join("\n");
  return evidence.match(EXPLICIT_CHANGELOG)?.[1] ?? null;
}

function changelogDetail(text, date) {
  const groups = { "新增": [], "修复": [], "调整": [], "优化": [] };
  let section = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^[-*•\s]+/u, "").trim();
    if (!line || /^changelog\s+/iu.test(line)) continue;
    const heading = line.match(/^(?:✨|🐛|⚠️?|🎨)?\s*(新增|修复|调整|优化)\s*[:：]?$/u)?.[1];
    if (heading) section = heading;
    else if (section && groups[section]) groups[section].push(line);
  }
  const limits = { "新增": 2, "修复": 2, "调整": 1, "优化": 1 };
  const parts = Object.entries(groups).flatMap(([label, lines]) => lines.length
    ? [`${label}：${lines.slice(0, limits[label]).join("；")}`]
    : []);
  return parts.length ? `Changelog ${date}｜${parts.join("；")}。` : `Changelog ${date}｜官方已发布该版本更新。`;
}

function officialProvenance(sender, text) {
  if (DIRECT_OFFICIAL_SENDERS.has(sender)) return "official-account";
  if (sender === CURATOR_SENDER && OFFICIAL_REPOSITORY.test(text)) return "official-repository";
  return null;
}

export function classifyOfficialInformation(row) {
  const sender = oneLine(row?.sender);
  const fullText = String(row?.text ?? row?.content ?? "");
  const text = authoredOfficialText(fullText);
  const date = sourceDate(row);
  const provenance = officialProvenance(sender, text);
  if (!provenance || !date || text.length < 16) return null;

  const explicitDate = changelogDate(text);
  const structured = STRUCTURED_CHANGELOG.test(text);
  const broadcast = BROADCAST_MARKER.test(text);
  const formalLead = FORMAL_LEAD.test(text);
  const officialRepository = OFFICIAL_REPOSITORY.test(text);
  const hasSubject = DSH_SUBJECT.test(text) || broadcast || Boolean(explicitDate) || structured;
  const hasAction = OFFICIAL_ACTION.test(text);
  const hasInformationNoun = OFFICIAL_INFORMATION_NOUN.test(text);
  const isReply = fullText.includes("↳ 回复");
  const language = withoutUrls(text);
  const question = QUESTION.test(language);
  const uncertain = UNCERTAIN.test(language);
  const planned = PLANNED_ACTION.test(language);
  const completed = Boolean(explicitDate || structured || COMPLETED_ACTION.test(language));

  if (!hasSubject || (!hasAction && !hasInformationNoun && !explicitDate && !structured)) return null;
  if (provenance === "official-repository" && !officialRepository) return null;
  if (provenance === "official-repository" && (question || uncertain) && !broadcast && !explicitDate && !structured) return null;
  if (provenance === "official-repository" && (question || uncertain || SUGGESTION.test(language))
    && !completed && !planned && !broadcast && !explicitDate && !structured) return null;
  if (isReply && !explicitDate && !structured && !broadcast) return null;
  if ((question || uncertain) && !explicitDate && !structured && !broadcast && !officialRepository) return null;
  if (SUGGESTION.test(language) && !planned && !completed && !broadcast && !explicitDate && !structured) return null;

  const formalEvidence = explicitDate || structured || broadcast || formalLead || officialRepository
    || (text.length >= 32 && hasSubject && (hasAction || hasInformationNoun));
  if (!formalEvidence) return null;

  const status = completed ? "completed" : planned ? "planned" : "announced";
  let eventType = "announcement";
  if (status === "planned") eventType = "plan";
  else if (officialRepository && REPOSITORY_OR_TOOL.test(text) && !/版本|更新|升级|上线|部署|推送/iu.test(text)) eventType = "repository";
  else if (explicitDate || structured || /版本|更新|升级|发布|上线|部署|推送/iu.test(text)) eventType = "release";
  else if (REPOSITORY_OR_TOOL.test(text)) eventType = "repository";
  else if (ACCESS_OR_RULE.test(text)) eventType = "notice";

  const title = eventType === "plan" ? "官方计划与安排"
    : eventType === "release" ? "版本与产品发布"
      : eventType === "repository" ? "仓库与工具发布"
        : eventType === "notice" ? "规则与服务公告"
          : "官方信息发布";
  return {
    date: explicitDate ?? date,
    sourceDate: date,
    status,
    eventType,
    title,
    provenance,
    explicitChangelog: Boolean(explicitDate),
    structuredChangelog: structured,
  };
}

export function isOfficialInformationRecord(row) {
  return classifyOfficialInformation(row) !== null;
}

export function officialChronicleFromRecord(row) {
  const classification = classifyOfficialInformation(row);
  if (!classification) return null;
  const text = authoredOfficialText(row?.text ?? row?.content);
  const timestamp = String(row?.timestamp ?? row?.occurred_at ?? "");
  const id = String(row?.id ?? row?.message_id ?? row?.document_key ?? "").split(":g:").at(-1) ?? "";
  const quote = classification.explicitChangelog || classification.structuredChangelog
    ? `Changelog ${classification.date}`
    : compactExcerpt(text, 180);
  const detail = classification.explicitChangelog || classification.structuredChangelog
    ? changelogDetail(text, classification.date)
    : classification.status === "completed"
      ? `已完成发布｜${compactExcerpt(text, 360)}`
      : classification.status === "planned"
        ? `官方明确计划｜${compactExcerpt(text, 360)}`
        : `官方公告｜${compactExcerpt(text, 360)}`;
  const repositoryKey = text.match(/https?:\/\/github\.com\/(dsh-external\/[^\s/?#]+)/iu)?.[1]?.toLowerCase() ?? null;
  const normalizedKey = oneLine(withoutUrls(text)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 140);
  const eventKey = classification.explicitChangelog || classification.structuredChangelog
    ? `changelog:${classification.date}`
    : repositoryKey
      ? `official:${classification.sourceDate}:repository:${stableKey(repositoryKey)}`
      : `official:${classification.sourceDate}:${classification.eventType}:${stableKey(normalizedKey || id)}`;
  return {
    message_id: id,
    event_key: eventKey,
    event_type: classification.eventType,
    status: classification.status,
    title: classification.title,
    time: timestamp.slice(0, 16).replace("T", " "),
    timestamp,
    sender: oneLine(row?.sender),
    quote,
    detail,
    confidence: "verified",
    basis: classification.structuredChangelog && !classification.explicitChangelog
      ? "官方账号结构化更新原话 + 消息自然日"
      : classification.status === "completed"
        ? "官方账号正式发布原话"
      : classification.status === "planned"
        ? "官方账号明确计划原话"
        : "官方账号公告原话",
    official_provenance: classification.provenance,
  };
}

export function isOfficialChronicleItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sender = oneLine(value.sender);
  const provenance = oneLine(value.official_provenance);
  const generated = ["completed", "planned", "announced"].includes(oneLine(value.status))
    && ["release", "repository", "notice", "announcement", "plan"].includes(oneLine(value.event_type));
  if (generated) {
    if (DIRECT_OFFICIAL_SENDERS.has(sender) && provenance === "official-account") return true;
    return sender === CURATOR_SENDER && provenance === "official-repository";
  }
  if (!DIRECT_OFFICIAL_SENDERS.has(sender)) return false;
  const evidence = [value.title, value.quote, value.detail].map((part) => String(part ?? "")).join("\n");
  return DSH_SUBJECT.test(evidence) || EXPLICIT_CHANGELOG.test(evidence);
}

export function officialChronicleItems(value) {
  return Array.isArray(value) ? value.filter(isOfficialChronicleItem) : [];
}

export function officialChronicleKey(item) {
  const explicit = oneLine(item?.event_key);
  if (explicit) return explicit;
  const date = changelogDate(item);
  if (date) return `changelog:${date}`;
  const evidence = [item?.title, item?.quote, item?.detail].map((part) => String(part ?? "")).join("\n");
  const snapshot = evidence.match(/snapshot-\d{8}T\d{6}Z-[a-z0-9]+/iu)?.[0]?.toLowerCase();
  return snapshot ? `snapshot:${snapshot}` : null;
}
