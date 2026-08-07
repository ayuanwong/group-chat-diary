export interface ContentRuntimeEnv {
  CONTENT_DB: D1Database;
  QA_DB: D1Database;
}

interface GroupVersionRow {
  date: string;
  ingest_id: string;
  generated_at: string;
  source_message_count: number;
  accepted_message_count: number;
  signal_count: number;
  participant_count: number;
  chronicle_count: number;
  payload?: string;
  activated_at: string;
}

interface SourceVersionRow {
  source: "issues" | "repos";
  sync_id: string;
  generated_at: string;
  item_count: number;
  payload?: string;
  activated_at: string;
}

interface GroupPayloadRow {
  date: string;
  generated_at: string;
  payload: string;
}

interface LiveChronicleRow {
  document_key: string;
  source_date: string;
  occurred_at: string;
  sender: string;
  content: string;
}

type JsonRecord = Record<string, unknown>;

const OFFICIAL_PRODUCT_SENDERS = new Set(["Baymax", "崔小天"]);
const OFFICIAL_DSH_SUBJECT = /deepseek\s+harness|dsh(?:2026|-external)|snapshot-\d{8}|changelog\s+\d{4}-\d{2}-\d{2}|内测版代码|github\s+repo.{0,40}(?:新版本|推送)|issues\s+repo/iu;

function parsePayload(value: string | undefined): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function nonnegativeInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} 不是非负整数。`);
  return number;
}

function itemIdentity(item: JsonRecord, date: string, index: number): string {
  return String(item.message_id || item.source_ref || `${date}:${item.timestamp || item.time || ""}:${item.sender || ""}:${index}`);
}

function chronicleIdentity(item: JsonRecord, date: string, index: number): string {
  const evidence = [item.title, item.quote, item.detail].map((part) => String(part ?? "")).join("\n");
  const releaseDate = evidence.match(/changelog\s+(\d{4}-\d{2}-\d{2})/iu)?.[1];
  if (releaseDate) return `changelog:${releaseDate}`;
  const snapshot = evidence.match(/snapshot-\d{8}T\d{6}Z-[a-z0-9]+/iu)?.[0]?.toLowerCase();
  return snapshot ? `snapshot:${snapshot}` : itemIdentity(item, date, index);
}

function newestFirst(left: JsonRecord, right: JsonRecord): number {
  return String(right.timestamp || right.time || "").localeCompare(String(left.timestamp || left.time || ""));
}

export function isOfficialChronicle(value: unknown): value is JsonRecord {
  const item = record(value);
  if (!item || !OFFICIAL_PRODUCT_SENDERS.has(String(item.sender ?? "").trim())) return false;
  const evidence = [item.title, item.quote, item.detail]
    .map((part) => String(part ?? ""))
    .join("\n");
  return OFFICIAL_DSH_SUBJECT.test(evidence);
}

function officialChronicles(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isOfficialChronicle) : [];
}

function liveChronicle(row: LiveChronicleRow): JsonRecord | null {
  if (!OFFICIAL_PRODUCT_SENDERS.has(String(row.sender ?? "").trim())) return null;
  const text = String(row.content ?? "").split("↳ 回复", 1)[0].trim();
  const releaseDate = text.match(/changelog\s+(\d{4}-\d{2}-\d{2})/iu)?.[1];
  if (!releaseDate) return null;
  const groups: Record<string, string[]> = { "新增": [], "修复": [], "调整": [], "优化": [] };
  let section = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^[-*•\s]+/u, "").trim();
    if (!line || /^changelog\s+/iu.test(line)) continue;
    const heading = line.match(/^(?:✨|🐛|⚠️?|🎨)?\s*(新增|修复|调整|优化)\s*[:：]?$/u)?.[1];
    if (heading) section = heading;
    else if (section) groups[section].push(line);
  }
  const limits: Record<string, number> = { "新增": 2, "修复": 2, "调整": 1, "优化": 1 };
  const parts = Object.entries(groups).flatMap(([label, lines]) => lines.length
    ? [`${label}：${lines.slice(0, limits[label]).join("；")}`]
    : []);
  return {
    message_id: String(row.document_key).split(":g:").at(-1) ?? row.document_key,
    title: "内测版本更新",
    time: String(row.occurred_at).slice(0, 16).replace("T", " "),
    timestamp: row.occurred_at,
    sender: row.sender,
    quote: `Changelog ${releaseDate}`,
    detail: parts.length ? `Changelog ${releaseDate}｜${parts.join("；")}。` : `Changelog ${releaseDate}｜官方已发布该版本更新。`,
    confidence: "candidate",
    basis: "官方账号完成态 Changelog 原话",
  };
}

function sanitizedGroupSnapshot(value: unknown): unknown | null {
  const snapshot = record(value);
  const group = record(snapshot?.group);
  const source = record(group?.source);
  if (!snapshot || !group || !source) return value ?? null;
  return {
    ...snapshot,
    group: {
      ...group,
      chronicles: officialChronicles(group.chronicles),
      source: {
        group: source.group,
        identity_rules: source.identity_rules,
        privacy: source.privacy,
      },
    },
  };
}

export function validArchiveDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

async function activeSource(db: D1Database, source: "issues" | "repos", includePayload: boolean): Promise<SourceVersionRow | null> {
  const payloadColumn = includePayload ? ", v.payload" : "";
  return db.prepare(`
    SELECT v.source, v.sync_id, v.generated_at, v.item_count, a.activated_at${payloadColumn}
    FROM content_active_sources AS a
    JOIN content_source_versions AS v ON v.source = a.source AND v.sync_id = a.sync_id
    WHERE a.source = ?1
    LIMIT 1
  `).bind(source).first<SourceVersionRow>();
}

export async function contentManifest(env: ContentRuntimeEnv): Promise<Record<string, unknown> | null> {
  const [groups, issue, repo] = await Promise.all([
    env.CONTENT_DB.prepare(`
      SELECT v.date, v.ingest_id, v.generated_at, v.source_message_count,
        v.accepted_message_count, v.signal_count, v.participant_count,
        v.chronicle_count, a.activated_at
      FROM content_active_group_days AS a
      JOIN content_group_versions AS v ON v.date = a.date AND v.ingest_id = a.ingest_id
      ORDER BY v.date DESC
    `).all<GroupVersionRow>(),
    activeSource(env.CONTENT_DB, "issues", false),
    activeSource(env.CONTENT_DB, "repos", false),
  ]);
  const entries = groups.results ?? [];
  if (!entries.length) return null;
  return {
    version: 2,
    timeZone: "Asia/Shanghai",
    latest: entries[0].date,
    dates: entries.map((entry) => entry.date),
    entries: entries.map((entry) => ({
      date: entry.date,
      generatedAt: entry.generated_at,
      activatedAt: entry.activated_at,
      sourceMessages: Number(entry.source_message_count),
      messages: Number(entry.accepted_message_count),
      signals: Number(entry.signal_count),
      participants: Number(entry.participant_count),
      chronicles: Number(entry.chronicle_count),
    })),
    github: {
      syncId: issue?.sync_id && issue.sync_id === repo?.sync_id ? issue.sync_id : null,
      issues: Number(issue?.item_count ?? 0),
      repos: Number(repo?.item_count ?? 0),
      generatedAt: issue?.generated_at && issue.generated_at === repo?.generated_at
        ? issue.generated_at
        : issue?.generated_at ?? repo?.generated_at ?? null,
      activatedAt: issue?.activated_at && issue.activated_at === repo?.activated_at
        ? issue.activated_at
        : null,
    },
  };
}

export async function contentGroupDay(env: ContentRuntimeEnv, date: string): Promise<unknown | null> {
  if (!validArchiveDate(date)) return null;
  const row = await env.CONTENT_DB.prepare(`
    SELECT v.payload
    FROM content_active_group_days AS a
    JOIN content_group_versions AS v ON v.date = a.date AND v.ingest_id = a.ingest_id
    WHERE a.date = ?1
    LIMIT 1
  `).bind(date).first<{ payload: string }>();
  return sanitizedGroupSnapshot(parsePayload(row?.payload));
}

export async function contentGroupHistory(env: ContentRuntimeEnv): Promise<Record<string, unknown> | null> {
  const rows = await env.CONTENT_DB.prepare(`
    SELECT v.date, v.generated_at, v.payload
    FROM content_active_group_days AS a
    JOIN content_group_versions AS v ON v.date = a.date AND v.ingest_id = a.ingest_id
    ORDER BY v.date ASC
  `).all<GroupPayloadRow>();
  const active = rows.results ?? [];
  if (!active.length) return null;

  const signals = new Map<string, JsonRecord>();
  const chronicles = new Map<string, JsonRecord>();
  const members = new Map<string, {
    name: string;
    count: number;
    signals: number;
    activeDates: Set<string>;
    traits: Map<string, number>;
    role: string;
    roleScore: number;
    representative: JsonRecord | null;
    representativeTime: string;
    self: boolean;
  }>();
  const typeBreakdown = new Map<string, number>();
  let sourceMessages = 0;
  let acceptedMessages = 0;
  let excludedMessages = 0;
  let dateStart = "";
  let dateEnd = "";
  let generatedAt = "";

  for (const row of active) {
    const snapshot = record(parsePayload(row.payload));
    const group = record(snapshot?.group);
    const source = record(group?.source);
    const stats = record(group?.stats);
    const daySignals = Array.isArray(group?.signals) ? group.signals : null;
    const rawDayChronicles = Array.isArray(group?.chronicles) ? group.chronicles : null;
    const dayMembers = Array.isArray(group?.members) ? group.members : null;
    if (group?.version !== 3 || source?.group !== "【官方】DSH内测群" || !stats
      || !daySignals || !rawDayChronicles || !dayMembers) {
      throw new Error(`${row.date} 群聊展示数据不完整。`);
    }
    const dayChronicles = officialChronicles(rawDayChronicles);
    sourceMessages += nonnegativeInteger(stats.source_messages, `${row.date} source_messages`);
    acceptedMessages += nonnegativeInteger(stats.accepted_messages, `${row.date} accepted_messages`);
    excludedMessages += nonnegativeInteger(stats.excluded_messages, `${row.date} excluded_messages`);
    const start = String(stats.date_start ?? "");
    const end = String(stats.date_end ?? "");
    if (start && (!dateStart || start < dateStart)) dateStart = start;
    if (end && end > dateEnd) dateEnd = end;
    if (row.generated_at > generatedAt) generatedAt = row.generated_at;
    const breakdown = record(stats.type_breakdown);
    for (const [type, count] of Object.entries(breakdown ?? {})) {
      typeBreakdown.set(type, (typeBreakdown.get(type) ?? 0) + nonnegativeInteger(count, `${row.date} ${type}`));
    }

    daySignals.forEach((value, index) => {
      const item = record(value);
      if (item) signals.set(itemIdentity(item, row.date, index), item);
    });
    dayChronicles.forEach((value, index) => {
      const item = record(value);
      const key = item ? chronicleIdentity(item, row.date, index) : "";
      if (item && !chronicles.has(key)) chronicles.set(key, item);
    });
    dayMembers.forEach((value) => {
      const member = record(value);
      const name = String(member?.name ?? "").trim();
      if (!member || !name) throw new Error(`${row.date} 成员画像缺少名称。`);
      const count = nonnegativeInteger(member.count, `${row.date} ${name} count`);
      const signalCount = nonnegativeInteger(member.signals, `${row.date} ${name} signals`);
      const current = members.get(name) ?? {
        name,
        count: 0,
        signals: 0,
        activeDates: new Set<string>(),
        traits: new Map<string, number>(),
        role: "讨论参与者",
        roleScore: -1,
        representative: null,
        representativeTime: "",
        self: false,
      };
      current.count += count;
      current.signals += signalCount;
      current.activeDates.add(row.date);
      current.self ||= member.self === true;
      for (const trait of Array.isArray(member.traits) ? member.traits : []) {
        const label = String(trait ?? "").trim();
        if (label) current.traits.set(label, (current.traits.get(label) ?? 0) + Math.max(1, count));
      }
      const roleScore = signalCount * 1_000_000 + count;
      if (typeof member.role === "string" && member.role && roleScore > current.roleScore) {
        current.role = member.role;
        current.roleScore = roleScore;
      }
      const representative = record(member.representative);
      const representativeTime = String(representative?.time ?? "");
      if (representative && representativeTime >= current.representativeTime) {
        current.representative = representative;
        current.representativeTime = representativeTime;
      }
      members.set(name, current);
    });
  }

  const latestCompletedDate = active.at(-1)?.date ?? "";
  const liveRows = await env.QA_DB.prepare(`
    SELECT document_key, source_date, occurred_at, sender, content
    FROM qa_group_documents
    WHERE sync_id = (SELECT value FROM qa_corpus_meta WHERE key = 'active_group_sync_id' LIMIT 1)
      AND source_date > ?1
      AND sender IN ('Baymax', '崔小天')
      AND is_changelog = 1
    ORDER BY occurred_at ASC
  `).bind(latestCompletedDate).all<LiveChronicleRow>();
  const liveDates = new Set<string>();
  for (const row of liveRows.results ?? []) {
    const item = liveChronicle(row);
    if (!item) continue;
    const key = chronicleIdentity(item, row.source_date, 0);
    if (chronicles.has(key)) continue;
    chronicles.set(key, item);
    liveDates.add(row.source_date);
    if (row.occurred_at > dateEnd) dateEnd = row.occurred_at;
  }

  const signalList = [...signals.values()].sort(newestFirst);
  const chronicleList = [...chronicles.values()].sort(newestFirst);
  const memberList = [...members.values()].map((member) => {
    const traits = [...member.traits.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh"))
      .slice(0, 3).map(([trait]) => trait);
    const focus = traits.slice(0, 2).join("、") || "DSH 内测讨论";
    return {
      name: member.name,
      count: member.count,
      signals: member.signals,
      role: member.role,
      persona: `累计 ${member.activeDates.size} 个自然日发言 ${member.count} 条，${member.signals} 条进入精选；主要关注 ${focus}。`,
      traits,
      representative: member.representative,
      self: member.self,
      activeDays: member.activeDates.size,
    };
  }).sort((left, right) => right.count - left.count || right.signals - left.signals || left.name.localeCompare(right.name, "zh"));

  return {
    version: 1,
    scope: "all-active-group-days",
    group: "【官方】DSH内测群",
    timeZone: "Asia/Shanghai",
    dates: [...active.map((row) => row.date), ...liveDates].filter((date, index, dates) => dates.indexOf(date) === index),
    generatedAt,
    stats: {
      days: active.length,
      live_chronicle_dates: liveDates.size,
      source_messages: sourceMessages,
      accepted_messages: acceptedMessages,
      excluded_messages: excludedMessages,
      signal_count: signalList.length,
      participant_count: memberList.length,
      chronicle_count: chronicleList.length,
      date_start: dateStart,
      date_end: dateEnd,
      type_breakdown: Object.fromEntries(typeBreakdown),
    },
    signals: signalList,
    chronicles: chronicleList,
    members: memberList,
  };
}

export async function contentGithubSource(
  env: ContentRuntimeEnv,
  source: "issues" | "repos",
): Promise<unknown | null> {
  const row = await activeSource(env.CONTENT_DB, source, true);
  const inline = parsePayload(row?.payload);
  if (!row || !inline || typeof inline !== "object" || !(inline as { chunked?: boolean }).chunked) return inline;
  const chunks = await env.CONTENT_DB.prepare(`
    SELECT payload FROM content_source_chunks
    WHERE source = ?1 AND sync_id = ?2
    ORDER BY chunk_index
  `).bind(source, row.sync_id).all<{ payload: string }>();
  return parsePayload((chunks.results ?? []).map((chunk) => chunk.payload).join(""));
}

export async function contentStatus(env: ContentRuntimeEnv): Promise<Record<string, unknown>> {
  const manifest = await contentManifest(env);
  return {
    ready: Boolean(manifest),
    storage: "CONTENT_DB",
    manifest,
  };
}
