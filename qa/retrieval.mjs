import { readFile, stat } from "node:fs/promises";
import path from "node:path";

let cache = null;

function normalized(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
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

function focusedText(value, questionText, limit = 420) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  let index = -1;
  if (/版本|更新|发版|changelog/u.test(questionText)) {
    index = text.search(/deepseek harness changelog|changelog\s+\d{4}-\d{2}-\d{2}/iu);
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

function scoreDocument(document, questionText, queryTokens, corpus) {
  let score = 0;
  if (questionText.length >= 2 && document.normalizedText.includes(questionText)) score += 28;
  for (const token of queryTokens) {
    if (!document.tokenSet.has(token) && !document.normalizedText.includes(token)) continue;
    const frequency = corpus.documentFrequency.get(token) ?? corpus.documentCount;
    const idf = Math.log((corpus.documentCount + 1) / (frequency + 1)) + 1;
    score += idf * (token.length >= 3 ? 1.6 : 1);
  }
  const issueNumber = questionText.match(/#?(\d{1,6})/u)?.[1];
  if (issueNumber && document.kind === "issue" && String(document.issue.n) === issueNumber) score += 80;
  if (document.kind === "issue") {
    const title = normalized(document.issue.title);
    if (queryTokens.some((token) => token.length >= 2 && title.includes(token))) score += 5;
    score += Math.min(Number(document.issue.priority ?? 0), 5) * 0.08;
  } else {
    if (/版本|更新|发版|changelog/u.test(questionText)) {
      const authoredText = normalized(document.row.text).split("↳ 回复", 1)[0];
      const explicitChangelog = /deepseek harness changelog|changelog\s+\d{4}-\d{2}-\d{2}|✨\s*新增|🐛\s*修复|🎨\s*优化/iu;
      const isDirectChangelog = explicitChangelog.test(authoredText);
      if (isDirectChangelog) score += 72;
      else if (explicitChangelog.test(document.normalizedText)) score += 20;
      if (!isDirectChangelog && /好像|记得|听说|据说|可能|似乎/u.test(document.normalizedText)) score -= 10;
      if (!isDirectChangelog && /[?？]|更新了么|更新了吗/u.test(document.normalizedText)) score -= 7;
      if (/最近|最新|今日|今天/u.test(questionText)) {
        score += (document.sourceIndex / Math.max(corpus.groupDocuments.length - 1, 1)) * 6;
        if (document.row.timestamp.startsWith(`${corpus.stats.latestGroupDate}T`)) score += 12;
      }
    }
    score += (document.sourceIndex / Math.max(corpus.groupDocuments.length - 1, 1)) * 0.45;
  }
  return score;
}

function ranked(documents, questionText, queryTokens, corpus, limit) {
  const scored = documents
    .map((document) => ({ document, score: scoreDocument(document, questionText, queryTokens, corpus) }))
    .filter((item) => item.score > 0.5)
    .sort((left, right) => right.score - left.score || right.document.sourceIndex - left.document.sourceIndex)
    .slice(0, limit);
  if (scored.length) return scored;
  return documents.slice(-limit).reverse().map((document, index) => ({ document, score: 0.1 - index * 0.001 }));
}

function groupContext(corpus, index, questionText) {
  const row = corpus.groupRows[index];
  return corpus.groupRows
    .slice(Math.max(0, index - 1), Math.min(corpus.groupRows.length, index + 2))
    .filter((candidate) => candidate.timestamp.slice(0, 10) === row.timestamp.slice(0, 10))
    .map((candidate) => `${candidate.timestamp} · ${candidate.sender ?? "系统"}：${candidate === row
      ? focusedText(candidate.text, questionText, 1_200)
      : trimText(candidate.text, 420)}`)
    .join("\n");
}

export function retrieveCorpus(corpus, question, { groupLimit = 8, issueLimit = 6 } = {}) {
  const questionText = normalized(question);
  const queryTokens = tokenize(questionText);
  const groupHits = ranked(corpus.groupDocuments, questionText, queryTokens, corpus, groupLimit);
  const issueHits = ranked(corpus.issueDocuments, questionText, queryTokens, corpus, issueLimit);
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
      excerpt: focusedText(row.text, questionText, 260),
      score: Number(score.toFixed(3)),
    });
    context.push(`[${citation}] 【官方】DSH内测群消息\n${groupContext(corpus, document.sourceIndex, questionText)}`);
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
