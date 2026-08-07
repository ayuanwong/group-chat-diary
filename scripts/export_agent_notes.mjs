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
import { execFileSync } from 'node:child_process'

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
  // Newest first: the site list reads top-down as "latest decisions".
  notes.sort((a, b) => b.d.localeCompare(a.d) || CLASSES.indexOf(a.c) - CLASSES.indexOf(b.c))
  return { notes, errors }
}

// ── history tracking ─────────────────────────────────────────────────
// Snapshot refs (e.g. refs/remotes/origin/snapshots/20260803T142347Z-…) carry
// the notes tree at different dates; consecutive inventories give per-day
// added / removed / archived (implemented→archived) / moved diffs.

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function refDate(name) {
  const m = name.match(/(\d{4})(\d{2})(\d{2})T/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function discoverSnapshotRefs(repo, notesRel) {
  // Curated daily snapshots only; dsh-staging/* branches are WIP states.
  const patterns = [
    'refs/remotes/origin/snapshots/*', 'refs/heads/snapshots/*',
  ]
  let refs = []
  try {
    refs = git(repo, ['for-each-ref', '--format=%(refname:short)|%(creatordate:unix)', ...patterns])
      .split('\n').filter(Boolean)
      .map(line => { const [name, ts] = line.split('|'); return { name, ts: Number(ts || 0) } })
  } catch { return [] }
  const ok = []
  for (const r of refs) {
    try {
      const files = git(repo, ['ls-tree', '-r', '--name-only', r.name, '--', notesRel])
      if (files.split('\n').filter(Boolean).some(p => p.includes(`${notesRel}/`))) ok.push(r)
    } catch { /* ref without the notes subtree */ }
  }
  // oldest first by the date encoded in the ref name (creatordate can be
  // shared across refs pointing at the same commit), dedupe per date.
  ok.sort((a, b) => {
    const da = refDate(a.name) ?? ''
    const db = refDate(b.name) ?? ''
    return da.localeCompare(db) || a.ts - b.ts
  })
  const seen = new Set()
  const unique = []
  for (const r of ok) {
    const d = refDate(r.name) ?? ''
    if (seen.has(d)) continue
    seen.add(d)
    unique.push(r)
  }
  return unique.slice(-14) // bounded history depth
}

function inventoryFromRef(repo, ref, notesRel) {
  const items = []
  try {
    const paths = git(repo, ['ls-tree', '-r', '-z', '--name-only', ref, '--', notesRel]).split('\0').filter(Boolean)
    for (const p of paths) {
      const rel = p.startsWith(`${notesRel}/`) ? p.slice(notesRel.length + 1) : p
      const segs = rel.split('/')
      if (segs.length !== 3) continue
      const [lc, cls, file] = segs
      if (!LIFECYCLES.includes(lc) || !CLASSES.includes(cls)) continue
      if (!file.endsWith('.md') || file.endsWith('.zh.md')) continue
      const m = file.match(NOTE_FILE)
      if (!m) continue
      items.push({ p: rel, d: m[1], l: lc, c: cls, t: null })
    }
    const titles = new Map()
    for (const line of git(repo, ['grep', '-e', '^# ', ref, '--', notesRel]).split('\n')) {
      const rest = line.slice(line.indexOf(':') + 1) // drop "<ref>:"
      const ci = rest.indexOf(':')
      if (ci < 0) continue
      const path = rest.slice(0, ci)
      if (!titles.has(path)) titles.set(path, rest.slice(ci + 1).replace(/^#\s+/, '').trim())
    }
    for (const item of items) {
      item.t = titles.get(`${notesRel}/${item.p}`) ?? item.p.split('/').pop().replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '').replace(/-/g, ' ')
    }
  } catch { /* treat ref as empty */ }
  return items
}

function diffSnapshots(prev, cur) {
  const prevByPath = new Map(prev.map(n => [n.p, n]))
  const curByPath = new Map(cur.map(n => [n.p, n]))
  const baseName = (n) => n.p.split('/').pop().replace(/\.md$/, '')
  const prevBase = new Map(prev.map(n => [baseName(n), n]))
  const curBase = new Map(cur.map(n => [baseName(n), n]))
  const movedBases = new Set()
  const archived = []
  const moved = []
  for (const [base, pn] of prevBase) {
    const cn = curBase.get(base)
    if (cn && cn.p !== pn.p) {
      movedBases.add(base)
      moved.push({ t: cn.t, from: pn.p, to: cn.p })
      if (pn.l === 'implemented' && cn.l === 'archived') archived.push({ t: cn.t })
    }
  }
  // Moved notes are reported once (moved/archived); exclude them from add/remove.
  const added = cur.filter(n => !prevByPath.has(n.p) && !movedBases.has(baseName(n)))
  const removed = prev.filter(n => !curByPath.has(n.p) && !movedBases.has(baseName(n)))
  return { added, removed, archived, moved }
}

function buildHistory(repo, notesRel) {
  const refs = discoverSnapshotRefs(repo, notesRel)
  if (!refs.length) return []
  const inventories = refs.map(r => ({ ref: r.name, date: refDate(r.name), notes: inventoryFromRef(repo, r.name, notesRel) }))
  const history = []
  let previous = null
  for (const inv of inventories) {
    const counts = { total: inv.notes.length }
    for (const n of inv.notes) counts[n.l] = (counts[n.l] ?? 0) + 1
    const diff = previous ? diffSnapshots(previous.notes, inv.notes) : null
    history.push({
      date: inv.date ?? inv.ref,
      ref: inv.ref,
      counts,
      added: diff?.added ?? [],
      removed: diff?.removed ?? [],
      archived: diff?.archived ?? [],
      moved: diff?.moved ?? [],
    })
    previous = inv
  }
  return history
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
  // History from git snapshot refs of the notes' repository (empty when unavailable).
  const repoRoot = resolve(root, '../..')
  const hasGit = existsSync(join(repoRoot, '.git'))
  const history = hasGit ? buildHistory(repoRoot, '.agents/notes') : []
  if (history.length) console.log(`history: ${history.length} snapshots (${history[0].date} → ${history[history.length - 1].date})`)
  const payload = {
    generatedAt: new Date().toISOString(),
    source: sourceLabel,
    notesRoot: root,
    counts,
    notes,
    history,
  }
  const out = resolve(outArg ?? join(process.cwd(), 'content/agent-notes.json'))
  writeFileSync(out, `${JSON.stringify(payload)}\n`)
  console.log(`ok: ${notes.length} notes → ${out}`)
}

main()
