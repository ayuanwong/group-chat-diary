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

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}

function readTitle(file) {
  if (!existsSync(file)) return null
  const m = readFileSync(file, 'utf8').match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : basename(file, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ')
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
        const en = readTitle(join(root, lc.name, cls.name, file))
        const zh = readTitle(join(root, lc.name, cls.name, `${base}.zh.md`))
        notes.push({ d: m[1], l: lc.name, c: cls.name, te: en ?? file, tz: zh ?? en ?? file })
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
