import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isOfficialInformationRecord } from "../shared/official-chronicle.mjs";

let cache = null;

const QA_INTENTS = new Set(["lookup", "issue", "release", "overview", "speaker"]);
const QA_SOURCES = new Set(["group", "issue", "both"]);
const GENERIC_QUERY_PARTS = new Set([
  "帮我", "请问", "一下", "这个", "那个", "哪些", "哪个", "什么", "怎么", "怎样", "如何",
  "是否", "有没有", "现在", "目前", "最近", "今天", "今日", "群里", "大家", "我们",
]);

function normalized(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function uniqueStrings(values, limit = 6) {
  const result = [];
  const seen = new Set();
  for (const value of values ?? []) {
    const text = String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, 80);
    const key = normalized(text);
    if (text.length < 2 || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function compactQuestion(value) {
  let text = String(value ?? "").replace(/[？?！!。；;，,：:]/gu, " ");
  for (const part of GENERIC_QUERY_PARTS) text = text.replaceAll(part, " ");
  return text.replace(/\s+/gu, " ").trim();
}

export function defaultQaPlan(question) {
  const text = normalized(question);
  // Bare numbers frequently represent dates (for example, "0806") or versions.
  // Treat a number as an Issue id only when the user explicitly prefixes it.
  const issueNumber = text.match(/(?:\bissue\s*#?\s*|#)(\d{1,6})\b/iu)?.[1] ?? null;
  const speakerQuestion = /(?:谁|哪位|哪个人|成员|群友).*(?:说话|发言|活跃|有趣|有意思|贡献|观点|风格|专业|厉害|懂)|(?:最活跃|发言最多|输出最多|谁最)/u.test(text);
  const releaseQuestion = /官方(?:纪事|信息|公告)|纪事|公告|通知|发布|上线|版本|更新|发版|changelog|release/u.test(text);
  const overviewQuestion = /大家.*(?:关心|讨论|聊)|群里.*(?:关心|讨论|聊|热点)|最关心|关心.*(?:问题|什么)|主要.*(?:问题|主题)|最近.*(?:话题|趋势)|总结|综述|整体|全局|这几天/u.test(text);
  const issueQuestion = Boolean(issueNumber) || /\bissue\b|bug|缺陷|工单|需求单|开放中|关闭了|优先级/u.test(text);

  let intent = "lookup";
  if (issueQuestion) intent = "issue";
  else if (speakerQuestion) intent = "speaker";
  else if (releaseQuestion) intent = "release";
  else if (overviewQuestion) intent = "overview";

  const issueOnly = Boolean(issueNumber) || /(?:issue|工单).*(?:状态|开放|关闭|优先级)|(?:状态|开放|关闭|优先级).*(?:issue|工单)/iu.test(text);
  const groupOverview = intent === "overview" && /群里|群聊|大家/u.test(text) && !/\bissue\b|工单/iu.test(text);
  const source = intent === "issue" ? (issueOnly ? "issue" : "both")
    : intent === "speaker" || intent === "release" || groupOverview ? "group" : "both";
  let days = 0;
  if (/今天|今日/u.test(text)) days = 1;
  else if (/这两天|近两天/u.test(text)) days = 2;
  else if (/最近|这几天/u.test(text)) days = 3;
  else if (/本周|这周|一周|近7天|近七天/u.test(text)) days = 7;
  else if (intent === "overview") days = 7;

  const compact = compactQuestion(question);
  const queries = intent === "release"
    ? ["DeepSeek Harness 官方 发布 公告", "版本 更新 仓库 工具 计划 安排"]
    : intent === "overview"
      ? [compact, "问题 建议 实测 发现 协作 更新"]
      : [compact || question];
  return {
    intent,
    source,
    queries: uniqueStrings(queries, 4),
    days,
    people: [],
    issueNumber,
  };
}

export function normalizeQaPlan(value, question) {
  const fallback = defaultQaPlan(question);
  if (!value || typeof value !== "object") return fallback;
  let intent = QA_INTENTS.has(value.intent) ? value.intent : fallback.intent;
  if (["speaker", "release"].includes(fallback.intent)) intent = fallback.intent;
  if (fallback.intent === "overview" && intent === "lookup") intent = "overview";
  if (fallback.issueNumber) intent = "issue";
  let source = QA_SOURCES.has(value.source) ? value.source : fallback.source;
  if (intent === "speaker" || intent === "release") source = "group";
  if (intent === "overview" && /群里|群聊|大家/u.test(normalized(question)) && !/\bissue\b|工单/iu.test(normalized(question))) source = "group";
  const queries = uniqueStrings(Array.isArray(value.queries) ? value.queries : [], 4);
  const rawDays = Number(value.days);
  const days = Number.isInteger(rawDays) && rawDays >= 0 && rawDays <= 30 ? rawDays : fallback.days;
  const people = uniqueStrings(Array.isArray(value.people) ? value.people : [], 5);
  const issueNumber = intent === "issue"
    ? String(value.issueNumber ?? fallback.issueNumber ?? "").match(/^\d{1,6}$/u)?.[0] ?? null
    : null;
  return {
    intent,
    source,
    queries: queries.length ? queries : fallback.queries,
    days,
    people,
    issueNumber,
  };
}

export function tokenize(value) {
  const text = normalized(value);
  const tokens = new Set();
  for (const chunk of text.match(/[\p{Script=Han}]+|[a-z0-9][a-z0-9_+#./-]*/gu) ?? []) {
    if (/^[\p{Script=Han}]+$/u.test(chunk)) {
      if (chunk.length <= 12 && chunk.length >= 2) tokens.add(chunk);
      for (const size of [2, 3]) {
        for (let index = 0; index <= chunk.length - size; index += 1) {
          tokens.add(chunk.slice(index, index + size));
        }
      }
    } else if (chunk.length >= 2) {
      tokens.add(chunk);
      for (const part of chunk.split(/[./_-]+/u)) if (part.length >= 2) tokens.add(part);
    }
  }
  return [...tokens];
}

function trimText(value, limit = 320) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function authoredMessageText(value) {
  return String(value ?? "").split("↳ 回复", 1)[0].replace(/\s+/gu, " ").trim();
}

function focusedText(value, questionText, limit = 420) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  let index = -1;
  if (/官方(?:纪事|信息|公告)|纪事|公告|通知|发布|上线|版本|更新|发版|changelog/u.test(questionText)) {
    index = text.search(/deepseek harness changelog|changelog\s+\d{4}-\d{2}-\d{2}|官方(?:公告|通知)|正式(?:发布|上线)|github\.com\/dsh-external/iu);
  }
  if (index < 0) {
    const candidates = tokenize(questionText).filter((token) => token.length >= 2).sort((a, b) => b.length - a.length);
    const lower = text.toLowerCase();
    for (const token of candidates) {
      index = lower.indexOf(token.toLowerCase());
      if (index >= 0) break;
    }
  }
  const start = index > 90 ? index - 48 : 0;
  const clipped = text.slice(start, start + limit);
  return `${start ? "…" : ""}${clipped}${start + limit < text.length ? "…" : ""}`;
}

function searchableIssue(issue) {
  return [
    `#${issue.n ?? ""}`,
    issue.title,
    issue.summary,
    issue.excerpt,
    issue.cat,
    issue.group,
    ...(Array.isArray(issue.labels) ? issue.labels : []),
  ].filter(Boolean).join(" ");
}

function enrichDocument(document, sourceIndex) {
  const text = normalized(document.searchText);
  return {
    ...document,
    sourceIndex,
    normalizedText: text,
    tokenSet: new Set(tokenize(text)),
  };
}

function buildDocumentFrequency(documents) {
  const frequency = new Map();
  for (const document of documents) {
    for (const token of document.tokenSet) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  return frequency;
}

export async function loadCorpus(root) {
  const manifestPath = path.join(root, "corpus", "manifest.json");
  const manifestStat = await stat(manifestPath);
  const fingerprint = `${manifestStat.mtimeMs}:${manifestStat.size}`;
  if (cache?.root === root && cache.fingerprint === fingerprint) return cache.corpus;

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const groupDates = Array.isArray(manifest.groupChat?.dates) ? manifest.groupChat.dates.map((entry) => entry.date) : [];
  const issueDates = Array.isArray(manifest.issues?.dates) ? manifest.issues.dates.map((entry) => entry.date) : [];
  if (!groupDates.length || !issueDates.length) throw new Error("私有问答语料清单不完整");

  const groupRows = [];
  for (const date of groupDates) {
    const content = await readFile(path.join(root, "corpus", "group-chat", `${date}.jsonl`), "utf8");
    for (const line of content.split("\n")) {
      if (line.trim()) groupRows.push(JSON.parse(line));
    }
  }
  const latestIssueDate = issueDates.at(-1);
  const issuePayload = JSON.parse(await readFile(path.join(root, "corpus", "issues", `${latestIssueDate}.json`), "utf8"));
  if (!groupRows.length || !Array.isArray(issuePayload.issues) || !issuePayload.issues.length) {
    throw new Error("私有问答语料为空");
  }

  const groupDocuments = groupRows.map((row, index) => enrichDocument({
    kind: "group",
    row,
    searchText: [row.sender, row.messageType, row.text, row.timestamp].filter(Boolean).join(" "),
  }, index));
  const issueDocuments = issuePayload.issues.map((issue, index) => enrichDocument({
    kind: "issue",
    issue,
    searchText: searchableIssue(issue),
  }, index));
  const documents = [...groupDocuments, ...issueDocuments];
  const corpus = {
    manifest,
    groupRows,
    groupDocuments,
    issueDocuments,
    documentFrequency: buildDocumentFrequency(documents),
    documentCount: documents.length,
    stats: {
      messageCount: groupRows.length,
      issueCount: issuePayload.issues.length,
      groupDateCount: groupDates.length,
      latestGroupDate: groupDates.at(-1),
      latestIssueDate,
    },
  };
  cache = { root, fingerprint, corpus };
  return corpus;
}

function scoreDocument(document, originalQuestion, queryText, queryTokens, corpus, plan) {
  let score = 0;
  if (plan.intent === "lookup" && queryText.length >= 3 && document.normalizedText.includes(queryText)) score += 18;
  for (const token of queryTokens) {
    if (!document.tokenSet.has(token) && !document.normalizedText.includes(token)) continue;
    const frequency = corpus.documentFrequency.get(token) ?? corpus.documentCount;
    const idf = Math.log((corpus.documentCount + 1) / (frequency + 1)) + 1;
    score += idf * (token.length >= 3 ? 1.7 : 1);
  }
  if (plan.issueNumber && document.kind === "issue" && String(document.issue.n) === plan.issueNumber) score += 90;
  if (document.kind === "issue") {
    const title = normalized(document.issue.title);
    if (queryTokens.some((token) => token.length >= 2 && title.includes(token))) score += 6;
    const category = normalized(document.issue.cat);
    const priority = Math.min(Number(document.issue.priority ?? 0), 5);
    score += priority * (/高优先级|优先级|值得关注/u.test(originalQuestion) ? 2.2 : 0.12);
    if (/bug|缺陷|故障/u.test(originalQuestion)) score += /bug|缺陷|修复/u.test(`${title} ${category}`) ? 8 : -2;
    if (/目前|开放|值得关注|待处理/u.test(originalQuestion)) score += document.issue.state === "open" ? 4 : -5;
    if (/junk|误创建|测试 issue/iu.test(`${title} ${category}`) && !/junk|误创建/u.test(originalQuestion)) score -= 40;
  } else {
    if (plan.intent === "release") {
      const authoredText = normalized(authoredMessageText(document.row.text));
      const explicitOfficialInformation = /deepseek harness changelog|changelog\s+\d{4}-\d{2}-\d{2}|✨\s*新增|🐛\s*修复|🎨\s*优化|官方(?:公告|通知)|正式(?:发布|上线)/iu;
      const isDirectOfficialInformation = isOfficialInformationRecord(document.row) || explicitOfficialInformation.test(authoredText);
      if (isDirectOfficialInformation) score += 76;
      else if (explicitOfficialInformation.test(document.normalizedText)) score += 18;
      if (!isDirectOfficialInformation && /好像|记得|听说|据说|可能|似乎/u.test(document.normalizedText)) score -= 12;
      if (!isDirectOfficialInformation && /[?？]|更新了么|更新了吗/u.test(document.normalizedText)) score -= 8;
      if (/最近|最新|今日|今天/u.test(originalQuestion)) {
        score += (document.sourceIndex / Math.max(corpus.groupDocuments.length - 1, 1)) * 6;
        if (document.row.timestamp.startsWith(`${corpus.stats.latestGroupDate}T`)) score += 12;
      }
    }
    score += (document.sourceIndex / Math.max(corpus.groupDocuments.length - 1, 1)) * 0.35;
  }
  return score;
}

function fusedRank(documents, question, corpus, plan, limit) {
  // Lightweight RAGFlow-style multiple recall: original and expanded queries are ranked independently, then fused by rank.
  const queries = uniqueStrings([question, ...plan.queries], 5);
  const fused = new Map();
  queries.forEach((query, queryIndex) => {
    const queryText = normalized(query);
    const queryTokens = tokenize(queryText);
    const ranked = documents
      .map((document) => ({
        document,
        score: scoreDocument(document, normalized(question), queryText, queryTokens, corpus, plan),
      }))
      .filter((item) => item.score > 0.5)
      .sort((left, right) => right.score - left.score || right.document.sourceIndex - left.document.sourceIndex)
      .slice(0, Math.max(48, limit * 8));
    ranked.forEach((item, rank) => {
      const key = `${item.document.kind}:${item.document.sourceIndex}`;
      const current = fused.get(key) ?? { document: item.document, fusion: 0, lexical: 0, recalls: 0 };
      current.fusion += (queryIndex === 0 ? 1 : 1.12) / (24 + rank + 1);
      current.lexical = Math.max(current.lexical, item.score);
      current.recalls += 1;
      fused.set(key, current);
    });
  });
  return [...fused.values()]
    .map((item) => ({
      document: item.document,
      score: item.fusion * 100 + Math.min(item.lexical, 100) * 0.04 + item.recalls * 0.08,
    }))
    .sort((left, right) => right.score - left.score || right.document.sourceIndex - left.document.sourceIndex)
    .slice(0, Math.max(limit * 4, limit));
}

function selectDiverse(items, limit) {
  const selected = [];
  const senderCounts = new Map();
  const groupPositions = [];
  for (const item of items) {
    if (item.document.kind === "group") {
      const sender = String(item.document.row.sender ?? "系统");
      if ((senderCounts.get(sender) ?? 0) >= 2) continue;
      if (groupPositions.some((entry) => entry.date === item.document.row.timestamp.slice(0, 10)
        && Math.abs(entry.position - item.document.sourceIndex) <= 1)) continue;
      senderCounts.set(sender, (senderCounts.get(sender) ?? 0) + 1);
      groupPositions.push({ date: item.document.row.timestamp.slice(0, 10), position: item.document.sourceIndex });
    }
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
}

function groupContext(corpus, index, questionText) {
  const row = corpus.groupRows[index];
  return corpus.groupRows
    .slice(Math.max(0, index - 2), Math.min(corpus.groupRows.length, index + 3))
    .filter((candidate) => candidate.timestamp.slice(0, 10) === row.timestamp.slice(0, 10))
    .map((candidate) => {
      const authoredText = authoredMessageText(candidate.text);
      return `${candidate.timestamp} · ${candidate.sender ?? "系统"}：${candidate === row
        ? focusedText(authoredText, questionText, 1_200)
        : trimText(authoredText, 320)}`;
    })
    .join("\n");
}

function isSubstantiveMessage(row) {
  if (!row?.sender || row.side === "system") return false;
  const text = authoredMessageText(row.text);
  if (text.length < 12 || text.length > 1_500) return false;
  const meaningful = text.match(/[\p{Script=Han}a-z0-9]/giu)?.length ?? 0;
  if (meaningful < 7) return false;
  return !/^(?:哈+|h+|笑死|确实|牛逼|有意思|收到|好的|是的|嗯+|啊+|[?？!！。.～~]+)$/iu.test(text);
}

function representativeScore(document, corpus, criteriaTokens = []) {
  const text = authoredMessageText(document.row.text);
  const length = text.length;
  let score = Math.min(length, 360) / 90;
  if (length >= 24 && length <= 600) score += 3;
  if (/建议|发现|测试|实测|复现|原因|方案|问题|应该|可以|因为|但是|对比|流程|实现|版本|更新/iu.test(text)) score += 2.5;
  if (/哈哈|笑|绷不住|离谱|抽象|有梗/iu.test(text)) score += 0.8;
  for (const token of criteriaTokens) if (normalized(text).includes(token)) score += 1.5;
  score += (document.sourceIndex / Math.max(corpus.groupDocuments.length - 1, 1)) * 1.2;
  return score;
}

function speakerCriteriaTokens(plan) {
  const blocked = new Set(["谁说", "说话", "话最", "最有", "有意", "意思", "有意思", "哪个", "哪位", "成员", "群友"]);
  return uniqueStrings(plan.queries, 4).flatMap((query) => tokenize(query))
    .filter((token) => token.length >= 2 && !blocked.has(token));
}

function retrieveSpeakerCorpus(corpus, question, plan, profileLimit = 14) {
  const criteriaTokens = speakerCriteriaTokens(plan);
  const profiles = new Map();
  for (const document of corpus.groupDocuments) {
    const row = document.row;
    const sender = String(row.sender ?? "").trim();
    if (!sender || row.side === "system") continue;
    const profile = profiles.get(sender) ?? { sender, total: 0, substantive: 0, dates: new Set(), samples: [] };
    profile.total += 1;
    profile.dates.add(String(row.timestamp).slice(0, 10));
    if (isSubstantiveMessage(row)) {
      profile.substantive += 1;
      profile.samples.push({ document, score: representativeScore(document, corpus, criteriaTokens) });
    }
    profiles.set(sender, profile);
  }

  const activityQuestion = /最活跃|发言最多|谁说得多|消息最多/u.test(question);
  const requestedPeople = new Set(plan.people.map(normalized));
  const rankedProfiles = [...profiles.values()]
    .filter((profile) => profile.substantive > 0)
    .map((profile) => ({
      ...profile,
      profileScore: activityQuestion
        ? profile.total
        : Math.sqrt(profile.substantive) * 4 + Math.log2(profile.total + 1) + Math.min(profile.dates.size, 7) * 0.4
          + (requestedPeople.has(normalized(profile.sender)) ? 1_000 : 0),
    }))
    .sort((left, right) => right.profileScore - left.profileScore || right.substantive - left.substantive)
    .slice(0, profileLimit);

  const sources = [];
  const context = [];
  rankedProfiles.forEach((profile, index) => {
    const ordered = profile.samples.sort((left, right) => right.score - left.score || right.document.sourceIndex - left.document.sourceIndex);
    const first = ordered[0];
    const second = ordered.find((item) => item.document.row.timestamp.slice(0, 10) !== first?.document.row.timestamp.slice(0, 10))
      ?? ordered.find((item) => Math.abs(item.document.sourceIndex - (first?.document.sourceIndex ?? 0)) > 20);
    const samples = [first, second].filter(Boolean);
    const citation = `G${index + 1}`;
    const excerpt = first
      ? `${profile.total} 条发言，${profile.substantive} 条较完整表达；样本：${trimText(authoredMessageText(first.document.row.text), 120)}`
      : `${profile.total} 条发言`;
    sources.push({
      citation,
      kind: "group",
      label: `${profile.sender} · 成员样本`,
      sender: profile.sender,
      excerpt,
      score: Number(profile.profileScore.toFixed(3)),
    });
    context.push(
      `[${citation}] 群成员平衡样本：${profile.sender}\n`
      + `统计：共 ${profile.total} 条发言，其中 ${profile.substantive} 条为长度和内容较完整的表达，覆盖 ${profile.dates.size} 天。\n`
      + samples.map((item, sampleIndex) => `代表片段 ${sampleIndex + 1}：${item.document.row.timestamp} · ${trimText(authoredMessageText(item.document.row.text), 520)}`).join("\n"),
    );
  });
  return {
    sources,
    context: `检索说明：这是按成员聚合后的平衡样本，不是对“有意思”等字样的搜索结果。主观评价只能基于有限样本。\n\n${context.join("\n\n")}`,
  };
}

function withinDayRange(date, latestDate, days) {
  if (!days) return true;
  const latest = Date.parse(`${latestDate}T00:00:00Z`);
  const current = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(latest) && Number.isFinite(current) && current >= latest - (days - 1) * 86_400_000;
}

function retrieveOverviewCorpus(corpus, question, plan) {
  const sources = [];
  const context = [];
  const criteriaTokens = uniqueStrings(plan.queries, 4).flatMap((query) => tokenize(query))
    .filter((token) => token.length >= 2 && !GENERIC_QUERY_PARTS.has(token));

  if (plan.source !== "issue") {
    const byDate = new Map();
    for (const document of corpus.groupDocuments) {
      const date = document.row.timestamp.slice(0, 10);
      if (!withinDayRange(date, corpus.stats.latestGroupDate, plan.days) || !isSubstantiveMessage(document.row)) continue;
      const list = byDate.get(date) ?? [];
      list.push({ document, score: representativeScore(document, corpus, criteriaTokens) });
      byDate.set(date, list);
    }
    const dates = [...byDate.keys()].sort().reverse().slice(0, plan.days || 7).reverse();
    dates.forEach((date) => {
      const senderCounts = new Map();
      const samples = (byDate.get(date) ?? [])
        .sort((left, right) => right.score - left.score || right.document.sourceIndex - left.document.sourceIndex)
        .filter((item) => {
          const sender = String(item.document.row.sender ?? "系统");
          if ((senderCounts.get(sender) ?? 0) >= 1) return false;
          senderCounts.set(sender, 1);
          return true;
        })
        .slice(0, 6);
      if (!samples.length) return;
      const citation = `G${sources.filter((source) => source.kind === "group").length + 1}`;
      sources.push({
        citation,
        kind: "group",
        label: `${date} · 群聊代表样本`,
        timestamp: `${date}T00:00:00Z`,
        excerpt: `选取 ${samples.length} 条较完整表达，覆盖 ${senderCounts.size} 位成员`,
        score: Number(samples.reduce((sum, item) => sum + item.score, 0).toFixed(3)),
      });
      context.push(
        `[${citation}] ${date} 群聊代表样本（每位成员最多一条）\n`
        + samples.map((item) => `${item.document.row.timestamp} · ${item.document.row.sender ?? "系统"}：${trimText(authoredMessageText(item.document.row.text), 520)}`).join("\n"),
      );
    });
  }

  if (plan.source !== "group") {
    const categories = new Map();
    for (const document of corpus.issueDocuments) {
      const issue = document.issue;
      const date = String(issue.created ?? corpus.stats.latestIssueDate).slice(0, 10);
      if (!withinDayRange(date, corpus.stats.latestIssueDate, plan.days)) continue;
      const category = String(issue.cat ?? "其他");
      const entry = categories.get(category) ?? { category, issues: [] };
      entry.issues.push(issue);
      categories.set(category, entry);
    }
    [...categories.values()]
      .sort((left, right) => right.issues.length - left.issues.length)
      .slice(0, 6)
      .forEach((entry, index) => {
        const samples = entry.issues
          .sort((left, right) => Number(right.priority ?? 0) - Number(left.priority ?? 0) || Number(right.n ?? 0) - Number(left.n ?? 0))
          .slice(0, 3);
        const citation = `I${index + 1}`;
        sources.push({
          citation,
          kind: "issue",
          label: `${entry.category} · ${entry.issues.length} 条 Issue`,
          url: samples[0]?.url,
          state: samples[0]?.state,
          excerpt: samples.map((issue) => `#${issue.n} ${trimText(issue.title, 70)}`).join("；"),
          score: entry.issues.length,
        });
        context.push(
          `[${citation}] Issue 类别：${entry.category}，共 ${entry.issues.length} 条\n`
          + samples.map((issue) => `#${issue.n}（${issue.state ?? "unknown"}，优先级 ${issue.priority ?? "未知"}）：${trimText(issue.title, 180)}；${trimText(issue.summary || issue.excerpt, 360)}`).join("\n"),
        );
      });
  }
  return {
    sources,
    context: `检索说明：这是跨日期、跨成员的分层代表样本和 Issue 类别聚合，用于回答整体趋势问题。\n\n${context.join("\n\n")}`,
  };
}

function retrieveLookupCorpus(corpus, question, plan, groupLimit, issueLimit) {
  const questionText = normalized(question);
  const groupDocuments = plan.intent === "release"
    ? corpus.groupDocuments.filter((document) => isOfficialInformationRecord(document.row))
    : corpus.groupDocuments;
  const groupCandidates = plan.source === "issue" ? [] : fusedRank(groupDocuments, question, corpus, plan, groupLimit);
  const issueDocuments = /bug|缺陷|故障/iu.test(question)
    ? corpus.issueDocuments.filter((document) => /bug|缺陷|修复/iu.test(`${document.issue.title ?? ""} ${document.issue.cat ?? ""}`))
    : corpus.issueDocuments;
  const openIssueDocuments = /目前|开放|值得关注|待处理/u.test(question)
    ? issueDocuments.filter((document) => document.issue.state === "open")
    : issueDocuments;
  const priorityIssueDocuments = /高优先级/u.test(question)
    ? openIssueDocuments.filter((document) => Number(document.issue.priority ?? 0) >= 4)
    : openIssueDocuments;
  const issueCandidates = plan.source === "group" ? [] : fusedRank(priorityIssueDocuments, question, corpus, plan, issueLimit);
  const groupHits = selectDiverse(groupCandidates, groupLimit);
  const issueHits = issueCandidates.slice(0, issueLimit);
  const sources = [];
  const context = [];

  groupHits.forEach(({ document, score }, index) => {
    const row = document.row;
    const citation = `G${index + 1}`;
    sources.push({
      citation,
      kind: "group",
      label: `${row.sender ?? "系统"} · ${row.timestamp.slice(0, 16).replace("T", " ")}`,
      timestamp: row.timestamp,
      sender: row.sender,
      excerpt: focusedText(authoredMessageText(row.text), questionText, 260),
      score: Number(score.toFixed(3)),
    });
    const sourceContext = plan.intent === "release"
      ? `${row.timestamp} · ${row.sender ?? "系统"}：${focusedText(authoredMessageText(row.text), questionText, 1_200)}`
      : groupContext(corpus, document.sourceIndex, questionText);
    context.push(`[${citation}] 【官方】DSH内测群消息\n${sourceContext}`);
  });

  issueHits.forEach(({ document, score }, index) => {
    const issue = document.issue;
    const citation = `I${index + 1}`;
    sources.push({
      citation,
      kind: "issue",
      label: `Issue #${issue.n} · ${trimText(issue.title, 90)}`,
      url: issue.url,
      state: issue.state,
      excerpt: trimText(issue.summary || issue.excerpt, 260),
      score: Number(score.toFixed(3)),
    });
    context.push(
      `[${citation}] GitHub Issue #${issue.n}（${issue.state ?? "unknown"}）\n`
      + `标题：${trimText(issue.title, 240)}\n`
      + `类别：${issue.cat ?? "其他"}；优先级：${issue.priority ?? "未知"}\n`
      + `摘要：${trimText(issue.summary || issue.excerpt, 900)}`,
    );
  });
  return { sources, context: context.join("\n\n") };
}

export function retrieveCorpus(corpus, question, { plan: rawPlan, groupLimit = 10, issueLimit = 8 } = {}) {
  const plan = normalizeQaPlan(rawPlan, question);
  let retrieval;
  if (plan.intent === "speaker") retrieval = retrieveSpeakerCorpus(corpus, question, plan);
  else if (plan.intent === "overview") retrieval = retrieveOverviewCorpus(corpus, question, plan);
  else retrieval = retrieveLookupCorpus(corpus, question, plan, groupLimit, issueLimit);
  return {
    ...retrieval,
    plan,
    strategy: "multi-recall-fusion",
  };
}
