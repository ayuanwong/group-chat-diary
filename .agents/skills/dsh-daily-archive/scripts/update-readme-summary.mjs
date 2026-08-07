#!/usr/bin/env node
/**
 * update-readme-summary.mjs — insert the newest 每日基本纪要 section into the
 * group-chat-diary README from the two newest snapshots (deterministic part).
 *
 * The repo's data scripts activate D1/CONTENT_DB and write snapshots/, but do
 * not update the README 每日基本纪要 narrative. This script computes the
 * numeric section (stats table, deltas, issue category split, top topic
 * deltas) from snapshots/; the agent (dsh headless or Codex) then polishes
 * the 讨论重点 wording and commits.
 *
 * Usage:
 *   node update-readme-summary.mjs [--repo <dir>] [--date YYYY-MM-DD] [--dry-run]
 *
 * Defaults: repo = $DSH_DIARY_REPO or ~/Projects/dsh-external/group-chat-diary;
 * date = the newest snapshot (per latest.txt, else newest file in snapshots/).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_DEFAULT = process.env.DSH_DIARY_REPO ?? join(process.env.HOME ?? '.', 'Projects/dsh-external/group-chat-diary')
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CAT_LABELS = { 'bug修复': 'Bug 修复' }

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}

function beijingClock(date) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((m, p) => (m[p.type] = p.value, m), {})
  return `${parts.year}-${parts.mo}-${parts.d} ${parts.h}:${parts.mi}`
}

function die(msg) { console.error(`error: ${msg}`); process.exit(1) }

function main() {
  const repo = resolve(argValue('--repo') ?? REPO_DEFAULT)
  const forcedDate = argValue('--date')
  const dryRun = process.argv.includes('--dry-run')
  if (forcedDate && !DATE_RE.test(forcedDate)) die('--date 必须是 YYYY-MM-DD')
  if (!existsSync(repo) || !statSync(repo).isDirectory()) die(`repo not found: ${repo}`)

  const snapDir = join(repo, 'snapshots')
  const latestTxt = join(repo, 'latest.txt')
  let dates = readdirSync(snapDir).filter(f => DATE_RE.test(f.replace(/\.json$/, ''))).map(f => f.slice(0, 10)).sort()
  if (existsSync(latestTxt)) {
    const fromTxt = readFileSync(latestTxt, 'utf8').trim().replace(/\.json$/, '')
    if (DATE_RE.test(fromTxt) && dates.includes(fromTxt)) {
      dates = [fromTxt, ...dates.filter(d => d !== fromTxt)].sort()
    }
  }
  if (!dates.length) die('snapshots/ 为空')
  const currentDate = forcedDate ?? dates[dates.length - 1]
  const prevDate = dates[dates.length - 2] ?? null
  if (forcedDate && !dates.includes(forcedDate)) die(`snapshots/ 中没有 ${forcedDate}`)
  if (!prevDate) die('snapshots/ 中不足两份，无法计算增量')

  const cur = JSON.parse(readFileSync(join(snapDir, `${currentDate}.json`), 'utf8'))
  const prev = JSON.parse(readFileSync(join(snapDir, `${prevDate}.json`), 'utf8'))
  const cmp = cur.comparison ?? {}
  if (cmp.status !== 'ready') die(`comparison 不可用: ${cmp.status ?? 'missing'}`)

  const group = cur.group ?? {}
  const issues = cur.issues?.issues ?? []
  const prevGroup = prev.group ?? {}
  const newIssues = (cmp.newIssueNumbers ?? [])
    .map(n => issues.find(i => i.n === n)).filter(Boolean)
  const cats = {}
  for (const i of newIssues) cats[i.cat || '其他'] = (cats[i.cat || '其他'] || 0) + 1
  const catList = Object.entries(cats).sort((a, b) => b[1] - a[1])
  const top3 = cmp.topicDeltas?.slice(0, 3) ?? []
  const cutoff = group.stats?.date_end ?? ''
  const cutoffText = cutoff ? cutoff.slice(0, 16).replace('T', ' ') : `${beijingClock()}`

  const catLines = []
  if (catList.length) {
    const head = catList[0]
    const rest = catList.slice(1)
    let line = `- 新增 Issue 以 **${CAT_LABELS[head[0]] ?? head[0]} ${head[1]} 条（${(head[1] / newIssues.length * 100).toFixed(1)}%）** 为主`
    if (rest.length) {
      const second = rest[0]
      line += `，其次是 **${CAT_LABELS[second[0]] ?? second[0]} ${second[1]} 条（${(second[1] / newIssues.length * 100).toFixed(1)}%）**`
      if (rest.length > 1) line += `；另有其他 ${rest.slice(1).reduce((s, [, n]) => s + n, 0)} 条`
    }
    line += '。'
    catLines.push(line)
  }

  const section = `### ${currentDate}

网站日期：[DSH 内测群每日档案 · ${currentDate}](https://dsh.hiwangjie.com/?date=${currentDate})

数据截止：${cutoffText}（北京时间）

| 群消息 | 精选信号 | 成员 | Issue | 纪事 |
| ---: | ---: | ---: | ---: | ---: |
| ${Number(group.stats?.accepted_messages ?? 0).toLocaleString('zh-CN')} | ${group.signals?.length ?? 0} | ${group.members?.length ?? 0} | ${issues.length} | ${group.chronicles?.length ?? 0} |

**相较 ${cmp.previousLabel}**

- 新增有效群消息 **${Number(cmp.newMessageCount ?? 0).toLocaleString('zh-CN')}** 条，新增精选信号 **${cmp.newSignalMessageIds?.length ?? 0}** 条；
- 新增成员 **${(group.members?.length ?? 0) - (prevGroup.members?.length ?? 0)}** 位，新增 Issue **${cmp.newIssueNumbers?.length ?? 0}** 条，新增纪事 **${(group.chronicles?.length ?? 0) - (prevGroup.chronicles?.length ?? 0)}** 条；
${catLines.length ? catLines.join('\n') + '\n' : ''}
**讨论重点**

${top3.length
  ? top3.map((t, i) => `- ${(t.label + '相关').replace(/([A-Za-z0-9])(相关)/, '$1 相关')}讨论${i === 0 ? '增量最高' : '继续增长'}（+${t.delta}）；`).join('\n')
  : '- 本轮无显著主题增量。'}

**文件更新**

- 仅刷新当日 JSON 快照、私有完整语料、日期清单与 README 纪要。
`

  const readmeFile = join(repo, 'README.md')
  let readme = readFileSync(readmeFile, 'utf8')
  const anchor = '## 每日基本纪要\n'
  if (!readme.includes(anchor)) die('README.md 缺少 "## 每日基本纪要"')
  if (readme.includes(`### ${currentDate}\n`)) die(`README 已存在 ${currentDate} 的纪要，拒绝重复插入`)

  if (dryRun) {
    console.log(section)
    console.log('--- dry-run: README 未修改 ---')
    return
  }
  readme = readme.replace(anchor, anchor + '\n' + section)
  writeFileSync(readmeFile, readme)
  console.log(`ok: README.md 已插入 ${currentDate} 纪要（相较 ${cmp.previousLabel}）`)
}

main()
