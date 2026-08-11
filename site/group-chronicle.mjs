const PERIODS = [
  { id: "late-night", label: "深夜", start: 0, end: 6 },
  { id: "morning", label: "上午", start: 6, end: 12 },
  { id: "afternoon", label: "下午", start: 12, end: 18 },
  { id: "evening", label: "晚间", start: 18, end: 24 },
];

const SUBJECT_RULES = [
  { id: "tui", label: "TUI", pattern: /\btui\b|终端界面/iu, hints: ["CLI/TUI"] },
  { id: "web-ui", label: "Web UI", pattern: /\bweb\s*ui\b|\bwebui\b|网页|网站|前端|页面|浏览器|侧栏|按钮/iu, hints: ["Web UI"] },
  { id: "cli", label: "CLI / 命令行", pattern: /\bcli\b|命令行|\bshell\b|\bbash\b|\bzsh\b|powershell/iu, hints: ["CLI/TUI"] },
  { id: "desktop", label: "桌面端", pattern: /desktop|桌面端|桌面应用|linux-app|dmg|\.app\b/iu },
  { id: "mcp", label: "MCP 集成", pattern: /\bmcp\b|model context protocol/iu, hints: ["插件与生态"] },
  { id: "skill", label: "Skill", pattern: /\bskills?\b|技能包/iu, hints: ["插件与生态"] },
  { id: "plugin", label: "插件", pattern: /插件|\bplugins?\b|扩展生态|扩展系统/iu, hints: ["插件与生态"] },
  { id: "worktree", label: "Worktree / 并行开发", pattern: /worktree|并行开发|多工作区/iu, hints: ["Agent 与任务"] },
  { id: "agent", label: "Agent / 子代理", pattern: /\bsubagents?\b|子代理|\bagents?\b|委派|任务执行/iu, hints: ["Agent 与任务"] },
  { id: "memory", label: "Memory / 记忆", pattern: /\bmemory\b|记忆|持久记忆|长期记忆/iu, hints: ["数据与记忆"] },
  { id: "session", label: "会话 / 恢复", pattern: /\bsessions?\b|会话|多轮|上下文|\bcontext\b|resume|恢复会话|fork/iu, hints: ["会话与上下文"] },
  { id: "prompt", label: "Prompt / 提示词", pattern: /prompt|提示词|system\s*message/iu },
  { id: "vision", label: "视觉 / 多模态", pattern: /vision|视觉|图片|图像|多模态|ocr/iu },
  { id: "model", label: "模型选择", pattern: /deepseek|gpt[-\s]?\d|claude|sonnet|opus|codex|模型|\bmodel\b/iu, hints: ["模型与调用"] },
  { id: "api", label: "API / Provider", pattern: /api\s*key|provider|调用|额度|token|计费|接口/iu, hints: ["模型与调用"] },
  { id: "issue", label: "Issue / PR", pattern: /\/issues\/\d+|issues?\s*#?\d+|提(?:交|个)?\s*issues?|\bpr\b|pull request|合并请求/iu, hints: ["Issue 与协作"] },
  { id: "github", label: "GitHub / Repo", pattern: /github|仓库|\brepos?\b|\borg\b|分支|branch/iu, hints: ["Issue 与协作"] },
  { id: "onboarding", label: "内测接入", pattern: /入群|新来|邀请|内测须知|填写表单|github\s*id|开通|白名单/iu },
  { id: "windows", label: "Windows / WSL", pattern: /windows|wsl|powershell|cmd脚本|ubuntu/iu, hints: ["权限与环境"] },
  { id: "macos", label: "macOS", pattern: /macos|mac\s|terminal\.app|苹果电脑/iu, hints: ["权限与环境"] },
  { id: "install", label: "安装 / 构建", pattern: /安装|构建|\bbuild\b|\bpnpm\b|\bnpm\b|\bnode(?:\.js)?\b|依赖|git clone/iu },
  { id: "sandbox", label: "沙箱 / 权限", pattern: /sandbox|沙箱|权限|鉴权|访问控制|保密|外传|合规|水印/iu, hints: ["权限与环境"] },
  { id: "file", label: "文件 / 产物", pattern: /文件|路径|目录|workspace|工作区|markdown|html|上传|下载|产物|resource/iu, hints: ["文件与产物"] },
  { id: "data", label: "数据 / 存储", pattern: /数据库|数据|缓存|同步|存储|采集|备份|jsonl|sqlite|磁盘写入/iu, hints: ["数据与记忆"] },
  { id: "release", label: "版本 / 发布", pattern: /changelog|版本|发布|上线|更新|tag\s*是|新版本/iu },
  { id: "product", label: "产品体验", pattern: /产品|功能|体验|需求|交互|设计/iu, hints: ["产品体验"] },
];

const CONCERN_RULES = [
  { id: "stability", label: "故障与稳定性", title: "稳定性问题", pattern: /bug|报错|崩溃|闪退|失败|卡死|中断|丢失|不生效|不工作|无法|不能用|故障/iu },
  { id: "performance", label: "性能与资源", title: "性能与资源占用", pattern: /性能|内存|cpu|卡顿|越用越卡|慢|耗时|延迟|写放大|磁盘写入|资源占用/iu },
  { id: "compatibility", label: "兼容与适配", title: "兼容性与适配", pattern: /兼容|适配|版本太新|不同版本|支持不了|平台|windows|wsl|macos|linux|依赖/iu },
  { id: "installation", label: "安装与启动", title: "安装和启动路径", pattern: /安装|启动|构建|\bpnpm\b|\bnpm\b|git clone|配置环境|依赖库/iu },
  { id: "release", label: "发布与分发", title: "发布和分发", pattern: /发布|上线|开源|上传|推出|新版本|tag\s*是|欢迎使用|已经做了|我做了/iu },
  { id: "access", label: "权限与接入", title: "权限和接入边界", pattern: /权限|邀请|白名单|开通|private|私有|org|github\s*id|访问|保密|外传|合规/iu },
  { id: "interaction", label: "交互与可读性", title: "交互与信息呈现", pattern: /交互|体验|展示|显示|按钮|侧栏|滚动|loading|可读性|界面|页面|纯chat|割裂/iu },
  { id: "integration", label: "集成与连接", title: "集成方式", pattern: /集成|接入|连接|bridge|rpc|协议|引入|注入|支持.*(?:模型|工具|端)|适配.*插件/iu },
  { id: "architecture", label: "架构与规范", title: "架构和规范", pattern: /架构|重构|规范|标准|manifest|contentblock|设计上|底层|协议|结构体系/iu },
  { id: "debugging", label: "复现与定位", title: "复现和定位证据", pattern: /复现|日志|截图|轨迹|debug|定位|原因|测试|实测|发现/iu },
  { id: "workflow", label: "协作与流转", title: "协作和流转方式", pattern: /issue|\bpr\b|合并|反馈入口|提交|协作|收集|跟进/iu },
  { id: "usage", label: "使用与配置", title: "使用和配置方式", pattern: /怎么|如何|能不能|可以用|通过.*方式|命令|配置|流程|步骤|避坑|用法/iu },
  { id: "cost", label: "额度与成本", title: "额度和调用成本", pattern: /额度|费用|成本|token|api\s*key|赠送\s*api|计费/iu },
  { id: "data", label: "数据与恢复", title: "数据保存和恢复", pattern: /数据|缓存|同步|存储|备份|恢复|写入|快照|回滚/iu },
  { id: "roadmap", label: "方向与计划", title: "产品方向和推进顺序", pattern: /方向|后面|接下来|计划|准备|先做|会以|希望进化|主要精力/iu },
  { id: "feedback", label: "需求与反馈", title: "需求和反馈", pattern: /建议|希望|需求|反馈|应该|最好|考虑|期望/iu },
];

const INTENT_RULES = [
  { id: "problem", label: "问题/复现", pattern: /bug|报错|崩溃|闪退|失败|卡死|卡顿|越用越卡|内存.{0,8}爆|爆掉|丢失|不生效|无法|不能用|问题|复现/iu },
  { id: "release", label: "发布/进展", pattern: /发布|上线|开源|上传|完成(?:发布|修复|合并|更新)|已经(?:发布|上线|开源|上传|修好|改好|完成)|刚刚(?:发布|上线|修好|更新)|修好|改好|我做了|推出|更新(?:了|完成)/iu },
  { id: "solution", label: "方案/配置", pattern: /方案|可以用|通过.*方式|命令|配置|步骤|避坑|解决|修复|替代|流程/iu },
  { id: "evidence", label: "实测/判断", pattern: /实测|测试|发现|日志|数据|截图|运行中|实际|原因|复现/iu },
  { id: "proposal", label: "建议/需求", pattern: /建议|希望|应该|最好|需要|proposal|期望|考虑加入/iu },
  { id: "question", label: "追问/确认", pattern: /[?？]|为什么|怎么|能不能|可不可以|是不是|有没有|如何|是否/iu },
  { id: "announcement", label: "规则/通知", pattern: /@所有人|内测须知|请注意|刚入群|邀请|填写表单|反馈入口/iu },
];

const KNOWN_ENTITIES = [
  ["TUI", /\btui\b/iu],
  ["Web UI", /\bweb\s*ui\b|\bwebui\b/iu],
  ["CLI", /\bcli\b/iu],
  ["MCP", /\bmcp\b/iu],
  ["Skill", /\bskills?\b/iu],
  ["Agent", /\bagents?\b|子代理/iu],
  ["Worktree", /worktree/iu],
  ["Session", /\bsessions?\b|会话/iu],
  ["Memory", /\bmemory\b|记忆/iu],
  ["Windows / WSL", /windows|wsl/iu],
  ["macOS", /macos|terminal\.app/iu],
  ["Node.js", /node(?:\.js)?\s*v?\d+/iu],
  ["pnpm", /\bpnpm\b/iu],
  ["DeepSeek", /deepseek/iu],
  ["Codex", /codex/iu],
  ["Claude", /claude|sonnet|opus/iu],
];

const FALLBACK_SUBJECT = new Map([
  ["会话与上下文", "session"], ["Agent 与任务", "agent"], ["Web UI", "web-ui"],
  ["Issue 与协作", "issue"], ["模型与调用", "model"], ["权限与环境", "sandbox"],
  ["插件与生态", "plugin"], ["文件与产物", "file"], ["数据与记忆", "data"],
  ["CLI/TUI", "cli"], ["产品体验", "product"],
]);

const GENERIC_SUBJECTS = new Set(["product", "github", "issue", "file", "data"]);
const GENERIC_ENTITIES = new Set([
  "TUI", "Web UI", "CLI", "MCP", "Skill", "Agent", "Worktree", "Session", "Memory",
  "Windows / WSL", "macOS", "Node.js", "pnpm", "DeepSeek", "Codex", "Claude",
]);
const DEFAULT_TITLES = new Map([
  ["stability", (focus) => `${focus}暴露新的稳定性问题`],
  ["performance", (focus) => `${focus}资源占用出现新的实测`],
  ["compatibility", (focus) => `${focus}适配边界被具体讨论`],
  ["installation", (focus) => `${focus}安装与启动路径被梳理`],
  ["release", (focus) => `${focus}发布与分发路径被更新`],
  ["access", (focus) => `${focus}权限与接入边界被说明`],
  ["interaction", (focus) => `${focus}交互痛点与改进方向被提出`],
  ["integration", (focus) => `${focus}集成方式与接口边界被讨论`],
  ["architecture", (focus) => `${focus}架构方案与规范边界被讨论`],
  ["debugging", (focus) => `${focus}复现步骤与定位证据被补全`],
  ["workflow", (focus) => `${focus}状态与后续流转被核对`],
  ["usage", (focus) => `${focus}使用与配置路径被说明`],
  ["cost", (focus) => `${focus}额度与调用成本被具体讨论`],
  ["data", (focus) => `${focus}数据保存与恢复路径被梳理`],
  ["roadmap", (focus) => `${focus}推进方向与优先顺序被说明`],
  ["feedback", (focus) => `${focus}需求与使用反馈被提出`],
]);
const DEFAULT_EXPLANATIONS = new Map([
  ["stability", "本段记录了具体故障现象及其影响，是否形成稳定复现仍以代表发言为准。"],
  ["performance", "成员主要用使用体验或资源数据判断性能表现，结论未必一致。"],
  ["compatibility", "讨论聚焦环境、版本或依赖差异带来的适配边界。"],
  ["installation", "内容主要说明安装、构建或启动所需的条件与步骤。"],
  ["release", "信息重点是已发生的发布进展，以及后续试用入口和分发方式。"],
  ["access", "讨论集中在谁能访问、如何开通，以及需要遵守的权限边界。"],
  ["interaction", "成员描述了具体操作中的阅读或交互成本，并提出改进方向。"],
  ["integration", "内容主要核对接入方式、接口边界和上下游适配条件。"],
  ["architecture", "讨论在方案结构、协议约束和长期维护成本之间做取舍。"],
  ["debugging", "内容以复现步骤、日志、测试或定位线索为主。"],
  ["workflow", "讨论主要核对当前状态、责任人和下一步流转方式。"],
  ["usage", "内容主要说明实际用法、配置方式或可执行路径。"],
  ["cost", "讨论聚焦额度、Token 消耗或调用成本的实际影响。"],
  ["data", "内容主要核对数据如何保存、同步、恢复或回滚。"],
  ["roadmap", "讨论重点是后续方向、优先顺序和暂不处理的边界。"],
  ["feedback", "成员提出具体需求或使用反馈，尚未自动视为产品结论。"],
]);
const CONCERN_EVIDENCE = new Map([
  ["stability", "故障现象及其影响"],
  ["performance", "使用体感与资源数据"],
  ["compatibility", "环境、版本和依赖差异"],
  ["installation", "安装、构建与启动条件"],
  ["release", "已经落地的发布进展"],
  ["access", "访问资格与权限边界"],
  ["interaction", "具体操作和阅读成本"],
  ["integration", "接入方式与上下游条件"],
  ["architecture", "协议结构与长期维护取舍"],
  ["debugging", "复现步骤、日志和实测线索"],
  ["workflow", "当前状态、责任与后续流转"],
  ["usage", "实际用法与配置路径"],
  ["cost", "额度、Token 与调用成本"],
  ["data", "保存、同步与恢复方式"],
  ["roadmap", "后续方向与优先顺序"],
  ["feedback", "具体需求与使用反馈"],
]);
const PAIRED_TITLES = new Map([
  ["compatibility|workflow", (focus) => `${focus}适配边界与协作流转同时受到关注`],
  ["debugging|installation", (focus) => `${focus}安装路径与复现证据被分开核对`],
  ["compatibility|debugging", (focus) => `${focus}复现证据与适配边界被分开核对`],
  ["installation|stability", (focus) => `${focus}安装方式与稳定性风险并行讨论`],
  ["installation|performance", (focus) => `${focus}安装启动与资源占用同时被核对`],
  ["feedback|roadmap", (focus) => `${focus}具体需求与推进方向同时出现`],
  ["interaction|stability", (focus) => `${focus}交互问题与稳定性风险并行暴露`],
  ["debugging|usage", (focus) => `${focus}使用路径与复现证据被同时补充`],
]);
const PARALLEL_HEADLINES = new Map([
  ["stability", "稳定性风险被暴露"],
  ["performance", "资源表现有了实测"],
  ["compatibility", "适配边界被核对"],
  ["installation", "安装启动条件被梳理"],
  ["release", "发布进展被更新"],
  ["access", "接入权限被说明"],
  ["interaction", "交互痛点被提出"],
  ["integration", "集成方式被核对"],
  ["architecture", "架构取舍被讨论"],
  ["debugging", "复现线索被补全"],
  ["workflow", "后续流转被核对"],
  ["usage", "使用路径被说明"],
  ["cost", "调用成本被核算"],
  ["data", "数据恢复路径被梳理"],
  ["roadmap", "推进优先级被讨论"],
  ["feedback", "具体需求被提出"],
]);
const EVIDENCE_TITLES = new Map([
  ["debugging", (focus) => `${focus}复现步骤与定位证据被补全`],
  ["stability", (focus) => `${focus}稳定性问题获得可核对证据`],
  ["performance", (focus) => `${focus}性能判断获得资源实测`],
  ["compatibility", (focus) => `${focus}适配问题获得环境证据`],
]);
const QUESTION_TITLES = new Map([
  ["stability", (focus) => `${focus}稳定性问题成为集中追问`],
  ["performance", (focus) => `${focus}性能与资源占用成为集中追问`],
  ["compatibility", (focus) => `${focus}适配边界成为集中追问`],
  ["installation", (focus) => `${focus}安装与启动条件成为集中追问`],
  ["debugging", (focus) => `${focus}复现与定位成为集中追问`],
  ["workflow", (focus) => `${focus}状态与后续流转成为集中追问`],
  ["usage", (focus) => `${focus}使用与配置方式成为集中追问`],
  ["feedback", (focus) => `${focus}需求范围成为集中追问`],
]);
const SUBJECT_BY_ID = new Map(SUBJECT_RULES.map((item) => [item.id, item]));
const CONCERN_BY_ID = new Map(CONCERN_RULES.map((item) => [item.id, item]));
const INTENT_BY_ID = new Map(INTENT_RULES.map((item) => [item.id, item]));

function signalTime(value) {
  const match = String(value ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/u);
  if (!match) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  const period = PERIODS.find((item) => hour >= item.start && hour < item.end);
  if (!period) return null;
  return {
    date: match[1],
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
    clock: `${match[2]}:${match[3]}`,
    sortKey: `${match[1]}T${match[2]}:${match[3]}`,
    period,
  };
}

function cleanLabel(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, 56);
}

function authoredQuote(value, limit = 200) {
  const authored = String(value ?? "").split("↳ 回复", 1)[0].replace(/\s+/gu, " ").trim();
  const characters = Array.from(authored);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : authored;
}

function originalTopics(signal) {
  const topics = Array.isArray(signal?.topics) ? signal.topics.map(cleanLabel).filter(Boolean) : [];
  const fallback = cleanLabel(signal?.cat);
  return [...new Set(topics.length ? topics : [fallback])].filter(Boolean);
}

function rankedRules(rules, text, topics, fallbackId = null) {
  const ranked = rules.map((rule, index) => {
    const textMatched = rule.pattern.test(text);
    let score = textMatched ? 6 : 0;
    // Legacy topic labels are broad. They may strengthen an explicit text match,
    // but must not manufacture a specific subtype such as MCP or Skill on their own.
    if (textMatched && rule.hints?.some((hint) => topics.includes(hint))) score += 2;
    return { rule, score, index };
  }).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  if (ranked.length) return ranked.map((item) => item.rule);
  return fallbackId ? [SUBJECT_BY_ID.get(fallbackId)].filter(Boolean) : [];
}

function fallbackConcern(signal) {
  const category = String(signal?.cat ?? "");
  if (/问题|故障/iu.test(category)) return "stability";
  if (/进展/iu.test(category)) return "release";
  if (/方案/iu.test(category)) return "usage";
  if (/协作/iu.test(category)) return "workflow";
  if (/建议|需求|问题/iu.test(category)) return "feedback";
  if (/实测/iu.test(category)) return "debugging";
  return "feedback";
}

function classifySignal(signal, text, topics) {
  const fallbackSubjectId = topics.map((topic) => FALLBACK_SUBJECT.get(topic)).find(Boolean) ?? "product";
  const subjects = rankedRules(SUBJECT_RULES, text, topics, fallbackSubjectId).slice(0, 3);
  const concerns = rankedRules(CONCERN_RULES, text, topics)
    .slice(0, 3);
  if (!concerns.length) concerns.push(CONCERN_BY_ID.get(fallbackConcern(signal)) ?? CONCERN_BY_ID.get("feedback"));
  const intents = INTENT_RULES.filter((rule) => rule.pattern.test(text));
  if (!intents.length) intents.push({ id: "opinion", label: "观点/判断" });
  return { subjects, concerns, intents };
}

function extractEntities(text) {
  const entities = [];
  for (const [label, pattern] of KNOWN_ENTITIES) if (pattern.test(text)) entities.push(label);
  for (const match of text.matchAll(/github\.com\/[^/\s)]+\/([^/#?\s)]+)/giu)) {
    const repository = cleanLabel(match[1]).replace(/\.git$/iu, "");
    if (repository && !["issues", "pull", "tree", "blob"].includes(repository.toLowerCase())) entities.push(repository);
  }
  for (const match of text.matchAll(/(?:\/issues\/|issue\s*#?)(\d{1,6})/giu)) entities.push(`Issue #${match[1]}`);
  return [...new Set(entities)].slice(0, 4);
}

function addCount(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function rankedCounts(map) {
  return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh"));
}

function createCluster(item) {
  const cluster = {
    date: item.time.date,
    period: item.time.period,
    items: [],
    subjectCounts: new Map(),
    concernCounts: new Map(),
    categoryCounts: new Map(),
    intentCounts: new Map(),
    entityCounts: new Map(),
    subjects: new Set(),
    concerns: new Set(),
    entities: new Set(),
    topics: new Set(),
    startMinute: item.time.minuteOfDay,
    endMinute: item.time.minuteOfDay,
    startClock: item.time.clock,
    endClock: item.time.clock,
    sortKey: item.time.sortKey,
  };
  appendToCluster(cluster, item);
  return cluster;
}

function appendToCluster(cluster, item) {
  cluster.items.push(item);
  const primarySubject = item.semanticSubject ?? item.classification.subjects[0];
  const primaryConcern = item.classification.concerns[0];
  addCount(cluster.subjectCounts, primarySubject.id);
  addCount(cluster.concernCounts, primaryConcern.id);
  addCount(cluster.categoryCounts, `${primarySubject.label} · ${primaryConcern.label}`);
  for (const subject of item.classification.subjects.slice(0, 2)) cluster.subjects.add(subject.id);
  for (const concern of item.classification.concerns.slice(0, 2)) cluster.concerns.add(concern.id);
  for (const intent of item.classification.intents) addCount(cluster.intentCounts, intent.id);
  for (const entity of item.entities) {
    cluster.entities.add(entity);
    addCount(cluster.entityCounts, entity);
  }
  for (const topic of item.topics) cluster.topics.add(topic);
  if (item.time.minuteOfDay < cluster.startMinute) {
    cluster.startMinute = item.time.minuteOfDay;
    cluster.startClock = item.time.clock;
  }
  if (item.time.minuteOfDay > cluster.endMinute) {
    cluster.endMinute = item.time.minuteOfDay;
    cluster.endClock = item.time.clock;
  }
  if (item.time.sortKey > cluster.sortKey) cluster.sortKey = item.time.sortKey;
}

function groupIntoTopicClusters(items) {
  const periods = new Map();
  for (const item of items) {
    const key = `${item.time.date}:${item.time.period.id}`;
    const bucket = periods.get(key) ?? [];
    bucket.push(item);
    periods.set(key, bucket);
  }
  const clusters = [];
  for (const bucket of periods.values()) {
    bucket.sort((left, right) => left.time.sortKey.localeCompare(right.time.sortKey) || left.id.localeCompare(right.id));
    const bySubject = new Map();
    for (const item of bucket) {
      const key = item.semanticSubject.id;
      const cluster = bySubject.get(key);
      if (cluster) appendToCluster(cluster, item);
      else bySubject.set(key, createCluster(item));
    }
    const ranked = [...bySubject.values()].sort((left, right) => {
      const leftScore = left.items.reduce((sum, item) => sum + item.score, 0);
      const rightScore = right.items.reduce((sum, item) => sum + item.score, 0);
      return right.items.length - left.items.length || rightScore - leftScore || right.sortKey.localeCompare(left.sortKey);
    });
    clusters.push(...ranked.slice(0, 3));
  }
  return clusters;
}

function clusterIntents(cluster) {
  return new Map(rankedCounts(cluster.intentCounts));
}

function clusterTone(cluster, concern) {
  const size = cluster.items.length;
  const strong = (intent, minimum = 2) => {
    const count = cluster.intentCounts.get(intent) ?? 0;
    return size <= 2 ? count >= 1 : count >= minimum && count / size >= 0.28;
  };
  const text = cluster.items.map((item) => item.quote).join(" ");
  const negative = /报错|崩溃|闪退|失败|卡死|卡顿|内存.{0,8}爆|爆掉|丢失|无法|不能用|问题/iu.test(text);
  const positive = /没有出现|无压力|运行正常|正常运行|成功解决|已经解决|修好|可以正常|确认可用/iu.test(text);
  return {
    contrast: ["stability", "performance", "compatibility"].includes(concern.id)
      && negative && positive && size > 1 && strong("problem") && strong("evidence"),
    problem: strong("problem"),
    release: strong("release"),
    solution: strong("solution") || strong("proposal"),
    evidence: strong("evidence"),
    question: strong("question"),
    announcement: strong("announcement", 1),
  };
}

function titleFor(cluster, subject, concern, entities, secondaryConcern = null) {
  const focus = entities[0] || subject.label;
  const tone = clusterTone(cluster, concern);
  if (tone.contrast) return `${focus}出现相反实测：故障反馈与可用证据并存`;
  if (secondaryConcern) {
    const key = [concern.id, secondaryConcern.id].sort().join("|");
    return (PAIRED_TITLES.get(key)
      ?? ((label) => `${label}${PARALLEL_HEADLINES.get(concern.id) ?? `${concern.label}被讨论`}，${PARALLEL_HEADLINES.get(secondaryConcern.id) ?? `${secondaryConcern.label}被讨论`}`))(focus);
  }
  if (tone.release && tone.problem && cluster.items.length > 1) return `${focus}发布后，适配问题进入验证`;
  if (tone.release) return `${focus}完成发布，讨论转向试用与适配`;
  if (tone.problem && tone.solution && cluster.items.length > 1) return `${focus}问题被复现，解决路径开始收敛`;
  if (tone.problem && tone.evidence) {
    return (EVIDENCE_TITLES.get(concern.id) ?? ((label) => `${label}${concern.title}获得可核对证据`))(focus);
  }
  if (tone.announcement) return `${focus}的规则、入口或权限发生更新`;
  if (tone.question && tone.solution && cluster.items.length > 1) return `${focus}需求被提出，可行方案随后出现`;
  if (tone.question) return cluster.items.length > 1
    ? (QUESTION_TITLES.get(concern.id) ?? ((label) => `${label}${concern.title}成为集中追问`))(focus)
    : `${focus}出现明确追问：${concern.title}`;
  if (tone.evidence) return `${focus}的${concern.title}出现新的实测判断`;
  return (DEFAULT_TITLES.get(concern.id) ?? ((label) => `${label}形成一条独立议题`))(focus);
}

function explanationFor(cluster, concern, entities, secondaryConcern = null) {
  const intents = clusterIntents(cluster);
  const intentParts = rankedCounts(intents).slice(0, 3).map(([id, count]) => {
    const label = INTENT_BY_ID.get(id)?.label ?? (id === "opinion" ? "观点/判断" : id);
    return `${count} 条${label}`;
  });
  const tone = clusterTone(cluster, concern);
  let lead = DEFAULT_EXPLANATIONS.get(concern.id) ?? "本段保留了一条可核对的独立议题。";
  if (tone.contrast) {
    lead = "同一议题下出现了正反两类实测，当前证据尚未收敛成单一结论。";
  } else if (secondaryConcern) {
    const primaryEvidence = CONCERN_EVIDENCE.get(concern.id) ?? concern.title;
    const secondaryEvidence = CONCERN_EVIDENCE.get(secondaryConcern.id) ?? secondaryConcern.title;
    lead = `一组发言在核对${primaryEvidence}，另一组关注${secondaryEvidence}；两条支线并行出现，未据此判断先后或因果。`;
  } else if (tone.problem && tone.solution && cluster.items.length > 1) {
    lead = "讨论先暴露问题或复现条件，随后转向修复、配置或替代方案。";
  } else if (tone.release) {
    lead = "核心进展已经落地，后续发言主要补充使用入口、依赖条件和适配边界。";
  } else if (tone.question && tone.solution && cluster.items.length > 1) {
    lead = "成员先提出明确疑问，后续给出了可执行路径或边界说明。";
  } else if (tone.problem && tone.evidence) {
    lead = "本段不只报告现象，还补充了复现、日志或实测依据。";
  } else if (tone.announcement) {
    lead = "本段以规则、入口或权限通知为主，并保留了相关操作信息。";
  }
  const entityPart = entities.length ? `涉及 ${entities.slice(0, 3).join("、")}。` : "";
  const speakerCount = new Set(cluster.items.map((item) => item.sender)).size;
  const evidencePart = cluster.items.length === 1
    ? `证据边界：单条线索，尚不能代表群体共识；主要是${intentParts.join("、")}。`
    : `证据结构：${cluster.items.length} 条精选发言，来自 ${speakerCount} 位成员；其中${intentParts.join("、")}。`;
  return `${lead}${entityPart}${evidencePart}`;
}

function representativeQuotes(items, maximum) {
  const ranked = [...items].sort((left, right) =>
    Number(right.score || 0) - Number(left.score || 0)
      || right.time.sortKey.localeCompare(left.time.sortKey)
      || right.quote.length - left.quote.length,
  );
  const chosen = [];
  const chosenIds = new Set();
  const senders = new Set();
  const intents = new Set();
  for (const item of ranked) {
    if (chosen.length >= maximum) break;
    const intent = item.classification.intents[0]?.id ?? "opinion";
    if (senders.has(item.sender) || intents.has(intent)) continue;
    chosen.push(item);
    chosenIds.add(item.id);
    senders.add(item.sender);
    intents.add(intent);
  }
  for (const item of ranked) {
    if (chosen.length >= maximum) break;
    if (chosenIds.has(item.id) || senders.has(item.sender)) continue;
    chosen.push(item);
    chosenIds.add(item.id);
    senders.add(item.sender);
  }
  for (const item of ranked) {
    if (chosen.length >= maximum) break;
    if (chosenIds.has(item.id)) continue;
    chosen.push(item);
    chosenIds.add(item.id);
  }
  return chosen.map((item) => ({
    sender: item.sender,
    time: item.time.clock,
    quote: item.quote,
    topics: item.categories,
  }));
}

function finalizeCluster(cluster, quoteLimit) {
  const subjectId = rankedCounts(cluster.subjectCounts)[0]?.[0] ?? "product";
  const subject = SUBJECT_BY_ID.get(subjectId) ?? SUBJECT_BY_ID.get("product");
  const categoryRanking = rankedCounts(cluster.categoryCounts);
  const categories = categoryRanking.slice(0, 3).map(([label]) => label);
  const concernLabel = categories[0]?.split(" · ").at(-1);
  const concern = CONCERN_RULES.find((item) => item.label === concernLabel) ?? CONCERN_BY_ID.get("feedback");
  const secondaryConcernLabel = categories[1]?.split(" · ").at(-1);
  const secondaryConcern = categoryRanking[1]?.[1] >= Number(categoryRanking[0]?.[1] ?? 1) * 0.6
    ? CONCERN_RULES.find((item) => item.label === secondaryConcernLabel) ?? null
    : null;
  const entityRanking = [...cluster.entityCounts.entries()]
    .sort((left, right) => right[1] - left[1]
      || Number(GENERIC_ENTITIES.has(left[0])) - Number(GENERIC_ENTITIES.has(right[0]))
      || left[0].localeCompare(right[0], "zh"));
  const entities = entityRanking.slice(0, 4).map(([label]) => label);
  const titleEntities = cluster.items.length <= 2 || Number(entityRanking[0]?.[1] ?? 0) >= 2 ? entities : [];
  const clockRange = cluster.startClock === cluster.endClock
    ? cluster.startClock
    : `${cluster.startClock}–${cluster.endClock}`;
  return {
    id: `${cluster.date}:${cluster.period.id}:${subject.id}:${concern.id}:${cluster.startClock}`,
    timestamp: cluster.sortKey,
    timeRange: `${cluster.date} · ${cluster.period.label} ${clockRange}`,
    title: titleFor(cluster, subject, concern, titleEntities, secondaryConcern),
    explanation: explanationFor(cluster, concern, entities, secondaryConcern),
    signalCount: cluster.items.length,
    speakerCount: new Set(cluster.items.map((item) => item.sender)).size,
    topics: categories,
    quotes: representativeQuotes(cluster.items, quoteLimit),
  };
}

export function buildGroupChronicle(signals, { maxQuotes = 3 } = {}) {
  if (!Array.isArray(signals)) return [];
  const quoteLimit = Math.max(1, Math.min(4, Number.isInteger(maxQuotes) ? maxQuotes : 3));
  const items = [];
  signals.forEach((signal, index) => {
    const time = signalTime(signal?.timestamp || signal?.time);
    const sender = cleanLabel(signal?.sender);
    const quote = authoredQuote(signal?.text);
    if (!time || !sender || !quote) return;
    const topics = originalTopics(signal);
    const classification = classifySignal(signal, quote, topics);
    const primarySubject = classification.subjects[0];
    const primaryConcern = classification.concerns[0];
    const categories = [`${primarySubject.label} · ${primaryConcern.label}`];
    const rawScore = Number(signal?.score);
    items.push({
      id: String(signal?.message_id || `${time.sortKey}:${index}`),
      sender,
      quote,
      topics,
      categories,
      classification,
      semanticSubject: classification.subjects.find((subject) => !GENERIC_SUBJECTS.has(subject.id)) ?? primarySubject,
      entities: extractEntities(quote),
      score: Number.isFinite(rawScore) ? rawScore : 0,
      time,
    });
  });
  return groupIntoTopicClusters(items)
    .map((cluster) => finalizeCluster(cluster, quoteLimit))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.title.localeCompare(right.title, "zh"));
}
