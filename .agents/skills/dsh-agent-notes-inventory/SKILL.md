---
name: dsh-agent-notes-inventory
description: Use when generating a single-file Agent Notes 全量清单 inventory HTML from a DeepSeek Harness checkout's .agents/notes/ tree (stat tiles, per-day timeline, lifecycle/class filters, bilingual searchable table, TODO list), themed after the LoserFox agent-notes page. Run the generator script; the theme comes from dsh-archive-theme.
---

# Agent Notes 全量清单生成

把 dsh 仓库 `.agents/notes/` 的决策记录整理成一份可独立打开的单文件 HTML 清单，风格参照 `test-LoserFox-agent-notes-20260806.html`（浅色/深色主题、统计磁贴、按日发布节奏、状态/类别筛选、中英双语表格、TODO 计划清单）。

## 用法

```sh
node .agents/skills/dsh-agent-notes-inventory/scripts/generate-agent-notes-html.mjs \
  <dsh-checkout>/.agents/notes \
  -o dsh-agent-notes-YYYYMMDD.html \
  --repo-label deepseek-harness \
  --title "DeepSeek Harness — Agent Notes 全量清单"
```

- 默认输出到当前目录 `dsh-agent-notes-YYYYMMDD.html`；`-o` 指定路径。
- `--title` / `--sub` / `--repo-label` 覆盖页头文案；`--force` 允许带结构违规生成（默认违规即失败）。

## 数据契约（与 dsh 仓库 `scripts/agent-note-tree.ts` 一致）

- 路径编码：`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`，配套 `.zh.md` 与 `.i18n.yaml`。
- lifecycle：`proposed` / `implemented` / `rejected` / `archived`；class：`feature` / `bug-fix` / `simplification` / `architecture` / `process` / `testing`。
- `archived/` 下的 triplet 已 sha256 冻结：页面只做展示，绝不改写内容。
- 生命周期根部允许的非 note 文件：`AGENTS.md` / `CLAUDE.md` / `README.md`（跳过）。
- 中文标题取自 `.zh.md` 首个 `# ` 标题，英文取自 `.md`；缺失时回退为文件名 slug 并在 stderr 报告。

## 执行步骤

1. 确认 checkout 是干净的 dsh 源码树（存在 `.agents/notes/` 且含 `archived/` 之外的四个 lifecycle 目录）。
2. 运行生成器；先看 stderr：任何 `! structure:` 违规都先核实（缺 `.zh.md` / `.i18n.yaml`、未知目录、文件名不合规），不要直接 `--force` 掩盖。
3. 校验产物：文件以 `<!DOCTYPE html>` 开头、含 `__DASH_NOTES__` 数据、无外部资源依赖（全部内嵌）。
4. 报告页头统计（篇数、日期范围、各生命周期计数）与任何被跳过的文件。
