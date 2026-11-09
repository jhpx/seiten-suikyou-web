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
}

/* 两个「3,946」这样的字符串相减；任一边非纯数字返回 null（宁可「—」也别 NaN）。 */
function diffOf (a, b) {
  const na = typeof a === 'string' ? Number(a.replace(/,/g, '')) : a
  const nb = typeof b === 'string' ? Number(b.replace(/,/g, '')) : b
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null
  return nb - na
}
