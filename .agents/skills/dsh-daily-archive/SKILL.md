---
name: dsh-daily-archive
description: Use when running the DSH 私有数据档案 daily pipeline for dsh-external/group-chat-diary — bounded group-day / github-live data runs, snapshot refresh, QA corpus sync, README 每日基本纪要 update, validation gates, and clean commit/push. Drives the repo's own npm scripts (refresh:group-day, sync:github-data, check, build:pages, deploy:pages) instead of duplicating them.
---

# DSH 私有数据档案 — 每日自动整理与触发流水线

目标仓库 `dsh-external/group-chat-diary` 已经是完整的受保护网站工程（Cloudflare Pages + D1 Worker + 本机采集脚本），自带构建体系。本 skill 只做**编排**：按仓库的"有界运行"模型触发其自带脚本、补上 README 纪要、跑验证门并干净提交——不重复实现仓库已有逻辑。

## 仓库拓扑（先认清再动手）

- **SITE_REPO** = `~/Projects/dsh-external/group-chat-diary`：页面代码（`site/`、`worker/`）、数据脚本（`scripts/`）、快照（`snapshots/YYYY-MM-DD.json`）、脱敏历史语料（`corpus/`）、README 纪要。
- **SOURCE_REPO** = `~/Projects/dsh-external/dsh-archive`（兄弟目录）：本机微信采集自动化（`.local/wechat-automation/`、`scripts/extract_wechat_group.py`、`scripts/build_group_data.py`、`.github/workflows/refresh_issues.py`）。采集配置缺失时脚本会拒绝运行，**不修改线上数据**。
- 私密数据只进 `.local/`（gitignored）与 D1；`corpus/` 只放已脱敏历史。
- 数据流：微信 4.x 数据库 → `raw-messages.local.json` → 自然日切分/脱敏 → D1（CONTENT_DB 展示 / QA_DB 完整语料）→ `snapshots/` 静态回退。

## 有界运行（blueprint 硬规则）

每次运行只做以下两种工作项之一，除非用户明确要求同时做：

1. **group-day**：`npm run refresh:group-day [YYYY-MM-DD]` —— 采集并激活一个明确自然日的群聊（默认昨天）；随后 `npm run sync:group-data -- --date <date>` 由脚本自动完成 D1 激活（新版本先写入、校验计数后再切 active 指针）。
2. **github-live**：`npm run sync:github-data` —— 共同激活当前 Issue 与 Repo 数据（一次 `github_sync_id`，两类计数均为正才激活）。

补充同步（按需）：`npm run sync:members`（05:00 成员白名单兜底）、`npm run sync:qa-corpus`、`npm run export:corpus`、`npm run refresh:snapshot`（旧式静态快照，仅迁移期回退）。

## 每日 05:00（北京时间）标准序列

1. `git -C $SITE_REPO pull --ff-only`（只接受快进）；工作区必须干净。
2. `npm run refresh:group-day`（昨天自然日）→ `npm run sync:group-data -- --date <date>`；微信采集缺失则**停**，不跳过。
3. `npm run sync:github-data`。
4. `node .agents/skills/dsh-daily-archive/scripts/update-readme-summary.mjs --dry-run` 预览数字纪要 → 确认后落盘；**讨论重点的叙事措辞由 agent 依据 topicDeltas 润色**（历史参考：08-07 的"插件相关讨论增量最高（+188）"风格）。
5. 验证门：`npm run check`（含敏感路径/凭据扫描）、`npm run typecheck`、`npm test`；需要部署时 `npm run build:pages`（`dist/` 仅一份 HTML，不得出现 `dist/corpus`）。
6. `git add snapshots/<date>.json corpus/... README.md latest.txt` → 提交（信息如 `Update diary README with daily summaries`）→ `git push`。
7. 部署（仅在用户确认或明确要求时）：`npm run deploy:pages`。

## 触发方式

- **本机定时**：Linux cron 或 Windows 任务计划程序，每天 05:00 执行；无头模式用 `dsh -p "执行 dsh-daily-archive 的每日标准序列"`（需 `DEEPSEEK_API_KEY`），失败诊断看 `session.jsonl.zstd`（issue #72：headless 失败 stderr 零诊断）。
- **手动**：在 Codex/dsh 中说"跑今天的档案"或"同步 DSH 成员名单"（后者 = `npm run sync:members`）。

## 硬性约束（违反即停）

- 绝不在工作区不干净时提交；push 前必须 `pull --ff-only`；绝不 `--force`、不覆盖他人改动。
- 任何校验失败即停止并保留现场，不清除历史版本、不把 `.local/` 加入 Git。
- 群聊归属规则（写入数据契约，采集侧强制）：右侧必须是"少女阿原"，左侧必须有其他成员署名；方向不可证实则不归属。
- 页面不得包含完整聊天记录、微信数据库、解密密钥、GitHub 凭据、本机绝对路径（`npm run check` 的 blockedContent 会拦截）。
- 纪事收录产品方正式发布且来源可归属的信息，包括完成态更新、明确计划、仓库与工具发布、规则与服务公告；必须保留事件状态差异，成员疑问、转述与猜测不算官方事实（`shared/official-chronicle.mjs` 是权威判定，`scripts/lib/chronicle-policy.mjs` 负责展示合并）。

## 契约速查

- 快照 `snapshots/YYYY-MM-DD.json`：`{snapshotDate, group, issues, comparison, generatedAt}`；`group` 含 `stats / signals / chronicles / members / hourly / group_topic_words / quality`；`issues` 含 `issues[]`（n/title/state/url/created/updated/cat/summary/excerpt）；`comparison` 含 `newIssueNumbers / newSignalMessageIds / newMessageCount / topicDeltas`。
- 群聊自然日窗口固定 `00:00:00 <= timestamp < 次日 00:00:00`（Asia/Shanghai），与运行时间无关。
- README 纪要格式以 `### YYYY-MM-DD` 开头，锚点 `## 每日基本纪要`；重复日期拒绝插入。
