#!/usr/bin/env node
/**
 * generate-agent-notes-html.mjs — render a single-file Agent Notes inventory
 * page (dsh-archive-theme) from a DeepSeek Harness `.agents/notes/` tree.
 *
 * Path contract (mirrors scripts/agent-note-tree.ts in the dsh repo):
 *   {lifecycle}/{class}/yyyy-mm-dd-topic-title.md  +  .zh.md  +  .i18n.yaml
 *   lifecycle ∈ {proposed, implemented, rejected, archived}
 *   class      ∈ {feature, bug-fix, simplification, architecture, process, testing}
 *   `archived/` holds only implemented triplets (implemented is absent from path).
 *   Allowlisted non-note markdown at lifecycle roots: AGENTS.md, CLAUDE.md, README.md.
 *
 * Usage:
 *   node generate-agent-notes-html.mjs <notes-root> [-o out.html]
 *     [--title "…"] [--sub "…"] [--repo-label "…"] [--force]
 *   Default output: <cwd>/dsh-agent-notes-YYYYMMDDTHHMMSSZ.html
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, relative, basename } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const theme = await import(resolve(require.resolve('../../dsh-archive-theme/theme.mjs')))

const LIFECYCLES = ['proposed', 'implemented', 'rejected', 'archived']
const CLASSES = ['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing']
/** Non-note files allowed at the notes root or a lifecycle root (infra/contract docs). */
const SKIP_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md', 'README.zh.md', 'README.i18n.yaml', 'manifest.json'])
const NOTE_FILE = /^(\d{4}-\d{2}-\d{2})-[a-z0-9-]+\.md$/

function parseArgs(argv) {
  const args = { root: null, out: null, title: null, sub: null, repoLabel: null, force: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-o' || a === '--out') args.out = argv[++i]
    else if (a === '--title') args.title = argv[++i]
    else if (a === '--sub') args.sub = argv[++i]
    else if (a === '--repo-label') args.repoLabel = argv[++i]
    else if (a === '--force') args.force = true
    else if (!a.startsWith('-')) args.root = a
  }
  return args
}

/** First `# ` heading of a note file; falls back to a slug of the filename. */
function readTitle(file) {
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^#\s+(.+)$/m)
  if (m) return m[1].trim()
  return basename(file, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ')
}

function walk(root) {
  const notes = []
  const errors = []
  for (const lc of readdirSync(root, { withFileTypes: true })) {
    if (!lc.isDirectory()) {
      if (lc.name === 'INDEX.md') errors.push(`structure: INDEX.md — centralized Agent Note indexes are forbidden`)
      continue
    }
    if (!LIFECYCLES.includes(lc.name)) {
      errors.push(`structure: ${lc.name}/ — unknown lifecycle folder (allowed: ${LIFECYCLES.join(', ')})`)
      continue
    }
    for (const cls of readdirSync(join(root, lc.name), { withFileTypes: true })) {
      if (!cls.isDirectory()) {
        if (!SKIP_FILES.has(cls.name)) errors.push(`structure: ${lc.name}/${cls.name} — stray file in lifecycle folder`)
        continue
      }
      if (!CLASSES.includes(cls.name)) {
        errors.push(`structure: ${lc.name}/${cls.name}/ — unknown class folder (allowed: ${CLASSES.join(', ')})`)
        continue
      }
      for (const file of readdirSync(join(root, lc.name, cls.name)).sort()) {
        if (!file.endsWith('.md') || file.endsWith('.zh.md')) continue
        const m = file.match(NOTE_FILE)
        if (!m) {
          errors.push(`structure: ${lc.name}/${cls.name}/${file} — filename must match yyyy-mm-dd-topic-title.md`)
          continue
        }
        const base = file.replace(/\.md$/, '')
        const en = readTitle(join(root, lc.name, cls.name, file))
        const zh = readTitle(join(root, lc.name, cls.name, `${base}.zh.md`))
        if (!existsSync(join(root, lc.name, cls.name, `${base}.i18n.yaml`))) {
          errors.push(`structure: ${lc.name}/${cls.name}/${file} — missing .i18n.yaml sidecar`)
        }
        if (!zh) errors.push(`structure: ${lc.name}/${cls.name}/${file} — missing .zh.md counterpart`)
        notes.push({ d: m[1], l: lc.name, c: cls.name, te: en ?? file, tz: zh ?? en ?? file })
      }
    }
  }
  notes.sort((a, b) => b.d.localeCompare(a.d) || CLASSES.indexOf(a.c) - CLASSES.indexOf(b.c))
  return { notes, errors }
}

function escJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.root) {
    console.error('usage: node generate-agent-notes-html.mjs <notes-root> [-o out.html] [--title …] [--sub …] [--repo-label …] [--force]')
    process.exit(2)
  }
  const root = resolve(args.root)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`error: not a directory: ${root}`)
    process.exit(2)
  }

  const { notes, errors } = walk(root)
  for (const e of errors) console.error(`  ! ${e}`)
  if (errors.length && !args.force) {
    console.error(`\nfailed: ${errors.length} structure violation(s); use --force to generate anyway`)
    process.exit(1)
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dates = notes.map(n => n.d).sort()
  const first = dates[0] ?? '—'
  const last = dates[dates.length - 1] ?? '—'
  const title = args.title ?? 'DeepSeek Harness — Agent Notes 全量清单'
  const repoLabel = args.repoLabel ?? (root.includes('.agents') ? relative(process.cwd(), root).split('/')[0] : relative(process.cwd(), root))
  const sub = args.sub ?? `${repoLabel} · 快照 ${stamp} · ${first} → ${last} · ${notes.length} 篇(中英双语)`

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title.replace(/</g, '&lt;')}</title>
<style>${theme.css}</style>
</head>
<body>
<div class="wrap">
  <div class="toolbar">
    <div>
      <h1>${title.replace(/</g, '&lt;')}</h1>
      <div class="sub">${sub.replace(/</g, '&lt;')}</div>
    </div>
    <div class="spacer"></div>
    <button class="theme-toggle" id="themeBtn" type="button">🌓 切换主题</button>
  </div>

  <div class="tiles" id="tiles"></div>

  <div class="card">
    <h2>按日发布节奏</h2>
    <div id="timeline"></div>
    <div class="legend">
      <span><span class="sw" style="background:var(--series-3)"></span>已实现</span>
      <span><span class="sw" style="background:var(--series-4)"></span>计划中</span>
      <span><span class="sw" style="background:var(--status-critical)"></span>已否决</span>
      <span><span class="sw" style="background:var(--ink-3);opacity:.55"></span>已封存</span>
      <span style="margin-left:auto">横条宽度 = 当日 note 数</span>
    </div>
  </div>

  <div class="card todo" id="todoCard">
    <h2>🟡 计划清单(TODO · <span id="todoCount"></span>)</h2>
    <ol id="todoList"></ol>
  </div>

  <div class="card">
    <h2>全量清单</h2>
    <div class="filters">
      <input type="search" id="q" placeholder="搜索中文标题、英文标题、日期…">
      <div class="chip-group" id="lcFilters"></div>
      <div class="chip-group" id="clsFilters"></div>
    </div>
    <div class="result-count" id="resultCount"></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>日期</th><th>状态</th><th>类别</th><th>标题</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </div>

  <div class="foot">
    数据来源:<code>.agents/notes/</code>(路径编码:生命周期/类别/日期-标题)。中文标题取自各 note 的 <code>.zh.md</code> 配对文件;每篇另有 <code>.i18n.yaml</code> 校验 sidecar。
    已实现 = 与代码现状同步;计划中 = 待评审提案;已否决 = 保留防止重复犯错;已封存 = sha256 冻结不可改。
    生成器:<code>dsh-agent-notes-inventory/scripts/generate-agent-notes-html.mjs</code> · 主题:<code>dsh-archive-theme</code>。
  </div>
</div>

<script>globalThis.__DASH_NOTES__=${escJson(notes)};globalThis.__DASH_CONF__={};</script>
<script>${theme.js}</script>
</body>
</html>
`

  const out = resolve(args.out ?? join(process.cwd(), `dsh-agent-notes-${stamp.slice(0, 8)}.html`))
  writeFileSync(out, html)
  console.log(`ok: ${notes.length} notes → ${out}`)
  if (errors.length) console.log(`note: generated with ${errors.length} structure violation(s) (--force)`)
}

main()
