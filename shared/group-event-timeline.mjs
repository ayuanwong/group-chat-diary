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
  external internal org id mc rip day0
`.trim().split(/\s+/u));

const BROAD_ANCHORS = new Set(`
  dsh deepseek deepseek-harness deepseek harness harness agent agents ai 模型 model models llm 代码 code 项目 project
  问题 用户 user users 支持 发布 release 更新 update 版本 version 效果 时间 工作 开发 github 官方
  pro ds 信息 定义 公司 社区 功能 方案 数据
`.trim().split(/\s+/u));
BROAD_ANCHORS.add("deepseek harness");

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
  ["flash", "DeepSeek V4 Flash"], ["v4f", "DeepSeek V4 Flash"], ["dgx", "DGX"],
  ["cc", "Claude Code"], ["pi", "Pi"], ["rust", "Rust"], ["rag", "RAG"], ["wsl", "WSL"],
  ["conda", "Conda"], ["windows", "Windows"], ["web", "Web"], ["webui", "WebUI"],
  ["tdd", "TDD"], ["bm25", "BM25"], ["agi", "AGI"], ["grok4.6", "Grok 4.6"],
  ["deepseek v4 flash", "DeepSeek V4 Flash"], ["claude code", "Claude Code"],
  ["dsv4flash", "DeepSeek V4 Flash"], ["web_search", "Web Search"], ["web search", "Web Search"],
  ["full access", "Full Access 模式"], ["full access 模式", "Full Access 模式"],
  ["grok 4.6", "Grok 4.6"], ["production ready", "Production Ready 标准"],
  ["production ready 标准", "Production Ready 标准"], ["win7", "Windows 7"],
  ["agentloop", "AgentLoop"], ["multica runtime", "Multica Runtime"],
  ["pro ga", "DeepSeek V4 Pro GA"], ["dsh github", "DSH GitHub 仓库"],
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
const CLOSURE = /(?:最后|最终|收官).{0,18}(?:内测|版本|一天|一晚)|(?:内测|版本).{0,18}(?:最后|最终|收官|结束)|解散|告别|最后一天|保密期.{0,8}结束/iu;
const RELAY = /#接龙|接龙/iu;
const QUESTION_OR_UNCERTAIN = /[?？]|为什么|怎么|如何|能否|是否|是不是|有没有|听说|据说|貌似|猜测|可能|也许|好像|感觉/iu;
const RELEASE_HEARSAY = /听说|据说|貌似|猜测|可能|也许|好像|感觉|传闻|真(?:的)?(?:来了|发了|出了)|是不是|了吗|没有|别更新/iu;
const FINAL_RELEASE = /(?:最后|最终|收官).{0,28}(?:内测|版本|发版|发布)|(?:内测|版本|发版|发布).{0,28}(?:最后|最终|收官)/iu;
const PUBLIC_RELEASE = /公测|公开|对外|正式.{0,16}(?:发布|上线|开放)|(?:发布|上线|开放).{0,16}正式/iu;
const DSH_SUBJECT = /deepseek\s+harness|(?:^|[^a-z0-9])dsh(?:2026|-external)?(?:$|[^a-z0-9])/iu;

const FOCUS_RULES = [
  ["速度延迟", /速度|延迟|token\/s|tokens?\s*per|快|慢/iu],
  ["额度价格", /额度|价格|涨价|计费|费用|成本|token\s*(?:额度|消耗)/iu],
  ["API 调用", /api|responses?\s*api|接口|调用|curl|endpoint/iu],
  ["版本指纹", /版本|fingerprint|tag|snapshot|build|081\d/iu],
  ["安装环境", /安装|环境|依赖|conda|venv|python|npm|pnpm|uv/iu],
  ["Windows 兼容", /windows|win\d*|wsl|powershell|pwsh/iu],
  ["插件兼容", /插件|plugin|skill|mcp|适配|兼容/iu],
  ["仓库公开", /仓库|repo|github|fork|开源|公开/iu],
  ["能力评测", /能力|评测|benchmark|测试|实测|效果|coding|推理/iu],
  ["保密访问", /保密|泄密|泄露|访问|邀请|权限|水印/iu],
];

const NOUN_FOCUS_RULES = [
  ["上下文记忆", /上下文|context|memory|记忆|session/iu],
  ["沙箱权限", /沙箱|sandbox|landlock|权限|permission/iu],
  ["前端交互", /前端|web\s*ui|webui|界面|交互|侧边栏|sidebar|tui/iu],
  ["搜索检索", /搜索|检索|search|rag|bm25|grep/iu],
  ["Agent 编排", /agent|subagent|workflow|编排|goal/iu],
  ["模型能力", /模型|推理|coding|benchmark|评测|能力/iu],
  ["开源生态", /开源|生态|社区|插件|plugin|skill|mcp/iu],
  ["算力硬件", /显卡|gpu|h200|h100|h20|a800|dgx|显存|集群/iu],
  ["内容呈现", /标题|段落|内容|展示|摘要|框架|表达/iu],
];

const LOW_INFORMATION_TITLE = /成为当时段主议题|引发不同观点|引发集中讨论$|成为一轮集中议题$/u;
const SEMANTIC_SUBJECT = /部署|仓库|插件|内测|公测|泄密|泄露|保密|算力|显卡|模型|评测|搜索|检索|记忆|游戏|交互|前端|后端|浏览器|编译|环境|权限|沙箱|生态|开源|协议|接龙|组织|合影|价格|涨价|额度|速度|延迟|论文|人脉|招聘|高考|教育|政策|新闻|硬件|服务器|上下文|接口|版本|安装|配置|签名|证书|芯片|出口|新规|政府|工作|公司|内容|标题|展示|体验|事故|工具|数据|社区|屏幕|酒馆|红包/iu;
const CONCRETE_EVENT_TITLE = /合影与纪念|联系与人脉留存|泄露引发|Windows 7 兼容|游戏化界面|标题与内容呈现|仓库迁移与组织安排|证书链与 Windows 安装/u;
const EVENT_CONTEXT = /发布|上线|开放|实测|测试|评测|报错|失败|兼容|计划|安排|迁移|安装|部署|开发|实现|调用|接口|插件|仓库|新闻|政策|分享|价格|额度|速度|延迟|权限|泄露|接龙|合影/iu;
const GENERIC_SUBJECTS = new Set(`
  api token 速度 延迟 价格 额度 权限 保密 安装 配置 工具 展示 前端 后端 编译 仓库 搜索 记忆
  issue skill plugin web ui tui windows
`.trim().split(/\s+/u));
const STRONG_SUBJECTS = /deepseek|claude|gpt|grok|gemini|kimi|qwen|glm|doubao|v\d|flash|harness|dsh|dgx|h\d{2,3}|rag|bm25|e2b|codex|openhands|openai|anthropic/iu;

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
  if (/\p{Script=Han}/u.test(token) && canonicalLabelKey(token) !== canonicalLabelKey(surface)) return token;
  const compact = oneLine(surface);
  if (compact && /^[\p{L}\p{N}][\p{L}\p{N}._ +#/-]{0,35}$/u.test(compact)) return compact;
  if (/^[a-z][a-z0-9._+-]{1,30}$/u.test(token)) return token;
  return token;
}

function cleanCompoundSubject(value) {
  let label = oneLine(value);
  label = label.replace(/^dsh\s+(?:plugin|repo|github|acp)$/iu, (match) => ({
    "dsh plugin": "DSH 插件",
    "dsh repo": "DSH 仓库",
    "dsh github": "DSH GitHub 仓库",
    "dsh acp": "DSH ACP",
  })[match.toLowerCase()] ?? match);
  label = label.replace(/^ds\s+harness$/iu, "DeepSeek Harness")
    .replace(/^pro\s+ga$/iu, "DeepSeek V4 Pro GA")
    .replace(/^qwen\s*(\d)/iu, "Qwen $1")
    .replace(/^codex$/iu, "Codex")
    .replace(/^dshclient$/iu, "DSH Client");
  return label;
}

function titleSubject(value) {
  return cleanCompoundSubject(value)
    .replace(/^dsh\s+github\s+仓库$/iu, "DSH GitHub 仓库")
    .replace(/^dsh\s+github$/iu, "DSH GitHub 仓库");
}

function canonicalEntityTokens(text) {
  const entities = new Map();
  if (/(?:deepseek[-_\s]*)?v\s*4[-_\s]*pro|\bv4pro\b/iu.test(text)) entities.set("deepseek v4 pro", "DeepSeek V4 Pro");
  if (/\bdsv4flash\b|\bv4f\b|deepseek[-_\s]*v\s*4[-_\s]*flash/iu.test(text)) entities.set("deepseek v4 flash", "DeepSeek V4 Flash");
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
  return cleanCompoundSubject(displayToken(term.token, surface));
}

function canonicalLabelKey(value) {
  return oneLine(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function participantKeys(records) {
  const result = new Set();
  for (const record of records) {
    const whole = canonicalLabelKey(record.sender);
    if (whole) result.add(whole);
    for (const segment of SEGMENTER.segment(record.sender)) {
      if (!segment.isWordLike) continue;
      const key = canonicalLabelKey(segment.segment);
      if (Array.from(key).length >= 2) result.add(key);
    }
  }
  return result;
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

function candidateAnchor(term, recordCount, participants) {
  if (!term || BROAD_ANCHORS.has(term.token) || ACTION_WORDS.has(term.token) || LOW_QUALITY_ANCHORS.has(term.token)) return false;
  const subjectKey = canonicalLabelKey(preferredSurface(term));
  if (participants.has(subjectKey) || participants.has(canonicalLabelKey(term.token))) return false;
  const latin = /^[a-z][a-z0-9._ +#/-]{1,35}$/iu.test(term.token);
  const chineseLength = /^[\p{Script=Han}]+$/u.test(term.token) ? Array.from(term.token).length : 0;
  const contextual = term.records.filter((record) => record.ownTokens.has(term.token) && EVENT_CONTEXT.test(record.authored));
  const contextualSpeakers = new Set(contextual.map((record) => record.sender)).size;
  const aliased = DISPLAY_ALIASES.has(term.token) || [...DISPLAY_ALIASES.values()]
    .some((value) => canonicalLabelKey(value) === canonicalLabelKey(term.token));
  const relaySubject = term.records.some((record) => record.ownTokens.has(term.token) && RELAY.test(record.authored));
  const shapedProduct = latin && (/\s|[\d._+#/-]/u.test(term.token) || aliased);
  const meaningful = SEMANTIC_SUBJECT.test(term.token)
    || (latin && (shapedProduct || relaySubject || contextualSpeakers >= 2))
    || (chineseLength >= 4 && contextualSpeakers >= 2);
  if (!meaningful) return false;
  const minimum = recordCount < 40 ? 2 : Math.max(3, Math.ceil(Math.sqrt(recordCount) / 30));
  if (term.speakers.size < 3 || term.records.length < minimum) return false;
  if (recordCount >= 40 && term.records.length > recordCount * 0.18) return false;
  if (/^(?:接龙|and|with|from|only|like|about|then|it's|that's|really|maybe|please)$/iu.test(term.token)) return false;
  return true;
}

function subjectSpecificity(token) {
  const label = displayToken(token, token);
  if (STRONG_SUBJECTS.test(token) || STRONG_SUBJECTS.test(label)) return 12;
  if (DISPLAY_ALIASES.has(token) && !GENERIC_SUBJECTS.has(token)) return 10;
  if (/\d|[._+#/-]|\s/u.test(token)) return 8;
  if (SEMANTIC_SUBJECT.test(token) && !GENERIC_SUBJECTS.has(token)) return 6;
  if (GENERIC_SUBJECTS.has(token)) return 2;
  return 4;
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

function nounFocusLabels(records, maximum = 2) {
  return NOUN_FOCUS_RULES.map(([label, pattern], index) => ({
    label,
    index,
    count: records.filter((record) => pattern.test(record.authored)).length,
    people: new Set(records.filter((record) => pattern.test(record.authored)).map((record) => record.sender)).size,
  })).filter((item) => item.count >= 2 && item.people >= 2)
    .sort((left, right) => right.count - left.count || right.people - left.people || left.index - right.index)
    .slice(0, maximum).map((item) => item.label);
}

function distinctFocusLabels(subject, records, maximum = 2) {
  const subjectKey = canonicalLabelKey(subject);
  return uniqueTopicLabels([...focusLabels(records), ...nounFocusLabels(records)])
    .filter((label) => {
      const key = canonicalLabelKey(label);
      return key !== subjectKey && !(subjectKey.length >= 2 && (key.includes(subjectKey) || subjectKey.includes(key)));
    })
    .slice(0, maximum);
}

function specificEventTitle(records) {
  const joined = records.map((record) => record.authored).join(" ");
  const speakers = (pattern) => new Set(records.filter((record) => pattern.test(record.authored))
    .map((record) => record.sender)).size;
  if (speakers(/合影|纪念/iu) >= 3) return "内测收官前，成员发起群聊合影与纪念";
  if (speakers(/人脉|保持联系|加好友|留个联系方式/iu) >= 3) return "成员讨论内测群结束后的联系与人脉留存";
  const leakSpeakers = speakers(/泄密|泄露|流出/iu);
  const repositoryAccess = speakers(/dsh|deepseek\s*harness/iu) >= 2 && speakers(/github|仓库|repo/iu) >= 2
    && speakers(/访问|打不开|权限|邀请|404/iu) >= 2;
  if (repositoryAccess) return "DSH GitHub 仓库访问问题被集中反馈";
  if (leakSpeakers >= 2 && speakers(/保密|公开|仓库|npm|权限|代码|密钥|token/iu) >= 2) {
    if (speakers(/npm|包管理|package/iu) >= 2) return "npm 包疑似泄露引发保密与公开边界讨论";
    if (speakers(/仓库|repo|github/iu) >= 2) return "仓库内容疑似泄露引发保密与公开边界讨论";
    if (speakers(/dsh|deepseek\s*harness|内测/iu) >= 2) return "DSH 内测信息疑似泄露引发保密边界讨论";
    return "疑似泄露引发保密与公开边界讨论";
  }
  if (speakers(/政府|政务|内网/iu) >= 1 && speakers(/win(?:dows)?\s*7|win7/iu) >= 2) {
    return "政府内网的 Windows 7 兼容需求被讨论";
  }
  if (speakers(/游戏.{0,24}(?:界面|面板|状态|token|agent)|(?:界面|面板|状态).{0,24}游戏/iu) >= 2) {
    return "成员设想用游戏化界面呈现 Agent 状态";
  }
  if (speakers(/标题|段落|内容框架|展示形式|内容呈现/iu) >= 3) return "群内讨论标题与内容呈现如何改进";
  if (speakers(/(?:仓库|repo|github).{0,20}(?:迁移|组织|org)|(?:组织|org).{0,20}(?:仓库|repo|github)/iu) >= 3) {
    return "内测收官后的仓库迁移与组织安排被讨论";
  }
  if (speakers(/(?:插件|签名|证书链).{0,24}(?:windows|安装|失败)|(?:windows|安装).{0,24}(?:签名|证书链)/iu) >= 3) {
    return "插件证书链与 Windows 安装问题被集中复现";
  }
  if (/#[^\s]{2,36}\s*接龙|#接龙/iu.test(joined)) {
    const subject = joined.match(/#接龙\s+([\p{L}\p{N}_.-]{2,36})/iu)?.[1];
    if (subject) return `${displayToken(normalizeToken(subject), subject)}接龙集中进行`;
  }
  return null;
}

function narrativeSummary(records, subject, profile, start, end, relatedMessageCount, speakerCount, title) {
  const focus = distinctFocusLabels(subject, records, 3);
  const action = /合影与纪念/u.test(title) ? "成员在内测收官前集中发起合影，并留下纪念信息"
    : /联系与人脉留存/u.test(title) ? "成员讨论群聊结束后如何继续保持联系和协作"
      : /泄露引发/u.test(title) ? "讨论围绕疑似泄露、保密责任和公开边界展开"
        : /Windows 7 兼容/u.test(title) ? "成员结合政府内网场景讨论旧系统兼容需求"
          : /游戏化界面/u.test(title) ? "成员设想用游戏化界面展示 Agent 状态与执行进度"
            : /标题与内容呈现/u.test(title) ? "成员讨论纪事标题、内容结构和展示方式如何改进"
              : /仓库迁移与组织安排/u.test(title) ? "讨论集中在内测收官后的仓库归属、迁移和组织方式"
                : /证书链与 Windows 安装/u.test(title) ? "成员集中复现插件签名、证书链和 Windows 安装问题"
                  : profile.release ? "发布信息出现后，成员继续核对可用版本和实际影响"
                    : profile.incident ? "成员集中交换问题现象、复现条件与处理线索"
                      : profile.testing ? "成员围绕实际体验、能力表现和使用差异交换结果"
                        : profile.plan ? "讨论逐步落到下一步安排和执行边界"
                          : profile.development ? "成员比较实现方式、兼容范围和落地条件"
                            : profile.news ? "相关消息出现后，成员讨论其影响和可信边界"
                              : profile.sharing ? "成员集中分享相关资料、工具和实践经验"
                                : profile.closure ? "讨论集中在内测收官、迁移安排和公开边界"
                                  : profile.relay ? "成员按接龙完成登记，并同步后续迁移安排"
                                    : "成员从不同经验出发比较判断和适用边界";
  const focusSentence = focus.length ? `重点涉及${joinLabels(focus)}。` : "";
  const range = start.time.clock === end.time.clock ? start.time.clock : `${start.time.clock}–${end.time.clock}`;
  return `${range}，围绕${subject}的讨论集中展开：${action}。${focusSentence}`
    + `共 ${relatedMessageCount} 条直接相关发言，${speakerCount} 位成员参与。`;
}

function narrativeTitle(labels, profile, records, subjectToken) {
  const subject = titleSubject(labels[0] ?? "相关议题");
  const specific = specificEventTitle(records);
  if (specific) return specific;
  const focus = distinctFocusLabels(subject, records);
  const focusText = joinLabels(focus);
  const extracted = extractiveHeadline(records, subjectToken, profile);
  if (extracted && Array.from(extracted).length <= 30) return extracted;
  if (profile.relay) return `${subject}接龙集中进行`;
  const joined = records.map((record) => record.authored).join(" ");
  const contextualClosure = CLOSURE.test(joined);
  const closureForSubject = records.filter((record) => record.ownTokens.has(subjectToken) && CLOSURE.test(record.authored));
  const subjectClosureReady = closureForSubject.length >= 2
    && new Set(closureForSubject.map((record) => record.sender)).size >= 2;
  if (/组织|解散/iu.test(joined) && /组织|解散/u.test(subject)) {
    return "内测群收官、组织安排与公开边界成为焦点";
  }
  const closureSubject = contextualClosure && subjectClosureReady && (subjectToken === "deepseek v4 pro" || subjectToken === "deepseek harness"
    || /dsh|harness|内测|公测|组织|解散|群/u.test(subject));
  if (closureSubject) return `${subject}内测收官与后续安排成为焦点`;
  if (profile.closure) return `内测收官、${subject}与后续安排成为焦点`;
  if (profile.release) {
    if (focus.includes("版本指纹") || focus.includes("速度延迟") || focus.includes("能力评测")) {
      return `${subject}发布，群内随即实测版本、能力与速度`;
    }
    return `${subject}发布后，群内集中讨论${focus.length ? focusText : "实际影响"}`;
  }
  if (profile.incident) {
    if (focus.includes("保密访问") || focus.includes("仓库公开")) return `${subject}的仓库访问与权限问题被集中复现`;
    if (focus.includes("插件兼容") || focus.includes("安装环境")) return `${subject}的安装与兼容问题被集中复现`;
    if (focus.includes("速度延迟") || focus.includes("模型能力")) return `${subject}的速度与能力异常被集中复现`;
    return `${subject}问题被集中复现`;
  }
  if (profile.testing) {
    if (focus.includes("额度价格") || focus.includes("API 调用")) return `${subject}的 API 调用、价格与额度被实测`;
    if (focus.includes("速度延迟") || focus.includes("能力评测") || focus.includes("模型能力")) {
      return `群内实测${subject}，比较能力与速度`;
    }
    if (focus.includes("插件兼容") || focus.includes("Agent 编排")) return `${subject}的插件兼容与 Agent 编排被实测`;
    return `${subject}的实际表现被集中测试`;
  }
  if (profile.plan) return `${subject}${focus.length ? `与${focusText}` : ""}的后续安排展开讨论`;
  if (profile.development) {
    if (focus.includes("安装环境") || focus.includes("Windows 兼容")) return `${subject}的安装构建与环境兼容方案被讨论`;
    if (focus.includes("插件兼容") || focus.includes("开源生态")) return `${subject}的插件接入与生态兼容被讨论`;
    if (focus.includes("前端交互")) return `${subject}的界面交互与使用体验被讨论`;
    if (focus.includes("仓库公开")) return `${subject}的仓库协作与公开方式被讨论`;
    if (focus.includes("API 调用")) return `${subject}的 API 接入与调用方式被讨论`;
    if (focus.includes("Agent 编排")) return `${subject}的 Agent 编排方式被讨论`;
    return `${subject}的实现与使用方式被讨论`;
  }
  if (profile.news) return `${subject}${focus.length ? `与${focusText}` : ""}相关消息引发群内讨论`;
  if (profile.sharing) return focus.length ? `围绕${subject}，成员分享${focusText}相关资料与实践`
    : `围绕${subject}，成员集中分享相关资料与实践`;
  if (profile.debate) {
    if (focus.includes("模型能力") || focus.includes("能力评测")) return `群内比较${subject}的能力与适用场景`;
    if (focus.includes("速度延迟")) return `群内比较${subject}的速度与延迟表现`;
    return `群内比较${subject}${focus.length ? `在${focusText}上的差异` : "的实际表现与适用场景"}`;
  }
  if (focus.includes("算力硬件")) return `${subject}算力配置与部署方式被讨论`;
  if (focus.includes("保密访问")) return `${subject}的保密与访问边界被讨论`;
  if (focus.includes("搜索检索")) return `${subject}的搜索效果与检索方案被讨论`;
  if (focus.includes("模型能力") || focus.includes("能力评测")) return `${subject}的能力表现成为讨论焦点`;
  if (focus.includes("安装环境")) return `${subject}的安装环境与配置方式被讨论`;
  if (focus.includes("前端交互")) return `${subject}的前端交互与展示方式被讨论`;
  if (focus.includes("插件兼容") || focus.includes("开源生态")) return `${subject}的插件兼容与生态接入被讨论`;
  if (focus.includes("仓库公开")) return `${subject}的仓库协作与公开方式被讨论`;
  if (focus.includes("速度延迟")) return `${subject}的速度与延迟表现被讨论`;
  if (focus.includes("额度价格")) return `${subject}的价格与额度变化引发讨论`;
  return focus.length ? `${subject}相关的${focusText}引发讨论` : `${subject}成为一轮集中议题`;
}

function believableTitle(title, labels) {
  const subject = labels[0] ?? "相关议题";
  if (/^(?:成员集中实测|相关议题|咱们|明明是|本次|人员|组织|填写|翻天|意识|一些|有了)/u.test(title)
    && !/[A-Za-z0-9]/u.test(subject)) return `${joinLabels(labels.slice(0, 3))}引发集中讨论`;
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
  const closureSubject = profile.closure && (seedTerm.token === "deepseek v4 pro" || seedTerm.token === "deepseek harness"
    || /dsh|harness|内测|公测|组织|群/iu.test(labels[0] ?? ""));
  if (profile.closure && !closureSubject && terms.has("deepseek harness")) {
    labels = uniqueTopicLabels(["DeepSeek Harness", ...labels]);
  }
  const titleSubjectToken = profile.closure && !closureSubject && terms.has("deepseek harness")
    ? "deepseek harness" : seedTerm.token;
  const title = believableTitle(narrativeTitle(labels, profile, related, titleSubjectToken), labels);
  const releaseRecord = profile.release ? releaseMilestone(related, seedTerm.token) : null;
  const start = related[0];
  const end = related.at(-1);
  const summarySubject = labels.includes("DeepSeek V4 Pro") ? "DeepSeek V4 Pro" : titleSubject(labels[0] ?? "相关议题");
  const summary = narrativeSummary(related, summarySubject, profile, start, end,
    related.length, relatedSpeakers.size, title);
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
    milestones.push({ time: end.time.clock, label: "本轮讨论结束", detail: `相关交流持续至 ${end.time.clock}` });
  }
  const concentration = episode.length / Math.max(1, seedTerm.records.length);
  const rarity = Math.log2((allRecords.length + 1) / (seedTerm.records.length + 1));
  const topicQuality = /^[a-z][a-z0-9._ +#/-]*$/iu.test(seedTerm.token)
    ? (/[\d +#._-]/u.test(seedTerm.token) ? 1.45 : 1.1)
    : Math.min(1.35, 0.9 + Array.from(seedTerm.token).length * 0.12);
  const specificity = CONCRETE_EVENT_TITLE.test(title) ? 20 : subjectSpecificity(seedTerm.token);
  const concreteSubject = specificity >= 6;
  const score = Math.sqrt(episode.length) * Math.log2(relatedSpeakers.size + 1)
    * (0.8 + concentration) * Math.max(1, rarity) * topicQuality;
  const titleQuality = Number(!LOW_INFORMATION_TITLE.test(title)) * 3
    + Number(CONCRETE_EVENT_TITLE.test(title)) * 4
    + Number(focusLabels(related).length > 0) * 2
    + Number(nounFocusLabels(related).length > 0) * 2
    + Number(DISPLAY_ALIASES.has(seedTerm.token) || SEMANTIC_SUBJECT.test(seedTerm.token)) * 2
    + Number(profile.release || profile.incident || profile.testing || profile.plan || profile.news || profile.relay) * 2
    + Number(relatedSpeakers.size >= 6);
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
    score: score * (0.8 + titleQuality * 0.08),
    titleQuality,
    concreteSubject,
    specificity,
    focusKeys: new Set(uniqueTopicLabels([...focusLabels(related), ...nounFocusLabels(related)])),
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

function sharesSubject(left, right) {
  return left.seed === right.seed || recordSetSimilarity(left.tokenKeys, right.tokenKeys) >= 0.34;
}

function candidatesConflict(left, right) {
  return conflictsWithSelected(left, [right]);
}

function conflictsWithSelected(candidate, selected) {
  for (const previous of selected) {
    const messageSimilarity = recordSetSimilarity(candidate.messageIds, previous.messageIds);
    const tokenSimilarity = recordSetSimilarity(candidate.tokenKeys, previous.tokenKeys);
    const focusSimilarity = recordSetSimilarity(candidate.focusKeys, previous.focusKeys);
    if (messageSimilarity >= 0.34) return true;
    if (candidate.seed === previous.seed && Math.abs(Date.parse(candidate.timestamp) - Date.parse(previous.timestamp)) < 3 * 60 * 60_000) return true;
    if (timeOverlap(candidate, previous) > 0 && messageSimilarity >= 0.12
      && (sharesSubject(candidate, previous) || candidate.eventType === previous.eventType)) return true;
    if (timeOverlap(candidate, previous) > 0 && focusSimilarity >= 0.5 && messageSimilarity >= 0.08) return true;
    if (candidate.focusKeys.size && previous.focusKeys.size && focusSimilarity >= 0.5
      && Math.abs(Date.parse(candidate.timestamp) - Date.parse(previous.timestamp)) <= 75 * 60_000) return true;
    if (timeOverlap(candidate, previous) > 0 && tokenSimilarity >= 0.5 && messageSimilarity >= 0.16) return true;
    if (candidate.title === previous.title) return true;
  }
  return false;
}

function outputEvent(event) {
  const { score, titleQuality, concreteSubject, specificity, sourceMessageId, seed, messageIds, tokenKeys, focusKeys, ...result } = event;
  return result;
}

export function buildGroupEventTimeline(rows, { officialChronicles = [], date = null, maximum = 18 } = {}) {
  const records = (Array.isArray(rows) ? rows : []).map(normalizeRecord).filter(Boolean)
    .sort((left, right) => left.time.timestamp.localeCompare(right.time.timestamp) || left.id.localeCompare(right.id));
  const sourceDate = date ?? records[0]?.time.date ?? null;
  if (!sourceDate) return [];
  const dayRecords = records.filter((record) => record.time.date === sourceDate && record.tokens.size > 0);
  const terms = termStatistics(dayRecords);
  const participants = participantKeys(dayRecords);
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
  const candidateKeys = new Set();
  for (const term of terms.values()) {
    if (!candidateAnchor(term, dayRecords.length, participants)) continue;
    for (const episode of splitTermEpisodes(term.records, dayRecords.length)) {
      const candidate = communityCandidate(term, episode, dayRecords, terms, sourceDate);
      if (!candidate) continue;
      const overlapsOfficial = official.some((event) => recordSetSimilarity(candidate.messageIds, event.messageIds) >= 0.28
        || (timeOverlap(candidate, event) > 0 && recordSetSimilarity(candidate.tokenKeys, event.tokenKeys) >= 0.34));
      const key = `${candidate.title}:${candidate.timestamp}:${candidate.endTimestamp}`;
      if (!overlapsOfficial && !candidateKeys.has(key)) {
        candidates.push(candidate);
        candidateKeys.add(key);
      }
    }
  }
  candidates.sort((left, right) => right.specificity - left.specificity || right.titleQuality - left.titleQuality
    || Number(right.concreteSubject) - Number(left.concreteSubject) || right.score - left.score
    || left.timestamp.localeCompare(right.timestamp) || left.title.localeCompare(right.title, "zh"));
  const desiredCommunity = Math.max(2, Math.ceil(dayRecords.length / 700));
  const communityLimit = Math.max(0, Math.min(desiredCommunity, maximum - official.length));
  const community = [];
  for (const candidate of candidates) {
    if (community.length >= communityLimit) break;
    const minimumTitleQuality = dayRecords.length >= 1_000 ? 5 : 3;
    if (candidate.titleQuality < minimumTitleQuality) continue;
    const strongerConcreteAlternative = candidates.some((other) => other !== candidate && other.concreteSubject
      && candidatesConflict(candidate, other)
      && other.specificity >= candidate.specificity + 2
      && (other.titleQuality >= candidate.titleQuality - 2 || other.score > candidate.score * 0.72));
    if (strongerConcreteAlternative) continue;
    if (!conflictsWithSelected(candidate, community)) community.push(candidate);
  }
  return [...official, ...community]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.title.localeCompare(right.title, "zh"))
    .map(outputEvent);
}

export { sanitizeEvidence };
