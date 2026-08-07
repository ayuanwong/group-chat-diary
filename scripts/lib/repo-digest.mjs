const CATEGORY_RULES = [
  {
    id: "operations",
    name: "内测协作与治理",
    summary: "组织成员、Issue、评审、资料归档和仓库安全等协作基础设施。",
    value: "它影响内测信息能否被找到、核对和安全流转。",
    pattern: /(?:^|\s)(?:issues|onboarding|review-panel|group-chat-diary|repo-visibility-guard|dsh-public-repo-monitor|dsh-external-research)(?:\s|$)|内测群聊|onboarding|review panel|生态情报|兼容性监控|public repositories/iu,
  },
  {
    id: "channels",
    name: "渠道与外部集成",
    summary: "把 DSH 接入 GitHub、飞书、微信、企业微信、QQ、Telegram 等外部入口。",
    value: "它决定 DSH 能否进入成员已经在用的工具和沟通渠道。",
    pattern: /\b(?:bot|telegram|wecom|weixin|feishu|qqbot)\b|remote channel|github integration|gh-bridge|飞书|微信|企业微信|github.*桥接/iu,
  },
  {
    id: "memory",
    name: "记忆、会话与知识",
    summary: "沉淀跨会话记忆，并让历史对话、论文库和知识材料可以被重新检索。",
    value: "它减少重复解释和资料失联，是长期使用 DSH 的连续性基础。",
    pattern: /memory|nowledge|recall|session-search|session-chatlog|zotero|\brag\b|记忆|会话全文搜索|聊天记录|知识|检索系统/iu,
  },
  {
    id: "browser-media",
    name: "浏览器、文件与多模态",
    summary: "扩展浏览器操作、视觉理解、网页采集、文件输入和结构化产物交付。",
    value: "它把 DSH 从纯文本对话扩展到真实网页、图片和本地文件任务。",
    pattern: /browser|(?:^|[-_\s])craw(?:$|[-_\s])|\bcraw|vision|multimedia|drag-and-drop|artifact|浏览器|视觉|多媒体|文件拖拽|文件交付/iu,
  },
  {
    id: "experience",
    name: "界面与客户端体验",
    summary: "改善 Web、TUI、桌面端和 macOS 入口中的信息呈现与操作反馈。",
    value: "它直接影响内测成员每天看到什么、能否顺畅操作以及是否理解系统状态。",
    pattern: /web[- ]?ui|(?:^|[-_\s])ui(?:$|[-_\s])|\btui\b|desktop|companion|island|notify|chat-width|working-activity|live-stats|message-edit|ui-progress|ui-whale|skins|web-terminal|界面|交互终端|桌面|换肤|通知|展示宽度|状态行|消息编辑/iu,
  },
  {
    id: "agent-workflow",
    name: "Agent 与工作流",
    summary: "让 DSH 承担研究、检查、子任务、提示词编排和自我改进等完整流程。",
    value: "它决定 DSH 能否从一次问答升级为可复用、可检查的任务执行系统。",
    pattern: /agent|deep-research|inspect|evolve|distill|alphasolve|subagent|prompt-studio|\brsi\b|coding-receipt|workflow|工作流|自进化|子代理|深度研究|检查.*修复/iu,
  },
  {
    id: "runtime",
    name: "运行环境与兼容适配",
    summary: "处理发行版、沙箱、Windows、终端、协议和其他客户端的运行兼容。",
    value: "它决定插件和客户端能否在不同系统、协议与隔离环境里真正运行。",
    pattern: /distro|sandbox|windows|win-port|shell-windows|pty-windows|\bacp\b|adapter|opencode|fabric|web-components|qwen-mm|cross-platform|跨平台|沙盒|发行版|适配器|协议/iu,
  },
  {
    id: "ecosystem",
    name: "插件生态与分发",
    summary: "负责插件发现、安装、启停、清单协议、示例和版本维护。",
    value: "它降低成员发现和使用插件的成本，也让生态具备统一入口和维护规则。",
    pattern: /plugin|\bhub\b|registry|marisa|skills-manager|toybox|dshx-update|cordis-examples|ex-setting|插件|扩展 hub|清单协议|extension examples/iu,
  },
  {
    id: "tools-quality",
    name: "工具、质量与安全",
    summary: "提供计算、编码、JSON、时间、Issue 提交、质量门和安全保护等基础能力。",
    value: "它们通常很小，但直接减少重复操作、错误提交和不可审计的执行。",
    pattern: /tool-|calculator|encoding|\bjson\b|\btime\b|issue-filer|\bsfw\b|guard|安全|质量|查重|计算器/iu,
  },
];

const FALLBACK_CATEGORY = {
  id: "experiments",
  name: "其他实验",
  summary: "暂未归入主线方向的原型、实验和待补充说明的仓库。",
  value: "它可能代表新的探索方向，但需要结合仓库说明和最近提交进一步判断。",
};

function compact(value, limit = 260) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function ageInDays(referenceMs, value) {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (referenceMs - timestamp) / 86_400_000);
}

function categoryFor(repo) {
  const haystack = `${repo.name ?? ""} ${repo.description ?? ""} ${(repo.topics ?? []).join(" ")}`.toLowerCase();
  return CATEGORY_RULES.find((rule) => rule.pattern.test(haystack)) ?? FALLBACK_CATEGORY;
}

function attentionFor(repo, referenceMs, category, latestCommit) {
  if (repo.archived || repo.disabled) {
    return { score: 0, label: "历史参考", reasons: [repo.archived ? "仓库已归档" : "仓库已停用"] };
  }
  const createdDays = ageInDays(referenceMs, repo.createdAt);
  const commitDays = ageInDays(referenceMs, latestCommit?.committedAt || repo.pushedAt);
  const headline = compact(latestCommit?.headline, 180);
  const reasons = [];
  let score = 0;
  if (commitDays <= 1) {
    score += 5;
    reasons.push("24 小时内有提交");
  } else if (commitDays <= 3) {
    score += 3;
    reasons.push("近 3 天有提交");
  } else if (commitDays <= 7) {
    score += 1;
    reasons.push("近 7 天有提交");
  }
  if (createdDays <= 1) {
    score += 2;
    reasons.push("24 小时内新建");
  } else if (createdDays <= 7) {
    score += 1;
    reasons.push("近 7 天新建");
  }
  if (repo.description) score += 1;
  if (/(?:^|\b)(?:feat|fix|release|perf)(?:\b|:)|新增|修复|发布|优化/iu.test(headline)) score += 1;
  score = Math.min(10, score);
  const label = score >= 8 ? "优先看" : score >= 5 ? "近期活跃" : createdDays <= 7 ? "新项目" : "持续维护";
  if (!reasons.length) reasons.push(category.name);
  return { score, label, reasons };
}

function activityFor(repo, referenceMs, latestCommit) {
  const headline = compact(latestCommit?.headline, 220);
  const commitDays = ageInDays(referenceMs, latestCommit?.committedAt || repo.pushedAt);
  const createdDays = ageInDays(referenceMs, repo.createdAt);
  const change = headline || "默认分支有新提交";
  if (repo.archived) return headline ? `已归档；最后可见提交：${headline}` : "仓库已归档，当前作为历史资料保留。";
  if (repo.disabled) return "仓库已停用，当前不再作为活跃项目推进。";
  if (commitDays <= 1) return `24 小时内更新：${change}`;
  if (commitDays <= 3) return `近 3 天更新：${change}`;
  if (createdDays <= 7 && headline) return `近 7 天新建；最新提交：${headline}`;
  if (headline) return `最近可见提交：${headline}`;
  return createdDays <= 7 ? "近 7 天新建，默认分支暂未提供提交摘要。" : "GitHub 暂未提供默认分支提交摘要。";
}

function whyFor(repo, referenceMs, category, attention) {
  const createdDays = ageInDays(referenceMs, repo.createdAt);
  const pushedDays = ageInDays(referenceMs, repo.latestCommit?.committedAt || repo.pushedAt);
  const momentum = repo.archived
    ? "当前已归档，适合作为历史方案参考。"
    : pushedDays <= 1
      ? "过去 24 小时仍有提交，值得先看最新变化。"
      : createdDays <= 7
        ? "这是近 7 天出现的新仓库，适合先判断它与现有方案的关系。"
        : attention.score >= 5
          ? "近期仍在推进，值得关注实现进度。"
          : "当前更适合按需查阅，而不是优先追踪。";
  return `${category.value}${momentum}`;
}

export function enrichRepository(repo, referenceTime) {
  const referenceMs = Date.parse(referenceTime);
  const safeReference = Number.isFinite(referenceMs) ? referenceMs : Date.now();
  const category = categoryFor(repo);
  const latestCommit = repo.latestCommit?.sha
    ? {
        sha: String(repo.latestCommit.sha),
        headline: compact(repo.latestCommit.headline, 220),
        committedAt: String(repo.latestCommit.committedAt ?? ""),
      }
    : null;
  const summary = compact(repo.description, 320)
    || (latestCommit?.headline
      ? `GitHub 暂未填写仓库说明；最新提交是「${latestCommit.headline}」。`
      : `GitHub 暂未填写仓库说明；当前按仓库名称归入“${category.name}”。`);
  const withCommit = { ...repo, latestCommit };
  const attention = attentionFor(withCommit, safeReference, category, latestCommit);
  return {
    ...withCommit,
    category: category.id,
    categoryName: category.name,
    summary,
    activity: activityFor(withCommit, safeReference, latestCommit),
    why: whyFor(withCommit, safeReference, category, attention),
    attention,
    explanationSource: "GitHub 仓库说明、状态与默认分支最新提交",
  };
}

function repoSort(left, right) {
  return Number(right.attention?.score ?? 0) - Number(left.attention?.score ?? 0)
    || String(right.latestCommit?.committedAt || right.pushedAt).localeCompare(String(left.latestCommit?.committedAt || left.pushedAt))
    || String(right.createdAt).localeCompare(String(left.createdAt))
    || String(left.name).localeCompare(String(right.name), "en");
}

export function buildRepositoryDigest(repositories, referenceTime) {
  const enriched = repositories.map((repo) => enrichRepository(repo, referenceTime)).sort(repoSort);
  const categories = new Map([...CATEGORY_RULES, FALLBACK_CATEGORY].map((category) => [category.id, category]));
  const groups = [];
  for (const [categoryId, category] of categories) {
    const members = enriched.filter((repo) => repo.category === categoryId).sort(repoSort);
    if (!members.length) continue;
    groups.push({
      id: categoryId,
      name: category.name,
      summary: category.summary,
      why: category.value,
      count: members.length,
      priorityCount: members.filter((repo) => repo.attention.label === "优先看").length,
      latestActivityAt: members.map((repo) => repo.latestCommit?.committedAt || repo.pushedAt).filter(Boolean).sort().at(-1) ?? null,
      leadRepoId: members[0].id,
      repositories: members.map((repo) => repo.id),
    });
  }
  groups.sort((left, right) => right.priorityCount - left.priorityCount
    || String(right.latestActivityAt).localeCompare(String(left.latestActivityAt))
    || right.count - left.count
    || left.name.localeCompare(right.name, "zh"));
  return {
    repositories: enriched,
    groups,
    highlights: enriched.filter((repo) => !repo.archived && !repo.disabled).slice(0, 6).map((repo) => repo.id),
    quality: {
      method: "deterministic-source-backed-v2",
      llmUsed: false,
      descriptions: enriched.filter((repo) => Boolean(repo.description)).length,
      latestCommits: enriched.filter((repo) => Boolean(repo.latestCommit)).length,
      groupedOnce: enriched.length === groups.reduce((sum, group) => sum + group.count, 0),
    },
  };
}

export { CATEGORY_RULES };
