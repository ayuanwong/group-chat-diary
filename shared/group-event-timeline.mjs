const OFFICIAL_SENDERS = new Set(["Baymax", "崔小天", "少女阿原"]);
const SEGMENTER = new Intl.Segmenter("zh-CN", { granularity: "word" });

const STOP_WORDS = new Set(`
  这个 那个 这里 那里 现在 今天 昨天 明天 大家 我们 你们 他们 自己 我的 你的 他的 她的
  可以 可能 觉得 感觉 其实 就是 还是 已经 没有 一个 一下 这么 那么 怎么 什么 为什么
  然后 如果 因为 所以 但是 而且 不是 真的 比较 需要 应该 时候 目前 最近 看到 发现
  进行 使用 东西 事情 这样 那样 起来 出来 知道 认为 说的 还有 只是 不过 非常 确实
  直接 这种 那种 有点 一直 继续 之前 之后 上面 下面 里面 这边 那边 估计 好像 貌似
  所有 开始 能够 不能 以及 对于 关于 通过 由于 其中 然而 另外 基本 是否 有人 一天
  一次 各位 这次 一辈子 荣幸 参与 最后 最好的 别的 太强 真的 不会 也是 都是 做的
  是不是 看看 不知道 我是 我也 能不能 只能 不要 老师 个人 一点 一样 难道 再来 剩下
  下次 几个 很多 的话 我去 我还 就好 说话 正在 都没 收到 欢迎 谢谢 哈哈 哈哈哈 笑死
  回复 引用 图片 视频 文件 表情 链接 网页消息 小程序 语音 系统消息 撤回消息 拍一拍
  消息 同步转发 记录 微信引用内容已隐去 local_id
  我 是 的 了 在 和 也 有 都 就 不 人 会 吗 呢 啊 哦 嗯 吧 呀 被 把 给 到 与 及 或 而
  但 很 更 最 再 才 又 还 让 从 对 里 上 下 中 后 前 过 着 看 做 用 来 去 好 行 要 能 没
  得 多 少 发
  the a an is are was were be been and or but to of for from with without on in at by as it its
  this that these those i me my we our you your he she they them yes no not can could would should
  may might will just really very more most less much many some any all one new old good bad done
  doing make made get got have has had what why how when where who which
`.trim().split(/\s+/u));

const LOW_QUALITY_ANCHORS = new Set(`
  一些 有了 哪里 文字 遇到 麻烦 晚上 早上 中午 凌晨 时候 目前 之前 之后 部分 其他 这些 那些
  差不多 如何 我在 我想 我们的 你们的 说的 做了 做个 写个 看下 看看 确认 出现 变成 我吗
  玩意 东西 情况 有意思 不错 挺好 很好 太好 太高 急需 居然 居然是 的确 仍然 重新 感谢
  流泪 可爱 得意 羡慕 笑死 黑鱼 蓝鲸 老师 同学 兄弟 姐姐 少女 咱们 一手 意识 翻天
  明明是 分钟 忠心耿耿 话说 踢了 本次 定位 大权 解放 奉献 高楼 写过 盲目 计算 想法
  多次 经过 最有 价值 第三 帮忙 教教 把握 毕竟 仍有 一名 无名 小卒
`.trim().split(/\s+/u));

const BROAD_ANCHORS = new Set(`
  dsh deepseek deepseek-harness harness agent agents ai 模型 model models llm 代码 code 项目 project
  问题 用户 user users 支持 发布 release 更新 update 版本 version 效果 时间 工作 开发 github 官方
  pro ds 信息 定义 公司 社区 功能 方案 数据
`.trim().split(/\s+/u));

const ACTION_WORDS = new Set(`
  发布 上线 推出 开放 推送 更新 升级 新增 修复 优化 调整 合并 同步 启用 停用 恢复 迁移
  测试 实测 试用 体验 评测 benchmark 问题 报错 失败 崩溃 闪退 卡顿 超时 无法 故障
  计划 安排 准备 预计 后续 讨论 认为 观点 分享 推荐 教程 资料
`.trim().split(/\s+/u));

const DISPLAY_ALIASES = new Map([
  ["api", "API"], ["cli", "CLI"], ["tui", "TUI"], ["ui", "UI"], ["mcp", "MCP"],
  ["github", "GitHub"], ["npm", "npm"], ["uv", "UV"], ["gpt", "GPT"], ["ai", "AI"],
  ["plugin", "插件"], ["plugins", "插件"], ["repo", "仓库"], ["repos", "仓库"],
  ["repository", "仓库"], ["repositories", "仓库"], ["model", "模型"], ["models", "模型"],
  ["llm", "模型"], ["issues", "Issue"], ["issue", "Issue"], ["skills", "Skill"], ["skill", "Skill"],
  ["pro", "DeepSeek V4 Pro"], ["v4 pro", "DeepSeek V4 Pro"], ["v4pro", "DeepSeek V4 Pro"],
  ["deepseek v4 pro", "DeepSeek V4 Pro"],
]);

const RELEASE = /发布|发版|上线|推出|开放|推送|更新版本|新版本|release(?:d)?|正式版|production|现已|可(?:调用|使用)|接口.{0,12}(?:开放|可用)|api.{0,12}(?:开放|可用)/iu;
const COMPLETED_RELEASE = /(?:已(?:经)?|现已|刚刚|正式).{0,24}(?:发布|发版|上线|推出|开放|推送|更新)|(?:发布|发版|上线|推出|开放|推送|更新)(?:了|完成|成功)|(?:api|接口).{0,12}(?:已开放|可调用|可用)/iu;
const TESTING = /试用|体验|测试|实测|评测|benchmark|效果|能力|速度|延迟|调用|api|token|推理|代码能力|coding/iu;
const INCIDENT = /bug|报错|失败|崩溃|闪退|卡死|卡顿|超时|无法|不能用|不工作|故障|异常|兼容.{0,8}(?:问题|失败)|内存.{0,8}(?:爆|高)/iu;
const PLAN = /计划|预计|将于|准备|接下来|后续|定于|暂定|今夜|今晚|明天|明日|次日|翌日/iu;
const DEVELOPMENT = /开发|代码|实现|插件|plugin|仓库|repo|fork|git|npm|编译|配置|安装|环境|api|cli|tui|ui|mcp|协议|接口/iu;
const NEWS = /新闻|报道|媒体|热搜|政策|时事|消息称|宣布|裁员|收购|融资|监管/iu;
const SHARING = /分享|推荐|教程|资料|论文|开源|仓库|链接|项目|工具/iu;
const DEBATE = /争议|反对|同意|不同观点|怎么看|是否|应该|不该|值不值|为什么|能不能|可以吗|[?？]/iu;
const CLOSURE = /内测|最后|结束|收官|解散|告别|感谢|荣幸|参与|回顾|纪念|合影|保密期/iu;
const RELAY = /#接龙|接龙/iu;
const QUESTION_OR_UNCERTAIN = /[?？]|为什么|怎么|如何|能否|是否|是不是|有没有|听说|据说|貌似|猜测|可能|也许|好像|感觉/iu;
const RELEASE_HEARSAY = /听说|据说|貌似|猜测|可能|也许|好像|感觉|传闻|真(?:的)?(?:来了|发了|出了)|是不是|了吗|没有|别更新/iu;
const FINAL_RELEASE = /(?:最后|最终|收官).{0,28}(?:内测|版本|发版|发布)|(?:内测|版本|发版|发布).{0,28}(?:最后|最终|收官)/iu;
const PUBLIC_RELEASE = /公测|公开|对外|正式.{0,16}(?:发布|上线|开放)|(?:发布|上线|开放).{0,16}正式/iu;
const DSH_SUBJECT = /deepseek\s+harness|(?:^|[^a-z0-9])dsh(?:2026|-external)?(?:$|[^a-z0-9])/iu;

const FOCUS_RULES = [
  ["速度与延迟", /速度|延迟|token\/s|tokens?\s*per|快|慢/iu],
  ["额度与价格", /额度|价格|涨价|计费|费用|成本|token\s*(?:额度|消耗)/iu],
  ["API 与调用", /api|responses?\s*api|接口|调用|curl|endpoint/iu],
  ["版本与指纹", /版本|fingerprint|tag|snapshot|build|081\d/iu],
  ["安装与环境", /安装|环境|依赖|conda|venv|python|npm|pnpm|uv/iu],
  ["Windows 兼容", /windows|win\d*|wsl|powershell|pwsh/iu],
  ["插件兼容", /插件|plugin|skill|mcp|适配|兼容/iu],
  ["仓库与公开", /仓库|repo|github|fork|开源|公开/iu],
  ["能力与评测", /能力|评测|benchmark|测试|实测|效果|coding|推理/iu],
  ["保密与访问", /保密|泄密|泄露|访问|邀请|权限|水印/iu],
];

function oneLine(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function authoredText(value) {
  return String(value ?? "").split("↳ 回复", 1)[0].trim();
}

function replyText(value) {
  const text = String(value ?? "");
  const index = text.indexOf("↳ 回复");
  if (index < 0) return "";
  return text.slice(index).replace(/^↳ 回复\s+[^:：]{0,80}[:：]?\s*/u, "").trim();
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
  return { timestamp, date: match[1], clock: `${match[2]}:${match[3]}`, epoch };
}

function normalizeToken(value) {
  const raw = oneLine(value).toLowerCase().replace(/^[#@_\-./]+|[#@_\-./]+$/gu, "");
  if (!raw) return null;
  const alias = DISPLAY_ALIASES.get(raw);
  return alias?.toLowerCase() ?? raw;
}

function displayToken(token, surface = "") {
  const alias = DISPLAY_ALIASES.get(token)?.trim();
  if (alias) return alias;
  const compact = oneLine(surface);
  if (compact && /^[\p{L}\p{N}][\p{L}\p{N}._ +#/-]{0,35}$/u.test(compact)) return compact;
  if (/^[a-z][a-z0-9._+-]{1,30}$/u.test(token)) return token;
  return token;
}

function canonicalEntityTokens(text) {
  const entities = new Map();
  if (/(?:deepseek[-_\s]*)?v\s*4[-_\s]*pro|\bv4pro\b/iu.test(text)) entities.set("pro", "DeepSeek V4 Pro");
  if (/deepseek\s+harness|\bdsh(?:2026|-external)?\b/iu.test(text)) entities.set("deepseek harness", "DeepSeek Harness");
  return entities;
}

function usefulToken(token) {
  if (!token || STOP_WORDS.has(token)) return false;
  if (/^(?:local[_-]?id|0x[\da-f]+|[\da-f]{12,}|\d+(?:\.\d+)*)$/iu.test(token)) return false;
  if (/^[\p{Script=Han}]+$/u.test(token)) return Array.from(token).length >= 2;
  if (/^[a-z]$/u.test(token)) return false;
  return Array.from(token).length >= 2 && Array.from(token).length <= 36;
}

function topicText(value) {
  return String(value ?? "")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/@[\p{L}\p{N}_-]+/gu, " ")
    .replace(/^\s*\[(?:图片|视频|语音|表情|链接\/文件)\]\s*/iu, "")
    .replace(/\[微信引用内容已隐去\]/gu, " ")
    .replace(/\blocal[_-]?id\b[^\s，。；]*/giu, " ");
}

function extractedTokens(value) {
  const original = String(value ?? "");
  const relay = original.match(/#接龙\s+([\p{L}\p{N}_.-]{2,36})/iu);
  if (relay) {
    const subject = normalizeToken(relay[1]);
    const relayTokens = new Map([["接龙", "接龙"]]);
    if (usefulToken(subject)) relayTokens.set(subject, relay[1]);
    return relayTokens;
  }
  const cleaned = topicText(original);
  if (!oneLine(cleaned)) return new Map();
  const tokens = new Map();
  for (const [token, surface] of canonicalEntityTokens(cleaned)) tokens.set(token, surface);
  for (const segment of SEGMENTER.segment(cleaned)) {
    if (!segment.isWordLike) continue;
    const token = normalizeToken(segment.segment);
    if (usefulToken(token)) tokens.set(token, segment.segment);
  }
  for (const match of cleaned.matchAll(/#([\p{L}\p{N}_.-]{2,36})/giu)) {
    const token = normalizeToken(match[1]);
    if (usefulToken(token)) tokens.set(token, match[1]);
  }
  for (const match of cleaned.matchAll(/\b[A-Za-z][A-Za-z0-9._+-]*(?:[ \t]+[A-Za-z][A-Za-z0-9._+-]*){1,3}\b/gu)) {
    const parts = match[0].split(/\s+/u);
    if (parts.every((part) => STOP_WORDS.has(part.toLowerCase()))) continue;
    const token = normalizeToken(match[0]);
    if (usefulToken(token) && !BROAD_ANCHORS.has(token)) tokens.set(token, match[0]);
  }
  return tokens;
}

function normalizeRecord(row, index) {
  const time = parsedTime(row?.timestamp ?? row?.occurred_at);
  const sender = oneLine(row?.sender);
  const text = String(row?.text ?? row?.content ?? "");
  if (!time || !sender || !text || row?.side === "system") return null;
  const authored = authoredText(text);
  const own = extractedTokens(authored);
  const quoted = extractedTokens(replyText(text));
  const tokens = new Set([...own.keys(), ...quoted.keys()]);
  const surfaces = new Map([...quoted, ...own]);
  return {
    id: String(row?.id ?? row?.message_id ?? row?.document_key ?? `${time.timestamp}:${index}`),
    sender,
    text,
    authored,
    messageType: oneLine(row?.messageType ?? row?.message_type),
    time,
    ownTokens: new Set(own.keys()),
    tokens,
    surfaces,
  };
}

function quotedEvidence(records, maximum = 3) {
  const ranked = [...records].filter((record) => record.authored && !/#接龙|local[_-]?id/iu.test(record.authored))
    .sort((left, right) => {
      const score = (record) => Number(COMPLETED_RELEASE.test(record.authored)) * 9
        + Number(TESTING.test(record.authored)) * 4
        + Number(INCIDENT.test(record.authored)) * 4
        + Number(DEVELOPMENT.test(record.authored)) * 2
        + Math.min(4, Math.floor(Array.from(record.authored).length / 28));
      return score(right) - score(left) || left.time.timestamp.localeCompare(right.time.timestamp);
    });
  const result = [];
  const senders = new Set();
  const evidence = new Set();
  for (const record of ranked) {
    if (result.length >= maximum) break;
    const quote = sanitizeEvidence(record.authored);
    const key = quote.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 120);
    if (!quote || Array.from(quote).length < 8 || senders.has(record.sender) || evidence.has(key)) continue;
    result.push({ sender: record.sender, time: record.time.clock, quote });
    senders.add(record.sender);
    evidence.add(key);
  }
  return result;
}

function termStatistics(records) {
  const terms = new Map();
  for (const record of records) {
    for (const token of record.tokens) {
      if (!terms.has(token)) terms.set(token, { token, records: [], speakers: new Set(), surfaces: new Map() });
      const term = terms.get(token);
      term.records.push(record);
      term.speakers.add(record.sender);
      const surface = record.surfaces.get(token) ?? token;
      term.surfaces.set(surface, (term.surfaces.get(surface) ?? 0) + 1);
    }
  }
  return terms;
}

function preferredSurface(term) {
  const surface = [...term.surfaces].sort((left, right) => right[1] - left[1]
    || right[0].length - left[0].length || left[0].localeCompare(right[0], "zh"))[0]?.[0] ?? term.token;
  return displayToken(term.token, surface);
}

function canonicalLabelKey(value) {
  return oneLine(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function uniqueTopicLabels(labels) {
  const result = [];
  const keys = [];
  for (const label of labels) {
    const key = canonicalLabelKey(label);
    if (!key || keys.some((previous) => previous === key
      || (previous.length >= 3 && (previous.includes(key) || key.includes(previous))))) continue;
    result.push(label);
    keys.push(key);
  }
  return result;
}

function candidateAnchor(term, recordCount) {
  if (!term || BROAD_ANCHORS.has(term.token) || ACTION_WORDS.has(term.token) || LOW_QUALITY_ANCHORS.has(term.token)) return false;
  const minimum = recordCount < 40 ? 2 : Math.max(3, Math.ceil(Math.sqrt(recordCount) / 30));
  if (term.speakers.size < 3 || term.records.length < minimum) return false;
  if (recordCount >= 40 && term.records.length > recordCount * 0.18) return false;
  if (/^(?:接龙|and|with|from|only|like|about|then|it's|that's|really|maybe|please)$/iu.test(term.token)) return false;
  return true;
}

function splitTermEpisodes(records, recordCount) {
  const gapMinutes = recordCount >= 5_000 ? 22 : recordCount >= 1_000 ? 35 : 75;
  const maximumMinutes = recordCount >= 5_000 ? 85 : recordCount >= 1_000 ? 120 : 210;
  const episodes = [];
  for (const record of records) {
    const current = episodes.at(-1);
    const gap = current ? record.time.epoch - current.at(-1).time.epoch : Number.POSITIVE_INFINITY;
    const span = current ? record.time.epoch - current[0].time.epoch : 0;
    if (!current || gap > gapMinutes * 60_000 || span > maximumMinutes * 60_000) episodes.push([record]);
    else current.push(record);
  }
  return episodes;
}

function recordSetSimilarity(left, right) {
  const a = left instanceof Set ? left : new Set(left);
  const b = right instanceof Set ? right : new Set(right);
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

function coTerms(seed, episode, terms) {
  const counts = new Map();
  const speakers = new Map();
  for (const record of episode) {
    for (const token of record.tokens) {
      if (token === seed || BROAD_ANCHORS.has(token) || ACTION_WORDS.has(token) || STOP_WORDS.has(token)
        || LOW_QUALITY_ANCHORS.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
      if (!speakers.has(token)) speakers.set(token, new Set());
      speakers.get(token).add(record.sender);
    }
  }
  const minimum = Math.max(2, Math.ceil(episode.length * 0.16));
  return [...counts].filter(([, count]) => count >= minimum)
    .map(([token, count]) => {
      const global = terms.get(token)?.records.length ?? count;
      const people = speakers.get(token)?.size ?? 0;
      return { token, count, people, score: count * Math.log2(people + 1) * Math.log2((episode.length + 2) / (global + 1) + 1) };
    })
    .filter((item) => item.people >= 2)
    .sort((left, right) => right.score - left.score || right.count - left.count || left.token.localeCompare(right.token, "zh"))
    .slice(0, 3);
}

function cueNearSubject(record, subjectToken, pattern) {
  if (!record.ownTokens.has(subjectToken) || !pattern.test(record.authored)) return false;
  if (Array.from(record.authored).length <= 150) return true;
  const surface = oneLine(record.surfaces.get(subjectToken) ?? subjectToken).toLowerCase();
  return record.authored.split(/[。！？!?；;\n]+/u).some((clause) => {
    const compact = clause.toLowerCase();
    return compact.includes(surface) && pattern.test(clause);
  });
}

function cueProfile(records, subjectToken) {
  const matching = (pattern) => records.filter((record) => cueNearSubject(record, subjectToken, pattern));
  const count = (pattern) => matching(pattern).length;
  const speakers = (pattern) => new Set(matching(pattern).map((record) => record.sender)).size;
  const releaseAssertions = records.filter((record) => cueNearSubject(record, subjectToken, COMPLETED_RELEASE)
    && !QUESTION_OR_UNCERTAIN.test(record.authored) && !RELEASE_HEARSAY.test(record.authored));
  const officialRelease = releaseAssertions.some((record) => OFFICIAL_SENDERS.has(record.sender));
  return {
    release: releaseAssertions.length >= 2 || officialRelease,
    releaseCount: releaseAssertions.length,
    incident: count(INCIDENT) >= 2 && speakers(INCIDENT) >= 2,
    testing: count(TESTING) >= 2 && speakers(TESTING) >= 2,
    plan: count(PLAN) >= 2 && speakers(PLAN) >= 2,
    development: count(DEVELOPMENT) >= 2,
    news: count(NEWS) >= 2,
    sharing: count(SHARING) >= 2,
    debate: count(DEBATE) >= 2,
    closure: records.filter((record) => CLOSURE.test(record.authored)).length >= 3
      && new Set(records.filter((record) => CLOSURE.test(record.authored)).map((record) => record.sender)).size >= 3,
    relay: count(RELAY) >= 2,
  };
}

function joinLabels(labels) {
  const unique = [...new Set(labels.filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? "相关议题";
  if (unique.length === 2) return `${unique[0]}与${unique[1]}`;
  return `${unique.slice(0, -1).join("、")}与${unique.at(-1)}`;
}

function extractiveHeadline(records, subjectToken, profile) {
  const ranked = records.filter((record) => record.ownTokens.has(subjectToken) && record.authored && !/#接龙/iu.test(record.authored))
    .map((record) => {
      let text = sanitizeEvidence(record.authored, 90)
        .replace(/^\[(?:链接\/文件|图片|视频|语音|表情)\]\s*/u, "")
        .replace(/^@[^\s，。；:：]+\s*/u, "")
        .replace(/^[)）\]】}\s]+/u, "")
        .replace(/^(?:我觉得|感觉|其实|就是说|所以|然后|不过|但是|话说|看到|听说)\s*/u, "")
        .split(/[。！!；;\n]/u, 1)[0].trim();
      if (Array.from(text).length > 42) text = `${Array.from(text).slice(0, 41).join("")}…`;
      const length = Array.from(text).length;
      const externalAnnouncement = /^\[链接\]/u.test(text) || /我发布了一篇|笔记|博客|自媒体/iu.test(record.authored);
      const score = Number(COMPLETED_RELEASE.test(record.authored) && !QUESTION_OR_UNCERTAIN.test(record.authored)
        && !RELEASE_HEARSAY.test(record.authored) && !externalAnnouncement) * 14
        + Number(INCIDENT.test(record.authored)) * 8 + Number(PLAN.test(record.authored)) * 6
        + Number(NEWS.test(record.authored)) * 5 + Number(SHARING.test(record.authored)) * 3
        + Number(length >= 10 && length <= 34) * 4 + Number(QUESTION_OR_UNCERTAIN.test(record.authored)) * -3
        + Number(externalAnnouncement) * -20;
      return { text, score, length, externalAnnouncement };
    }).filter((item) => item.length >= 8 && item.length <= 50)
    .sort((left, right) => right.score - left.score || Math.abs(left.length - 24) - Math.abs(right.length - 24));
  const headline = ranked[0]?.text ?? "";
  if (!headline) return null;
  if (profile.release && COMPLETED_RELEASE.test(headline) && !QUESTION_OR_UNCERTAIN.test(headline) && !RELEASE_HEARSAY.test(headline)
    && !ranked[0]?.externalAnnouncement) return headline;
  if (profile.news && NEWS.test(headline)) return headline;
  return null;
}

function releaseMilestone(records, subjectToken) {
  const explicit = records.find((record) => record.ownTokens.has(subjectToken)
    && COMPLETED_RELEASE.test(record.authored) && !QUESTION_OR_UNCERTAIN.test(record.authored)
    && !RELEASE_HEARSAY.test(record.authored)
    && !/^\[链接\/文件\]|我发布了一篇|笔记|博客|自媒体/iu.test(record.authored));
  return explicit ?? null;
}

function focusLabels(records, maximum = 2) {
  return FOCUS_RULES.map(([label, pattern], index) => ({
    label,
    index,
    count: records.filter((record) => pattern.test(record.authored)).length,
    people: new Set(records.filter((record) => pattern.test(record.authored)).map((record) => record.sender)).size,
  })).filter((item) => item.count >= 2 && item.people >= 2)
    .sort((left, right) => right.count - left.count || right.people - left.people || left.index - right.index)
    .slice(0, maximum).map((item) => item.label);
}

function narrativeTitle(labels, profile, records, subjectToken) {
  const subject = labels[0] ?? "相关议题";
  const focus = focusLabels(records);
  const focusText = joinLabels(focus);
  const extracted = extractiveHeadline(records, subjectToken, profile);
  if (extracted && Array.from(extracted).length <= 30) return extracted;
  if (profile.relay) return `${subject}接龙集中进行`;
  const contextualClosure = CLOSURE.test(records.map((record) => record.authored).join(" "));
  if (/组织|解散/iu.test(records.map((record) => record.authored).join(" ")) && /组织|解散/u.test(subject)) {
    return "内测群收官、组织安排与公开边界成为焦点";
  }
  const closureSubject = contextualClosure && (subjectToken === "pro" || subjectToken === "deepseek harness"
    || /dsh|harness|内测|公测|组织|解散|群/u.test(subject));
  if (closureSubject) return `${subject}内测收官与后续安排成为焦点`;
  if (profile.closure) return `内测收官、${subject}与后续安排成为焦点`;
  if (profile.release) return `${subject}发布后，群内集中讨论${focus.length ? focusText : "实际影响"}`;
  if (profile.incident) return `${subject}${focus.length ? `与${focusText}` : ""}的问题被集中复现`;
  if (profile.testing) return `成员集中实测${subject}${focus.length ? `，重点比较${focusText}` : ""}`;
  if (profile.plan) return `${subject}${focus.length ? `与${focusText}` : ""}的后续安排展开讨论`;
  if (profile.development) return `${subject}${focus.length ? `与${focusText}` : ""}的实现方案进入集中交流`;
  if (profile.news) return `${subject}${focus.length ? `与${focusText}` : ""}相关消息引发群内讨论`;
  if (profile.sharing) return `${subject}${focus.length ? `与${focusText}` : ""}的资料和实践被集中分享`;
  if (profile.debate) return `${subject}${focus.length ? `与${focusText}` : ""}引发不同观点`;
  return `${subject}${focus.length ? `与${focusText}` : ""}成为当时段主议题`;
}

function believableTitle(title, labels) {
  const subject = labels[0] ?? "相关议题";
  if (/^(?:成员集中实测|相关议题|咱们|明明是|本次|人员|组织|填写|翻天|意识|一些|有了)/u.test(title)
    && !/[A-Za-z0-9]/u.test(subject)) return `${joinLabels(labels.slice(0, 3))}成为当时段主议题`;
  return title;
}

function dominantLabels(records, excluded, terms, maximum = 2) {
  const counts = new Map();
  const speakers = new Map();
  for (const record of records) {
    for (const token of record.tokens) {
      if (excluded.has(token) || BROAD_ANCHORS.has(token) || ACTION_WORDS.has(token) || STOP_WORDS.has(token)
        || LOW_QUALITY_ANCHORS.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
      if (!speakers.has(token)) speakers.set(token, new Set());
      speakers.get(token).add(record.sender);
    }
  }
  return [...counts].map(([token, count]) => ({ token, count, people: speakers.get(token).size }))
    .filter((item) => item.count >= 2 && item.people >= 2)
    .sort((left, right) => right.count * Math.log2(right.people + 1) - left.count * Math.log2(left.people + 1)
      || left.token.localeCompare(right.token, "zh"))
    .slice(0, maximum).map((item) => preferredSurface(terms.get(item.token) ?? { token: item.token, surfaces: new Map() }));
}

function communityCandidate(seedTerm, episode, allRecords, terms, date) {
  const speakers = new Set(episode.map((record) => record.sender));
  const minimum = allRecords.length < 40 ? 2 : Math.max(3, Math.ceil(Math.sqrt(allRecords.length) / 30));
  if (episode.length < minimum || speakers.size < 3) return null;
  const relatedTerms = coTerms(seedTerm.token, episode, terms);
  const tokenKeys = [seedTerm.token, ...relatedTerms.slice(0, 2).map((item) => item.token)];
  const firstEpoch = episode[0].time.epoch;
  const lastEpoch = episode.at(-1).time.epoch;
  const secondary = tokenKeys.slice(1);
  const related = allRecords.filter((record) => record.time.epoch >= firstEpoch - 4 * 60_000
    && record.time.epoch <= lastEpoch + 4 * 60_000
    && (record.tokens.has(seedTerm.token)
      || (secondary.length >= 2 && secondary.filter((token) => record.tokens.has(token)).length >= 2)))
    .sort((left, right) => left.time.timestamp.localeCompare(right.time.timestamp) || left.id.localeCompare(right.id));
  const relatedSpeakers = new Set(related.map((record) => record.sender));
  if (related.length < minimum || relatedSpeakers.size < 3) return null;

  let labels = uniqueTopicLabels(tokenKeys.map((token) => preferredSurface(terms.get(token) ?? { token, surfaces: new Map() })));
  const profile = cueProfile(related, seedTerm.token);
  const closureSubject = profile.closure && (seedTerm.token === "pro" || seedTerm.token === "deepseek harness"
    || /dsh|harness|内测|公测|组织|群/iu.test(labels[0] ?? ""));
  if (profile.closure && !closureSubject && terms.has("deepseek harness")) {
    labels = uniqueTopicLabels(["DeepSeek Harness", ...labels]);
  }
  const titleSubjectToken = profile.closure && !closureSubject && terms.has("deepseek harness")
    ? "deepseek harness" : seedTerm.token;
  const title = believableTitle(narrativeTitle(labels, profile, related, titleSubjectToken), labels);
  const releaseRecord = profile.release ? releaseMilestone(related, seedTerm.token) : null;
  const midpoint = Math.floor(related.length / 2);
  const excluded = new Set(tokenKeys);
  const early = dominantLabels(related.slice(0, Math.max(2, midpoint)), excluded, terms);
  const late = dominantLabels(related.slice(midpoint), excluded, terms);
  const start = related[0];
  const end = related.at(-1);
  const shifted = early.length && late.length && !early.some((label) => late.includes(label));
  const summary = shifted
    ? `${start.time.clock} 起，讨论从${joinLabels(early)}延伸到${joinLabels(late)}；核心议题是${joinLabels(labels)}，共有 ${related.length} 条直接相关发言、${relatedSpeakers.size} 位成员参与。`
    : `${start.time.clock}–${end.time.clock}，群内围绕${joinLabels(labels)}连续交流，共有 ${related.length} 条直接相关发言、${relatedSpeakers.size} 位成员参与。`;
  const type = profile.release ? "release" : profile.incident ? "incident" : profile.testing ? "testing"
    : profile.plan ? "plan" : profile.development ? "development" : profile.news ? "news"
      : profile.sharing ? "sharing" : profile.closure ? "closure" : profile.relay ? "participation"
        : profile.debate ? "discussion" : "topic";
  const milestones = [{
    time: releaseRecord?.time.clock ?? start.time.clock,
    label: releaseRecord ? `${labels[0]}发布得到确认` : `${labels[0]}讨论形成`,
    detail: releaseRecord ? sanitizeEvidence(releaseRecord.authored, 100) : `相关发言开始连续出现，重点涉及${joinLabels(labels.slice(1))}`,
  }];
  if (end.time.clock !== start.time.clock) {
    milestones.push({ time: end.time.clock, label: "本轮讨论结束", detail: shifted ? `议题延伸到${joinLabels(late)}` : `相关交流持续至 ${end.time.clock}` });
  }
  const concentration = episode.length / Math.max(1, seedTerm.records.length);
  const rarity = Math.log2((allRecords.length + 1) / (seedTerm.records.length + 1));
  const topicQuality = /^[a-z][a-z0-9._ +#/-]*$/iu.test(seedTerm.token)
    ? (/[\d +#._-]/u.test(seedTerm.token) ? 1.45 : 1.1)
    : Math.min(1.35, 0.9 + Array.from(seedTerm.token).length * 0.12);
  const score = Math.sqrt(episode.length) * Math.log2(relatedSpeakers.size + 1)
    * (0.8 + concentration) * Math.max(1, rarity) * topicQuality;
  return {
    id: `group-event:${date}:topic:${stableId(`${seedTerm.token}:${start.id}:${end.id}`)}`,
    date,
    timestamp: start.time.timestamp,
    endTimestamp: end.time.timestamp,
    timeRange: start.time.clock === end.time.clock ? `${date} · ${start.time.clock}` : `${date} · ${start.time.clock}–${end.time.clock}`,
    eventType: type,
    status: "observed",
    title,
    summary,
    relatedMessageCount: related.length,
    speakerCount: relatedSpeakers.size,
    topics: labels.slice(0, 4),
    milestones,
    quotes: quotedEvidence(related),
    evidenceBoundary: "当日全部群聊中按议题与时间聚合的直接相关发言",
    score,
    seed: seedTerm.token,
    messageIds: new Set(related.map((record) => record.id)),
    tokenKeys: new Set(tokenKeys),
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
    const value = new Date(`${sourceDate}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
  }
  return null;
}

function officialSubject(evidence) {
  if (DSH_SUBJECT.test(evidence)) return "DSH";
  if (/(?:deepseek[-_\s]*)?v\s*4[-_\s]*pro|\bv4pro\b/iu.test(evidence)) return "DeepSeek V4 Pro";
  if (/npm_token|npmjs|@deepseek-ai\/dsh|npm\s*(?:包|发版)/iu.test(evidence)) return "DSH npm 包";
  if (/issues?\s*repo|discussions?|必修的问题/iu.test(evidence)) return "DSH Issues 讨论区";
  if (/私有仓库|github\s*repo|内测版代码|内测须知/iu.test(evidence)) return "DSH 内测仓库";
  const tokens = extractedTokens(evidence);
  const candidates = [...tokens].filter(([token]) => !BROAD_ANCHORS.has(token) && !ACTION_WORDS.has(token));
  return candidates.length ? displayToken(candidates[0][0], candidates[0][1]) : "官方信息";
}

function officialTitle(item, evidence, subject) {
  const status = oneLine(item?.status) || "announced";
  const type = oneLine(item?.event_type) || "announcement";
  const changelog = evidence.match(/changelog\s+(\d{4}-\d{2}-\d{2})/iu)?.[1];
  if (changelog) return subject === "Changelog" ? `DSH Changelog ${changelog} 发布` : `${subject} Changelog ${changelog} 发布`;
  if (type === "plan" || status === "planned") return `${subject}后续安排明确`;
  if (/访问权限|邀请|名单|门禁/iu.test(evidence) && /已(?:经)?邀请|推送.{0,18}邀请/iu.test(evidence)) return `${subject}访问邀请已更新`;
  if (/访问权限|名单|门禁/iu.test(evidence)) return `${subject}访问规则调整`;
  if (/活动|招募|征集|投票|截止/iu.test(evidence)) return `${subject}活动与参与安排公布`;
  if (/discussions?|讨论区/iu.test(evidence)) return `${subject}开放`;
  if (/仓库|github|repo|插件|plugin|skill|mcp/iu.test(evidence) && type === "repository") return `${subject}信息发布`;
  if (/npm_token|npmjs|@deepseek-ai\/dsh|npm\s*(?:包|发版)/iu.test(evidence)) return `${subject}使用方式公布`;
  if (/开源/iu.test(evidence)) return `${subject}开源信息发布`;
  if (type === "release" && status === "completed" && /(?:版本|tag|snapshot|推送)/iu.test(evidence)) return `${subject}版本更新完成`;
  if (type === "release" && status === "completed") return `${subject}发布完成`;
  if (type === "release") return `${subject}版本信息发布`;
  if (type === "notice") return `${subject}规则与服务通知`;
  return `${subject}正式信息发布`;
}

function relatedOfficialRecords(item, records, evidence) {
  const timestamp = parsedTime(item?.timestamp ?? item?.time);
  if (!timestamp) return [];
  const subjectTokens = new Set(extractedTokens(evidence).keys());
  return records.filter((record) => {
    const distance = record.time.epoch - timestamp.epoch;
    if (distance < -5 * 60_000 || distance > 15 * 60_000) return false;
    if (OFFICIAL_SENDERS.has(record.sender)) return true;
    let overlap = 0;
    for (const token of record.tokens) if (subjectTokens.has(token)) overlap += 1;
    return overlap >= 1 || RELEASE.test(record.authored) || PLAN.test(record.authored);
  });
}

function officialEvent(item, records, date, index) {
  const time = parsedTime(item?.timestamp ?? String(item?.time ?? "").replace(" ", "T"));
  if (!time || time.date !== date) return null;
  const evidence = oneLine([item?.quote, item?.detail].filter(Boolean).join(" "));
  const quote = sanitizeEvidence(item?.quote ?? item?.detail, 220);
  const status = oneLine(item?.status) || "announced";
  const finalRelease = DSH_SUBJECT.test(evidence) && FINAL_RELEASE.test(evidence);
  const publicRelease = DSH_SUBJECT.test(evidence) && PUBLIC_RELEASE.test(evidence);
  const releaseDate = explicitCalendarDate(evidence, date);
  const related = relatedOfficialRecords(item, records, evidence);
  const speakers = new Set(related.map((record) => record.sender));
  const subject = officialSubject(evidence);
  let title = officialTitle(item, evidence, subject);
  let summary = status === "completed" ? `官方确认已经完成：${quote}`
    : status === "planned" ? `官方明确了后续安排：${quote}`
      : `官方发布了正式信息：${quote}`;
  let topics = [subject, status === "planned" ? "后续安排" : status === "completed" ? "已完成" : "正式信息"];
  let milestones = [{ time: time.clock, label: status === "planned" ? "安排明确" : status === "completed" ? "完成信息发布" : "正式信息发布", detail: quote }];
  if (finalRelease && publicRelease) {
    title = "DSH最后一个内测版本与公测排期确定";
    summary = `官方明确：今夜推送 DSH 最后一个内测版本；${releaseDate ?? "后续日期"}计划对外发布公测版。`;
    topics = ["DSH", "内测收官", "公测排期"];
    milestones = [
      { time: time.clock, label: "最后一个内测版本确定", detail: "今夜推送，相关插件进入最终兼容阶段" },
      { time: releaseDate ?? "后续", label: "公测发布节点明确", detail: "DSH 公测版计划对外发布" },
    ];
  }
  if (related.length >= 3 && speakers.size >= 2) {
    summary += ` 随后有 ${related.length} 条直接相关发言、${speakers.size} 位成员参与讨论。`;
  }
  return {
    id: `group-event:${date}:official:${stableId(item?.event_key ?? item?.message_id ?? `${time.timestamp}:${index}`)}`,
    sourceMessageId: oneLine(item?.message_id),
    date,
    timestamp: time.timestamp,
    endTimestamp: related.at(-1)?.time.timestamp ?? time.timestamp,
    timeRange: `${date} · ${time.clock}`,
    eventType: oneLine(item?.event_type) || (status === "planned" ? "plan" : "announcement"),
    status,
    title,
    summary,
    relatedMessageCount: Math.max(1, related.length),
    speakerCount: Math.max(1, speakers.size),
    topics,
    milestones,
    quotes: quote ? [{ sender: oneLine(item?.sender) || "官方", time: time.clock, quote }] : [],
    evidenceBoundary: "官方信息原话及其相邻群聊响应",
    score: 1_000 + related.length,
    messageIds: new Set(related.map((record) => record.id)),
    tokenKeys: new Set(extractedTokens(evidence).keys()),
  };
}

function richerOfficialEvent(left, right) {
  const score = (event) => Number(!/正式信息发布$/u.test(event.title)) * 8
    + Number(event.eventType !== "announcement") * 4 + event.milestones.length + event.summary.length / 1_000;
  return score(right) > score(left) ? right : left;
}

function timeOverlap(left, right) {
  const start = Math.max(Date.parse(left.timestamp), Date.parse(right.timestamp));
  const end = Math.min(Date.parse(left.endTimestamp), Date.parse(right.endTimestamp));
  return Math.max(0, end - start);
}

function sharesMajorEntity(left, right) {
  return (left.tokenKeys.has("pro") && right.tokenKeys.has("pro"))
    || (left.tokenKeys.has("deepseek harness") && right.tokenKeys.has("deepseek harness"));
}

function conflictsWithSelected(candidate, selected) {
  for (const previous of selected) {
    const messageSimilarity = recordSetSimilarity(candidate.messageIds, previous.messageIds);
    const tokenSimilarity = recordSetSimilarity(candidate.tokenKeys, previous.tokenKeys);
    if (messageSimilarity >= 0.34) return true;
    if (candidate.seed === previous.seed && Math.abs(Date.parse(candidate.timestamp) - Date.parse(previous.timestamp)) < 3 * 60 * 60_000) return true;
    if (timeOverlap(candidate, previous) > 0 && tokenSimilarity >= 0.5 && messageSimilarity >= 0.16) return true;
    if (candidate.title === previous.title) return true;
  }
  return false;
}

function outputEvent(event) {
  const { score, sourceMessageId, seed, messageIds, tokenKeys, ...result } = event;
  return result;
}

export function buildGroupEventTimeline(rows, { officialChronicles = [], date = null, maximum = 12 } = {}) {
  const records = (Array.isArray(rows) ? rows : []).map(normalizeRecord).filter(Boolean)
    .sort((left, right) => left.time.timestamp.localeCompare(right.time.timestamp) || left.id.localeCompare(right.id));
  const sourceDate = date ?? records[0]?.time.date ?? null;
  if (!sourceDate) return [];
  const dayRecords = records.filter((record) => record.time.date === sourceDate && record.tokens.size > 0);
  const terms = termStatistics(dayRecords);
  const officialBySource = new Map();
  for (const [index, item] of (Array.isArray(officialChronicles) ? officialChronicles : []).entries()) {
    const event = officialEvent(item, dayRecords, sourceDate, index);
    if (!event) continue;
    const key = event.sourceMessageId || event.id;
    const previous = officialBySource.get(key);
    officialBySource.set(key, previous ? richerOfficialEvent(previous, event) : event);
  }
  const official = [...officialBySource.values()];

  const candidates = [];
  for (const term of terms.values()) {
    if (!candidateAnchor(term, dayRecords.length)) continue;
    for (const episode of splitTermEpisodes(term.records, dayRecords.length)) {
      const candidate = communityCandidate(term, episode, dayRecords, terms, sourceDate);
      if (!candidate) continue;
      const overlapsOfficial = official.some((event) => recordSetSimilarity(candidate.messageIds, event.messageIds) >= 0.28
        || (timeOverlap(candidate, event) > 0 && recordSetSimilarity(candidate.tokenKeys, event.tokenKeys) >= 0.34));
      const relatedProAlreadyExists = candidates.some((previous) => sharesMajorEntity(candidate, previous)
        && Math.abs(Date.parse(candidate.timestamp) - Date.parse(previous.timestamp)) <= 95 * 60_000);
      if (!overlapsOfficial && !relatedProAlreadyExists
        && !candidates.some((previous) => conflictsWithSelected(candidate, [previous]))) {
        candidates.push(candidate);
      }
    }
  }
  const proTerm = terms.get("pro");
  const hasProEvent = candidates.some((candidate) => candidate.seed === "pro")
    || official.some((event) => event.topics.includes("DeepSeek V4 Pro"));
  if (proTerm && !hasProEvent) {
    const qualifying = splitTermEpisodes(proTerm.records, dayRecords.length)
      .map((episode) => communityCandidate(proTerm, episode, dayRecords, terms, sourceDate))
      .filter(Boolean)
      .filter((candidate) => candidate.relatedMessageCount >= 4 && candidate.speakerCount >= 3)
      .sort((left, right) => right.score - left.score)[0];
    if (qualifying) candidates.push(qualifying);
  }
  candidates.sort((left, right) => right.score - left.score);
  const entityDeduped = [];
  for (const candidate of candidates) {
    const duplicate = entityDeduped.some((previous) => sharesMajorEntity(candidate, previous)
      && Math.abs(Date.parse(candidate.timestamp) - Date.parse(previous.timestamp)) <= 95 * 60_000);
    if (!duplicate) entityDeduped.push(candidate);
  }
  candidates.length = 0;
  candidates.push(...entityDeduped);
  candidates.sort((left, right) => right.score - left.score
    || left.timestamp.localeCompare(right.timestamp) || left.title.localeCompare(right.title, "zh"));
  const desiredCommunity = Math.max(2, Math.ceil(dayRecords.length / 700));
  const communityLimit = Math.max(0, Math.min(desiredCommunity, maximum - official.length));
  const community = [];
  for (const candidate of candidates) {
    if (community.length >= communityLimit) break;
    const candidateIsPro = candidate.seed === "pro" || candidate.topics.includes("DeepSeek V4 Pro");
    const relatedProAlreadySelected = candidateIsPro && community.some((previous) =>
      (previous.seed === "pro" || previous.topics.includes("DeepSeek V4 Pro"))
      && Math.abs(Date.parse(candidate.timestamp) - Date.parse(previous.timestamp)) <= 95 * 60_000);
    const relatedOfficialPro = candidateIsPro && official.some((previous) => previous.topics.includes("DeepSeek V4 Pro")
      && Math.abs(Date.parse(candidate.timestamp) - Date.parse(previous.timestamp)) <= 95 * 60_000);
    if (!relatedProAlreadySelected && !relatedOfficialPro && !conflictsWithSelected(candidate, community)) community.push(candidate);
  }
  if (proTerm && !community.some((event) => event.seed === "pro")
    && !official.some((event) => event.topics.includes("DeepSeek V4 Pro"))) {
    const proCandidate = candidates.find((candidate) => candidate.seed === "pro");
    if (proCandidate) {
      if (community.length >= communityLimit && community.length) community.pop();
      if (!conflictsWithSelected(proCandidate, community)) community.push(proCandidate);
    }
  }
  return [...official, ...community]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.title.localeCompare(right.title, "zh"))
    .map(outputEvent);
}

export { sanitizeEvidence };
