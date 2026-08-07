#!/usr/bin/env node
/**
 * export_agent_notes.mjs — export the dsh checkout's `.agents/notes/` tree to
 * content/agent-notes.json for the site's "Agent Notes" tab.
 *
 * Path contract (mirrors scripts/agent-note-tree.ts in the dsh repo):
 *   {lifecycle}/{class}/yyyy-mm-dd-topic-title.md (+ .zh.md + .i18n.yaml)
 *   lifecycle ∈ {proposed, implemented, rejected, archived}
 *   class      ∈ {feature, bug-fix, simplification, architecture, process, testing}
 *   archived/ holds only implemented triplets (implemented absent from path).
 *
 * Usage:
 *   node scripts/export_agent_notes.mjs --notes-root <dsh-checkout>/.agents/notes \
 *     [-o content/agent-notes.json] [--source-label <label>]
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'

const LIFECYCLES = ['proposed', 'implemented', 'rejected', 'archived']
const CLASSES = ['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing']
const SKIP_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md', 'README.zh.md', 'README.i18n.yaml', 'manifest.json'])
const NOTE_FILE = /^(\d{4}-\d{2}-\d{2})-[a-z0-9-]+\.md$/
/** Per-side body cap: no current note exceeds this; guards future giant blobs. */
const BODY_CAP = 64 * 1024

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}

function readTitle(file) {
  if (!existsSync(file)) return null
  const m = readFileSync(file, 'utf8').match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : basename(file, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ')
}

/**
 * Deterministic digest of one note body (no LLM, no full text):
 *   sum  — first substantive paragraph (Problem/问题 section, else preamble,
 *          else Decision/决策, else first content) capped at 300 chars;
 *   pts  — up to 6 key lines from non-alternatives sections;
 *   alt  — up to 4 lines from "Alternatives/备选方案/替代方案" sections.
 */
function digest(body) {
  if (!body) return { sum: '', pts: [], alt: [] }
  const sections = []
  let cur = { name: '', lines: [] }
  const flush = () => { if (cur.name || cur.lines.length) sections.push(cur); cur = { name: '', lines: [] } }
  for (const line of body.split('\n')) {
    const m = line.match(/^#{1,4}\s+(.+)$/)
    if (m) { flush(); cur = { name: m[1].trim().toLowerCase(), lines: [] } }
    else cur.lines.push(line)
  }
  flush()
  const clean = (arr) => arr
    .map(s => s
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^\s*[-*]\s+/, '')
      .replace(/^\s*\d+[.)]\s+/, '')
      .replace(/\s+/g, ' ').trim())
    .filter(l => l && !/^(status:|archived:|english|\|)/i.test(l))
  const cap = (s, n) => s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s
  const isAlt = (name) => /alternatives|备选|替代方案/.test(name)
  const isProblem = (name) => /^problem|^问题/.test(name)
  const isDecision = (name) => /^decision|^决策/.test(name)
  const firstLine = (arr) => clean(arr).find(l => l.length > 20) ?? ''

  let sum = ''
  for (const s of sections) {
    if (isProblem(s.name)) { sum = firstLine(s.lines); if (sum) break }
    if (!sum && s.name === '') sum = firstLine(s.lines) // preamble
  }
  if (!sum) for (const s of sections) if (isDecision(s.name)) { sum = firstLine(s.lines); if (sum) break }
  if (!sum) for (const s of sections) { sum = firstLine(s.lines); if (sum) break }
  sum = cap(sum || '（无正文摘要）', 300)

  const pts = []
  const alt = []
  const dupOfSum = (l) => sum.startsWith(l.slice(0, 40)) || l.startsWith(sum.slice(0, 40))
  for (const s of sections) {
    const target = isAlt(s.name) ? alt : pts
    const limit = isAlt(s.name) ? 4 : 6
    for (const l of clean(s.lines)) {
      if (target.length >= limit || l.length <= 10) continue
      if (!isAlt(s.name) && dupOfSum(l)) continue
      target.push(cap(l, 110))
    }
  }
  return { sum, pts, alt }
}

function walk(root) {
  const notes = []
  const errors = []
  for (const lc of readdirSync(root, { withFileTypes: true })) {
    if (!lc.isDirectory()) continue
    if (!LIFECYCLES.includes(lc.name)) {
      errors.push(`${lc.name}/ — unknown lifecycle`)
      continue
    }
    for (const cls of readdirSync(join(root, lc.name), { withFileTypes: true })) {
      if (!cls.isDirectory()) {
        if (!SKIP_FILES.has(cls.name)) errors.push(`${lc.name}/${cls.name} — stray file`)
        continue
      }
      if (!CLASSES.includes(cls.name)) {
        errors.push(`${lc.name}/${cls.name}/ — unknown class`)
        continue
      }
      for (const file of readdirSync(join(root, lc.name, cls.name)).sort()) {
        if (!file.endsWith('.md') || file.endsWith('.zh.md')) continue
        const m = file.match(NOTE_FILE)
        if (!m) {
          errors.push(`${lc.name}/${cls.name}/${file} — bad filename`)
          continue
        }
        const base = file.replace(/\.md$/, '')
        const enPath = join(root, lc.name, cls.name, file)
        const zhPath = join(root, lc.name, cls.name, `${base}.zh.md`)
        const en = readTitle(enPath)
        const zh = readTitle(zhPath)
        const enBody = existsSync(enPath) ? readFileSync(enPath, 'utf8').replace(/^#\s+.+$/m, '').trim() : ''
        const zhBody = existsSync(zhPath) ? readFileSync(zhPath, 'utf8').replace(/^#\s+.+$/m, '').trim() : ''
        const zd = digest(zhBody || enBody)
        const ed = digest(enBody || zhBody)
        notes.push({
          d: m[1], l: lc.name, c: cls.name,
          te: en ?? file, tz: zh ?? en ?? file,
          bi: Boolean(zhBody) && zhBody !== enBody,
          sum: zd.sum, sume: ed.sum,
          pts: zd.pts, ptse: ed.pts,
          alt: zd.alt, alte: ed.alt,
        })
      }
    }
  }
  notes.sort((a, b) => a.d.localeCompare(b.d) || CLASSES.indexOf(a.c) - CLASSES.indexOf(b.c))
  return { notes, errors }
}

function main() {
  const rootArg = argValue('--notes-root')
  const outArg = argValue('-o') ?? argValue('--output')
  const sourceLabel = argValue('--source-label') ?? 'deepseek-harness'
  if (!rootArg) {
    console.error('usage: node scripts/export_agent_notes.mjs --notes-root <dsh-checkout>/.agents/notes [-o content/agent-notes.json] [--source-label <label>]')
    process.exit(2)
  }
  const root = resolve(rootArg)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`error: not a directory: ${root}`)
    process.exit(2)
  }
  const { notes, errors } = walk(root)
  for (const e of errors) console.error(`  ! ${e}`)
  if (errors.length) {
    console.error(`failed: ${errors.length} structure violation(s)`)
    process.exit(1)
  }
  const counts = { total: notes.length }
  for (const n of notes) counts[n.l] = (counts[n.l] ?? 0) + 1
  const payload = {
    generatedAt: new Date().toISOString(),
    source: sourceLabel,
    notesRoot: root,
    counts,
    notes,
  }
  const out = resolve(outArg ?? join(process.cwd(), 'content/agent-notes.json'))
  writeFileSync(out, `${JSON.stringify(payload)}\n`)
  console.log(`ok: ${notes.length} notes → ${out}`)
}

main()
