/*
 * 模拟比对页的伤害部分：左栏当前实装的伤害（只取一次），以及卡片底部的「当前 / 调整后 / 变化」对比表。
 * 和 detail/detail-damage.js 不是一回事：那边只画一张表，这边要拿两份结果逐行比大小。
 *
 * 从原 sim.js 原样搬出，只把 sim 状态改成从 sim-state.js 引入。
 */

import { state, T, el, api } from '../../core.js'
import { sim } from './sim-state.js'

/* 左栏伤害（与明细页同接口），只取一次缓存在 sim.leftDamage。 */
export async function loadLeftDamage () {
  if (sim.leftDamage) return
  const uid = state.uid
  if (!uid) return
  try {
    sim.leftDamage = await api(`accounts/${uid}/characters/${sim.avatarId}/damage`)
  } catch {
    sim.leftDamage = null
  }
}

/* 底部跨整卡对比表：技能名合并，当前/调整后/变化并排。视觉沿用明细页 .dmg-cont。
   ⚠️ 左右 rows 按下标配对（同一角色技能列表恒定），不按标题配（缺行会静默错位）。哪边短显示「—」。 */
export function drawDamageCompare () {
  const box = sim.dmgBox
  if (!box) return
  const left = sim.leftDamage
  const right = sim.right?.damage
  box.innerHTML = ''
  if (!left || !right || !left.rows?.length || !right.rows?.length) {
    box.append(el('div', 'sim-dmg-empty', T('dmgLoading')))
    return
  }

  const cont = el('div', 'dmg-cont sim-dmgfull-cont')
  const title = el('div', 'cont-title')
  title.append(document.createTextNode(T('dmgCompare')))
  cont.append(title)

  const table = el('div', 'cont-table')
  const head = el('div', 'tr thead')
  head.append(el('div', 'title dmg-title', T('dmgType')))
  head.append(el('div', '', T('dmgCur')))
  head.append(el('div', '', T('dmgAdj')))
  head.append(el('div', '', T('dmgDelta')))
  table.append(head)

  const n = Math.max(left.rows.length, right.rows.length)
  for (let i = 0; i < n; i++) {
    const leftRow = left.rows[i]
    const rightRow = right.rows[i]
    const tr = el('div', 'tr')
    tr.append(el('div', 'title dmg-title', (leftRow || rightRow)?.title || ''))

    /* 不吃暴击的行只有 avg，当唯一值。 */
    const leftVal = leftRow ? (leftRow.dmg || leftRow.avg) : null
    const rightVal = rightRow ? (rightRow.dmg || rightRow.avg) : null
    tr.append(el('div', 'value', leftVal == null ? '—' : leftVal + (leftRow.unit || '')))
    tr.append(el('div', 'value', rightVal == null ? '—' : rightVal + (rightRow.unit || '')))

    const cell = el('div', 'value')
    const delta = diffOf(leftVal, rightVal)
    if (delta != null && delta !== 0) {
      cell.classList.add(delta > 0 ? 'dmg-up' : 'dmg-down')
      cell.textContent = (delta > 0 ? '+' : '−') + Math.abs(delta).toLocaleString('en-US')
    } else {
      cell.textContent = '—'
    }
    tr.append(cell)
    table.append(tr)
  }
  cont.append(table)

  const foot = el('div', 'cont-footer dmg-desc')
  foot.append(el('span', '', T('dmgEnemy', { lv: left.enemyLv, name: left.enemyName })))
  cont.append(foot)
  box.append(cont)

  /* Buff 列表跟在伤害对比后面（明细页也是「表在上、buff 在下」） */
  const buff = buffCompare(left.buffs, right.buffs)
  if (buff) box.append(buff)
}

/*
 * Buff 列表的「可比版」—— 明细页那张只写「现在生效什么」，这里要回答
 * 「改了武器 / 圣遗物之后，buff 多了什么、少了什么、哪个数变了」。
 *
 *   · 两边都有、描述也一致            → 普通行
 *   · 两边都有、描述变了（精炼改数值）  → 描述写成「旧 → 新」
 *   · 只在调整后                     → 标「新增」
 *   · 只在当前                       → 标「失效」，补在列表末尾
 *
 * 配对先按「来源 + 描述」精确配，再按「来源」配：同一个来源本来就可能出现多次
 * （神里两条被动都叫「神里被动」），逐条按顺序配才不会把两条串了。
 */
function buffCompare (cur, adj) {
  const left = (cur || []).map(b => ({ title: b.title, desc: b.desc }))
  const rows = []

  /* ① 精确命中 = 没动过 */
  for (const b of adj || []) {
    const i = left.findIndex(x => x.title === b.title && x.desc === b.desc)
    if (i >= 0) left.splice(i, 1)
    rows.push({ title: b.title, desc: b.desc, kind: i >= 0 ? 'same' : 'todo' })
  }

  /* ② 同来源但描述不同 = 数值变了（换精炼、套装同系列换星级这类） */
  for (const r of rows) {
    if (r.kind !== 'todo') continue
    const i = left.findIndex(x => x.title === r.title)
    if (i >= 0) {
      r.oldDesc = left[i].desc
      left.splice(i, 1)
      r.kind = 'changed'
    } else {
      r.kind = 'new'
    }
  }

  /* ③ 剩下的：当前有、调整后没有 = 失效 */
  for (const b of left) rows.push({ title: b.title, desc: b.desc, kind: 'gone' })

  if (!rows.length) return null

  const cont = el('div', 'dmg-cont dmg-msg sim-buff')
  const title = el('div', 'cont-title')
  title.append(document.createTextNode(T('dmgBuff')))
  title.append(el('span', '', T('dmgBuffTip')))
  cont.append(title)

  const table = el('div', 'cont-table')
  for (const r of rows) {
    const tr = el('div', 'tr' + (r.kind === 'same' ? '' : ' is-' + r.kind))
    tr.append(el('div', 'th', r.title))
    const td = el('div', 'td')
    if (r.kind === 'new') td.append(el('span', 'sim-buff-tag is-new', T('simBuffNew')))
    if (r.kind === 'gone') td.append(el('span', 'sim-buff-tag is-gone', T('simBuffGone')))
    if (r.kind === 'changed') {
      /* 只换掉变了的那段（数值），整句仍读得通 */
      td.append(el('span', 'sim-val-old', r.oldDesc), el('i', 'sim-arrow', '→'), el('span', 'sim-val-new', r.desc))
    } else {
      td.append(document.createTextNode(r.desc))
    }
    tr.append(td)
    table.append(tr)
  }
  cont.append(table)
  return cont
}

/* 两个「3,946」这样的字符串相减；任一边非纯数字返回 null（宁可「—」也别 NaN）。 */
function diffOf (a, b) {
  const na = typeof a === 'string' ? Number(a.replace(/,/g, '')) : a
  const nb = typeof b === 'string' ? Number(b.replace(/,/g, '')) : b
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null
  return nb - na
}
