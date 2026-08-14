import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { tokenize } from "../qa/retrieval.mjs";
import { attachIssueReactions } from "./lib/issue-reactions.mjs";
import { buildRepositoryDigest } from "./lib/repo-digest.mjs";
import { enforceFixedArchive } from "./lib/frozen-archive-policy.mjs";
import {
  assertPrivateContent,
  d1Target,
  executeSqlFile,
  hashJson,
  insertStatements,
  nullableInteger,
  nullableString,
  projectRoot,
  queryD1,
  run,
  runWrangler,
  sanitizeText,
  sqlString,
  trimText,
} from "./lib/data-sync.mjs";

enforceFixedArchive("GitHub Issue / Repo");

const ORGANIZATION = "dsh-external";
const ISSUE_REPOSITORY = "dsh-external/issues";
const CONTENT_DB = "CONTENT_DB";
const QA_DB = "QA_DB";
const sourceRoot = path.resolve(projectRoot, "../dsh-archive");

function textChunks(value, size = 5_000) {
  const chunks = [];
  for (let index = 0; index < value.length;) {
    let end = Math.min(value.length, index + size);
    if (end < value.length
      && /[\uD800-\uDBFF]/u.test(value[end - 1])
      && /[\uDC00-\uDFFF]/u.test(value[end])) end -= 1;
    chunks.push(value.slice(index, end));
    index = end;
  }
  return chunks;
}

function ghPages(endpoint) {
  const rows = [];
  for (let page = 1; page <= 50; page += 1) {
    const separator = endpoint.includes("?") ? "&" : "?";
    const output = run("gh", ["api", `${endpoint}${separator}per_page=100&page=${page}`]);
    const batch = JSON.parse(output);
    if (!Array.isArray(batch)) throw new Error("GitHub API 返回格式不正确。");
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error("GitHub API 分页超过安全上限。");
}

const REPO_HEAD_QUERY = `
  query RepoHeads($org: String!, $after: String) {
    organization(login: $org) {
      repositories(first: 100, after: $after, orderBy: { field: NAME, direction: ASC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          defaultBranchRef {
            target {
              ... on Commit { oid messageHeadline committedDate }
            }
          }
        }
      }
    }
  }
`;

function collectRepoHeads() {
  const heads = new Map();
  let cursor = null;
  for (let page = 1; page <= 10; page += 1) {
    const args = ["api", "graphql", "-f", `query=${REPO_HEAD_QUERY}`, "-F", `org=${ORGANIZATION}`];
    if (cursor) args.push("-F", `after=${cursor}`);
    const payload = JSON.parse(run("gh", args));
    const connection = payload?.data?.organization?.repositories;
    if (!connection || !Array.isArray(connection.nodes)) throw new Error("GitHub Repo 默认分支响应格式不正确。");
    for (const node of connection.nodes) {
      const name = String(node?.name ?? "");
      const target = node?.defaultBranchRef?.target;
      if (!name || heads.has(name)) throw new Error("GitHub Repo 默认分支列表存在空名称或重复项。");
      heads.set(name, target?.oid ? {
        sha: String(target.oid),
        headline: sanitizeText(target.messageHeadline ?? ""),
        committedAt: String(target.committedDate ?? ""),
      } : null);
    }
    if (!connection.pageInfo?.hasNextPage) return heads;
    cursor = String(connection.pageInfo?.endCursor ?? "");
    if (!cursor) throw new Error("GitHub Repo 默认分支分页游标缺失。");
  }
  throw new Error("GitHub Repo 默认分支分页超过安全上限。");
}

function sanitizeValue(value) {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]));
  }
  return value;
}

function loadClassifiedIssues() {
  const directory = mkdtempSync(path.join(tmpdir(), "dsh-issue-digest-"));
  try {
    run("python3", [path.join(sourceRoot, ".github/workflows/refresh_issues.py")], { cwd: directory });
    const payload = JSON.parse(readFileSync(path.join(directory, "issues.json"), "utf8"));
    if (payload?.version !== 2 || !Array.isArray(payload.issues) || payload.issues.length === 0) {
      throw new Error("Issue 展示数据为空或格式错误。");
    }
    return payload;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function collectIssues(classified) {
  const raw = ghPages(`repos/${ISSUE_REPOSITORY}/issues?state=all&sort=created&direction=asc`)
    .filter((issue) => !issue.pull_request)
    .map(sanitizeValue);
  if (!raw.length || raw.length !== classified.issues.length) {
    throw new Error("Issue API 完整列表与展示列表计数不一致。");
  }
  const rawNumbers = new Set(raw.map((issue) => Number(issue.number)));
  if (classified.issues.some((issue) => !rawNumbers.has(Number(issue.n)))) {
    throw new Error("Issue API 与展示列表编号不一致。");
  }
  return raw;
}

function collectRepos(now, repoHeads) {
  const raw = ghPages(`orgs/${ORGANIZATION}/repos?type=all&sort=full_name&direction=asc`).map(sanitizeValue);
  if (!raw.length) throw new Error("组织 Repo 列表为空，拒绝覆盖。");
  if (raw.some((repo) => !repoHeads.has(String(repo.name ?? ""))) || repoHeads.size !== raw.length) {
    throw new Error("Repo REST 列表与默认分支列表计数或名称不一致。");
  }
  const ids = new Set();
  const repositories = raw.map((repo) => {
    const id = Number(repo.id);
    const name = String(repo.name ?? "");
    if (!Number.isSafeInteger(id) || id <= 0 || !name || ids.has(id)) throw new Error("Repo 列表存在无效或重复 ID。");
    ids.add(id);
    return {
      id,
      name,
      fullName: String(repo.full_name ?? `${ORGANIZATION}/${name}`),
      url: String(repo.html_url ?? ""),
      description: sanitizeText(repo.description ?? ""),
      visibility: String(repo.visibility ?? (repo.private ? "private" : "public")),
      archived: Boolean(repo.archived),
      disabled: Boolean(repo.disabled),
      fork: Boolean(repo.fork),
      template: Boolean(repo.is_template),
      createdAt: String(repo.created_at ?? ""),
      updatedAt: String(repo.updated_at ?? ""),
      pushedAt: String(repo.pushed_at ?? ""),
      language: repo.language ? String(repo.language) : null,
      topics: Array.isArray(repo.topics) ? repo.topics.map(String).slice(0, 30) : [],
      defaultBranch: String(repo.default_branch ?? ""),
      openIssueCount: Math.max(0, Number(repo.open_issues_count ?? 0)),
      firstSeenAt: now,
      latestCommit: repoHeads.get(name),
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "en"));
  return { raw, repositories };
}

function repoPayload(digest, now, syncId) {
  const repositories = digest.repositories;
  const languageCounts = new Map();
  for (const repo of repositories) {
    const language = repo.language || "未标注";
    languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
  }
  return {
    version: 2,
    organization: ORGANIZATION,
    syncId,
    updatedAt: now,
    stats: {
      total: repositories.length,
      active: repositories.filter((repo) => !repo.archived && !repo.disabled).length,
      archived: repositories.filter((repo) => repo.archived).length,
      private: repositories.filter((repo) => repo.visibility === "private").length,
      languages: [...languageCounts.entries()]
        .map(([language, count]) => ({ language, count }))
        .sort((left, right) => right.count - left.count || left.language.localeCompare(right.language, "zh")),
    },
    groups: digest.groups,
    highlights: digest.highlights,
    quality: digest.quality,
    repositories,
  };
}

function activeRepoFirstSeen(repositories, now) {
  let current = [];
  try {
    current = queryD1(CONTENT_DB, "SELECT github_id, first_seen_at FROM content_repo_first_seen;");
  } catch {
    current = [];
  }
  const firstSeen = new Map(current.map((row) => [Number(row.github_id), String(row.first_seen_at)]));
  return repositories.map((repo) => ({ ...repo, firstSeenAt: firstSeen.get(repo.id) ?? now }));
}

function qaRows(syncId, classified, rawIssues, repositories) {
  const classifiedByNumber = new Map(classified.issues.map((issue) => [Number(issue.n), issue]));
  const documents = [];
  const fts = [];
  let issueDocumentCount = 0;
  rawIssues.forEach((raw, position) => {
    const number = Number(raw.number);
    const issue = classifiedByNumber.get(number) ?? {};
    const title = `#${number} · ${sanitizeText(raw.title ?? issue.title ?? "Issue")}`;
    const body = sanitizeText(raw.body ?? "");
    const labels = Array.isArray(raw.labels)
      ? raw.labels.map((label) => typeof label === "string" ? label : String(label?.name ?? "")).filter(Boolean)
      : [];
    const occurredAt = String(raw.updated_at ?? raw.created_at ?? "");
    const bodyChunks = textChunks(body || "（Issue 正文为空）");
    bodyChunks.forEach((bodyChunk, chunkIndex) => {
      const documentKey = `${syncId}:i:${number}:${chunkIndex}`;
      const content = [
        title,
        `GitHub 👍 ${Number(issue.thumbs_up ?? 0)}`,
        bodyChunk,
        issue.summary,
        issue.excerpt,
        issue.cat,
        issue.group,
        ...labels,
      ]
        .filter(Boolean).join("\n");
      assertPrivateContent(content, `Issue #${number}`);
      const tokens = tokenize(content).slice(0, 1_500).join(" ");
      documents.push(`(${[
        sqlString(documentKey), sqlString(syncId), sqlString("issue"), sqlString(occurredAt.slice(0, 10)), String(position * 1000 + chunkIndex),
        sqlString(occurredAt), "NULL", sqlString(title), nullableString(raw.html_url ?? issue.url),
        nullableString(raw.state ?? issue.state), nullableString(issue.cat), nullableInteger(issue.priority), "0",
        nullableString(trimText(issue.summary || issue.excerpt || bodyChunk, 900)), sqlString(content),
      ].join(", ")})`);
      fts.push(`(${sqlString(documentKey)}, ${sqlString(tokens)})`);
      issueDocumentCount += 1;
    });
  });

  repositories.forEach((repo, position) => {
    const documentKey = `${syncId}:r:${repo.id}`;
    const state = repo.archived ? "archived" : repo.disabled ? "disabled" : "active";
    const content = [
      repo.fullName,
      repo.description,
      repo.summary,
      repo.activity,
      repo.why,
      repo.categoryName,
      `状态 ${state}`,
      repo.language ? `主要语言 ${repo.language}` : "",
      repo.topics.length ? `主题 ${repo.topics.join(" ")}` : "",
      `创建 ${repo.createdAt}`,
      `最近推送 ${repo.pushedAt}`,
      repo.latestCommit?.headline ? `默认分支最新提交 ${repo.latestCommit.headline}` : "",
      repo.latestCommit?.committedAt ? `提交时间 ${repo.latestCommit.committedAt}` : "",
      `首次观察 ${repo.firstSeenAt}`,
    ].filter(Boolean).join("\n");
    assertPrivateContent(content, `Repo ${repo.name}`);
    const tokens = tokenize(content).slice(0, 2_000).join(" ");
    documents.push(`(${[
      sqlString(documentKey), sqlString(syncId), sqlString("repo"), sqlString((repo.latestCommit?.committedAt || repo.pushedAt || repo.createdAt).slice(0, 10)),
      String(position), sqlString(repo.latestCommit?.committedAt || repo.pushedAt || repo.updatedAt || repo.createdAt), "NULL", sqlString(repo.fullName),
      nullableString(repo.url), sqlString(state), nullableString(repo.categoryName || "未分类"), String(repo.attention?.score ?? 0), "0",
      nullableString(trimText(repo.summary || `${repo.fullName} · ${state}`, 900)), sqlString(content),
    ].join(", ")})`);
    fts.push(`(${sqlString(documentKey)}, ${sqlString(tokens)})`);
  });
  return { documents, fts, issueDocumentCount };
}

function stageContent(syncId, now, classified, repos) {
  const issueText = JSON.stringify(classified);
  const repoText = JSON.stringify(repos);
  assertPrivateContent(issueText, "Issue 展示数据");
  assertPrivateContent(repoText, "Repo 展示数据");
  const firstSeenStatements = repos.repositories.map((repo) => `
    INSERT INTO content_repo_first_seen (github_id, full_name, first_seen_at, last_seen_at)
    VALUES (${repo.id}, ${sqlString(repo.fullName)}, ${sqlString(repo.firstSeenAt)}, ${sqlString(now)})
    ON CONFLICT(github_id) DO UPDATE SET
      full_name = excluded.full_name,
      last_seen_at = excluded.last_seen_at;
  `);
  const issueChunks = textChunks(issueText);
  const repoChunks = textChunks(repoText);
  const chunkStatements = [
    ...issueChunks.map((chunk, index) => `INSERT OR REPLACE INTO content_source_chunks
      (source, sync_id, chunk_index, payload) VALUES ('issues', ${sqlString(syncId)}, ${index}, ${sqlString(chunk)});`),
    ...repoChunks.map((chunk, index) => `INSERT OR REPLACE INTO content_source_chunks
      (source, sync_id, chunk_index, payload) VALUES ('repos', ${sqlString(syncId)}, ${index}, ${sqlString(chunk)});`),
  ];
  executeSqlFile(CONTENT_DB, `
    INSERT OR REPLACE INTO content_sync_runs
      (sync_id, source, status, item_count, started_at)
    VALUES (${sqlString(syncId)}, 'github', 'staged', ${classified.issues.length + repos.repositories.length}, ${sqlString(now)});
    INSERT OR REPLACE INTO content_source_versions
      (source, sync_id, generated_at, item_count, payload)
    VALUES ('issues', ${sqlString(syncId)}, ${sqlString(now)}, ${classified.issues.length}, '{"chunked":true}');
    INSERT OR REPLACE INTO content_source_versions
      (source, sync_id, generated_at, item_count, payload)
    VALUES ('repos', ${sqlString(syncId)}, ${sqlString(now)}, ${repos.repositories.length}, '{"chunked":true}');
    DELETE FROM content_source_chunks WHERE sync_id = ${sqlString(syncId)};
    ${chunkStatements.join("\n")}
    ${firstSeenStatements.join("\n")}
  `, "dsh-content-github-");
  const rows = queryD1(CONTENT_DB, `
    SELECT v.source, v.item_count, json_valid(v.payload) AS valid,
      COUNT(c.chunk_index) AS chunk_count,
      SUM(length(CAST(c.payload AS BLOB))) AS payload_bytes
    FROM content_source_versions AS v
    JOIN content_source_chunks AS c ON c.source = v.source AND c.sync_id = v.sync_id
    WHERE v.sync_id = ${sqlString(syncId)} GROUP BY v.source, v.item_count, v.payload ORDER BY v.source;
  `);
  const bySource = new Map(rows.map((row) => [row.source, row]));
  const issue = bySource.get("issues");
  const repo = bySource.get("repos");
  if (rows.some((row) => Number(row.valid) !== 1 || Number(row.chunk_count) <= 0)
    || Number(issue?.item_count) !== classified.issues.length
    || Number(repo?.item_count) !== repos.repositories.length
    || Number(issue?.chunk_count) !== issueChunks.length
    || Number(repo?.chunk_count) !== repoChunks.length
    || Number(issue?.payload_bytes) !== Buffer.byteLength(issueText)
    || Number(repo?.payload_bytes) !== Buffer.byteLength(repoText)) {
    throw new Error("CONTENT_DB GitHub 暂存校验失败，旧版本保持激活。");
  }
}

function stageQa(syncId, now, classified, rawIssues, rawRepos, repoHeads, repos) {
  const { documents, fts, issueDocumentCount } = qaRows(syncId, classified, rawIssues, repos.repositories);
  const rawIssueText = JSON.stringify({ version: 1, repository: ISSUE_REPOSITORY, generatedAt: now, issues: rawIssues });
  const rawRepoText = JSON.stringify({
    version: 2,
    organization: ORGANIZATION,
    generatedAt: now,
    repositories: rawRepos,
    defaultBranchHeads: [...repoHeads.entries()].map(([name, latestCommit]) => ({ name, latestCommit })),
  });
  assertPrivateContent(rawIssueText, "完整 Issue API 快照");
  assertPrivateContent(rawRepoText, "完整 Repo API 快照");
  const issueSnapshotChunks = textChunks(rawIssueText);
  const repoSnapshotChunks = textChunks(rawRepoText);
  const statements = [
    `DELETE FROM qa_github_fts WHERE document_key LIKE ${sqlString(`${syncId}:%`)};`,
    `DELETE FROM qa_github_documents WHERE sync_id = ${sqlString(syncId)};`,
    `DELETE FROM qa_github_snapshot_chunks WHERE sync_id = ${sqlString(syncId)};`,
    `DELETE FROM qa_github_snapshots WHERE sync_id = ${sqlString(syncId)};`,
    ...insertStatements("qa_github_documents", [
      "document_key", "sync_id", "kind", "source_date", "position", "occurred_at", "sender", "title",
      "url", "state", "category", "priority", "is_changelog", "excerpt", "content",
    ], documents, 5, 20_000),
    ...insertStatements("qa_github_fts", ["document_key", "tokens"], fts, 5, 20_000),
    `INSERT INTO qa_github_snapshots (sync_id, kind, item_count, payload) VALUES
      (${sqlString(syncId)}, 'issue_api', ${rawIssues.length}, '{"chunked":true}'),
      (${sqlString(syncId)}, 'repo_api', ${rawRepos.length}, '{"chunked":true}');`,
    ...issueSnapshotChunks.map((chunk, index) => `INSERT INTO qa_github_snapshot_chunks
      (sync_id, kind, chunk_index, payload) VALUES (${sqlString(syncId)}, 'issue_api', ${index}, ${sqlString(chunk)});`),
    ...repoSnapshotChunks.map((chunk, index) => `INSERT INTO qa_github_snapshot_chunks
      (sync_id, kind, chunk_index, payload) VALUES (${sqlString(syncId)}, 'repo_api', ${index}, ${sqlString(chunk)});`),
  ];
  const stagedState = () => {
    const documentRows = queryD1(QA_DB, `
      SELECT kind, COUNT(*) AS count FROM qa_github_documents
      WHERE sync_id = ${sqlString(syncId)} GROUP BY kind;
    `);
    const ftsRows = queryD1(QA_DB, `
      SELECT d.kind, COUNT(*) AS count
      FROM qa_github_documents AS d
      JOIN qa_github_fts AS f ON f.document_key = d.document_key
      WHERE d.sync_id = ${sqlString(syncId)} GROUP BY d.kind;
    `);
    const snapshotRows = queryD1(QA_DB, `
      SELECT s.kind, s.item_count, COUNT(c.chunk_index) AS chunk_count,
        SUM(length(CAST(c.payload AS BLOB))) AS payload_bytes
      FROM qa_github_snapshots AS s
      JOIN qa_github_snapshot_chunks AS c ON c.sync_id = s.sync_id AND c.kind = s.kind
      WHERE s.sync_id = ${sqlString(syncId)}
      GROUP BY s.kind, s.item_count;
    `);
    return {
      documents: new Map(documentRows.map((row) => [row.kind, Number(row.count)])),
      fts: new Map(ftsRows.map((row) => [row.kind, Number(row.count)])),
      snapshots: new Map(snapshotRows.map((row) => [row.kind, row])),
    };
  };
  const valid = (state) => {
    const issueSnapshot = state.snapshots.get("issue_api");
    const repoSnapshot = state.snapshots.get("repo_api");
    return state.documents.get("issue") === issueDocumentCount
      && state.documents.get("repo") === repos.repositories.length
      && state.fts.get("issue") === issueDocumentCount
      && state.fts.get("repo") === repos.repositories.length
      && Number(issueSnapshot?.item_count) === rawIssues.length
      && Number(repoSnapshot?.item_count) === rawRepos.length
      && Number(issueSnapshot?.chunk_count) === issueSnapshotChunks.length
      && Number(repoSnapshot?.chunk_count) === repoSnapshotChunks.length
      && Number(issueSnapshot?.payload_bytes) === Buffer.byteLength(rawIssueText)
      && Number(repoSnapshot?.payload_bytes) === Buffer.byteLength(rawRepoText);
  };
  let staged = stagedState();
  if (!valid(staged)) {
    executeSqlFile(QA_DB, `${statements.join("\n")}\n`, "dsh-qa-github-");
    staged = stagedState();
  }
  if (!valid(staged)) {
    throw new Error("QA_DB GitHub 暂存、检索索引或完整快照校验不一致，旧索引保持激活。");
  }
}

function activate(syncId, now, issueCount, repoCount) {
  const previousQa = queryD1(QA_DB, "SELECT value FROM qa_corpus_meta WHERE key = 'active_github_sync_id' LIMIT 1;")[0]?.value;
  const previousContent = queryD1(CONTENT_DB, "SELECT sync_id FROM content_active_sources WHERE source = 'issues' LIMIT 1;")[0]?.sync_id;
  executeSqlFile(QA_DB, `
    INSERT INTO qa_corpus_meta (key, value, updated_at) VALUES
      ('active_github_sync_id', ${sqlString(syncId)}, CURRENT_TIMESTAMP),
      ('github_issue_count', ${sqlString(issueCount)}, CURRENT_TIMESTAMP),
      ('github_repo_count', ${sqlString(repoCount)}, CURRENT_TIMESTAMP),
      ('latest_issue_date_v2', ${sqlString(now.slice(0, 10))}, CURRENT_TIMESTAMP),
      ('github_synced_at', ${sqlString(now)}, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;
  `, "dsh-qa-github-activate-");

  executeSqlFile(CONTENT_DB, `
    INSERT INTO content_active_sources (source, sync_id, activated_at) VALUES
      ('issues', ${sqlString(syncId)}, ${sqlString(now)}),
      ('repos', ${sqlString(syncId)}, ${sqlString(now)})
    ON CONFLICT(source) DO UPDATE SET sync_id = excluded.sync_id, activated_at = excluded.activated_at;
    UPDATE content_sync_runs SET status = 'active', finished_at = ${sqlString(now)}
    WHERE sync_id = ${sqlString(syncId)};
  `, "dsh-content-github-activate-");

  const contentActive = queryD1(CONTENT_DB, "SELECT source, sync_id FROM content_active_sources ORDER BY source;");
  const qaMeta = queryD1(QA_DB, `
    SELECT key, value FROM qa_corpus_meta
    WHERE key IN ('active_github_sync_id', 'github_issue_count', 'github_repo_count');
  `);
  if (contentActive.length !== 2 || contentActive.some((row) => row.sync_id !== syncId)) {
    throw new Error("CONTENT_DB GitHub active 指针校验失败。");
  }
  const meta = new Map(qaMeta.map((row) => [row.key, row.value]));
  if (meta.get("active_github_sync_id") !== syncId
    || Number(meta.get("github_issue_count")) !== issueCount
    || Number(meta.get("github_repo_count")) !== repoCount) {
    throw new Error("QA_DB GitHub active 指针校验失败。");
  }

  const keepQa = [syncId, previousQa].filter(Boolean);
  const keepContent = [syncId, previousContent].filter(Boolean);
  runWrangler(["d1", "execute", QA_DB, d1Target(), "--command", `
    DELETE FROM qa_github_fts WHERE document_key IN (
      SELECT document_key FROM qa_github_documents WHERE sync_id NOT IN (${keepQa.map(sqlString).join(",")})
    );
    DELETE FROM qa_github_documents WHERE sync_id NOT IN (${keepQa.map(sqlString).join(",")});
    DELETE FROM qa_github_snapshot_chunks WHERE sync_id NOT IN (${keepQa.map(sqlString).join(",")});
    DELETE FROM qa_github_snapshots WHERE sync_id NOT IN (${keepQa.map(sqlString).join(",")});
  `, "--yes"]);
  runWrangler(["d1", "execute", CONTENT_DB, d1Target(), "--command", `
    DELETE FROM content_source_chunks WHERE sync_id NOT IN (${keepContent.map(sqlString).join(",")});
    DELETE FROM content_source_versions WHERE sync_id NOT IN (${keepContent.map(sqlString).join(",")});
    DELETE FROM content_sync_runs WHERE source = 'github' AND sync_id NOT IN (${keepContent.map(sqlString).join(",")});
  `, "--yes"]);
}

const now = new Date().toISOString();
const classifiedWithoutReactions = loadClassifiedIssues();
const rawIssues = collectIssues(classifiedWithoutReactions);
const classified = attachIssueReactions(classifiedWithoutReactions, rawIssues);
const repoHeads = collectRepoHeads();
const collectedRepos = collectRepos(now, repoHeads);
const repositories = activeRepoFirstSeen(collectedRepos.repositories, now);
const digest = buildRepositoryDigest(repositories, now);
const provisional = {
  issues: classified.issues,
  repositories: digest.repositories,
  groups: digest.groups,
  highlights: digest.highlights,
};
const syncId = hashJson("github-live-v2", provisional);
const repos = repoPayload(digest, now, syncId);

const activeContent = queryD1(CONTENT_DB, "SELECT source, sync_id FROM content_active_sources ORDER BY source;");
const activeQa = new Map(queryD1(QA_DB, `
  SELECT key, value FROM qa_corpus_meta
  WHERE key IN ('active_github_sync_id', 'github_issue_count', 'github_repo_count');
`).map((row) => [row.key, row.value]));
if (activeContent.length === 2 && activeContent.every((row) => row.sync_id === syncId)
  && activeQa.get("active_github_sync_id") === syncId
  && Number(activeQa.get("github_issue_count")) === rawIssues.length
  && Number(activeQa.get("github_repo_count")) === repositories.length) {
  console.log(JSON.stringify({
    source: "github-live",
    syncId,
    issues: rawIssues.length,
    repos: repositories.length,
    unchanged: true,
    target: d1Target().slice(2),
  }));
  process.exit(0);
}

stageContent(syncId, now, classified, repos);
stageQa(syncId, now, classified, rawIssues, collectedRepos.raw, repoHeads, repos);
activate(syncId, now, rawIssues.length, repositories.length);

console.log(JSON.stringify({
  source: "github-live",
  syncId,
  issues: rawIssues.length,
  repos: repositories.length,
  syncedAt: now,
  target: d1Target().slice(2),
}));
