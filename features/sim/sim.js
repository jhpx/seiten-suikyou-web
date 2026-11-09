/*
 * 模拟比对页的编排与入口：同一角色两套配装并排 —— 左栏当前实装，右栏手工调整后的。
 * 数据来自两个接口：
 *   GET  .../characters/:avatarId/simulator  → 可选装备目录（武器 / 套装 / 词条候选）
 *   POST .../characters/:avatarId/simulator  → 按草稿重算的面板 + 伤害
 * 右栏词条是用户手填的最终值（自由口径），不显示评分。
 *
 * 原 898 行单文件按职责拆成四块，本文件只留「整页怎么拼」和入口：
 *   sim-state.js   目录 / 草稿 / 重算状态
 *   sim-cards.js   角色头、属性表、武器与圣遗物卡
 *   sim-dialogs.js 两个「改」弹窗与表单工具
 *   sim-damage.js  左栏伤害与底部对比表
 * 拆的时候函数体逐字照搬，没有改行为。
 */

import { $, T, el, setBg, showView, reg } from '../../core.js'
import { sim, setRedraw, resetCatalog, startCatalog, recompute, currentAvatar } from './sim-state.js'
import { heroBanner, attrPanel, weaponCard, wrapArti, artiCard } from './sim-cards.js'
import { loadLeftDamage, drawDamageCompare } from './sim-damage.js'

function renderSim () {
  const box = $('view-sim')
  box.innerHTML = ''
  if (sim.avatarId == null) {
    box.append(el('div', 'placeholder', T('noData')))
    return
  }

  /* 顶栏只有 ← 返回；角色名交给下方 hero（明细页同样砍掉了顶栏重复名）。 */
  const bar = el('div', 'sim-head')
  const back = el('button', 'btn back', '← ' + T('back'))
  back.addEventListener('click', () => showView('detail'))
  bar.append(back)
  box.append(bar)

  /* 卡片本体：元素背景整张铺满（同明细页 .pd-canvas 路子），宽度用 --app-width 全局内容带。 */
  const av = currentAvatar()
  const card = setBg(el('div', 'sim-card' + (av ? ' elem-' + av.elem : '')), av?.elemBg || '')
  card.append(heroBanner())

  /* 单栏：右栏（重算后）已表达「旧→新」，左栏纯旧值只是重复，故只渲染一份（武器 + 5 圣遗物）。
     未算完时先用账号视图顶上（结构一致，只差 dirty 标记），算完重画。 */
  const view = sim.right?.avatar || av
  if (!view) {
    card.append(el('div', 'placeholder', T('noData')))
  } else {
    const panel = el('div', 'sim-panel')
    panel.append(attrPanel(view))
    card.append(panel)
    const grid = el('div', 'sim-pieces')
    grid.append(wrapArti(weaponCard(view, true)))
    for (const a of view.artifacts || []) grid.append(wrapArti(artiCard(a, true, view.charWeight)))
    card.append(grid)
  }

  /* 伤害对比表跨整卡宽放在两栏之下，技能名合并、当前/调整后/变化并排。 */
  const dmgBox = el('div', 'sim-dmgfull')
  dmgBox.append(el('div', 'placeholder', T('dmgLoading')))
  card.append(dmgBox)
  box.append(card)

  sim.dmgBox = dmgBox
  loadLeftDamage().then(drawDamageCompare)
}

/* 重算完成后状态层要重画页面。回调注进去，状态层就不必反过来 import 编排层（无循环依赖）。 */
setRedraw(() => { renderSim(); drawDamageCompare() })

/* 从明细页点进来。 */
export function openSim (avatarId) {
  sim.avatarId = avatarId
  sim.draft = { weapon: null, artifacts: [] }
  sim.right = null
  sim.leftDamage = null
  sim.dmgBox = null
  /* 目录跟「角色武器类型」走（迪奥娜只有弓），换角色必须重拉。 */
  resetCatalog()
  showView('sim')
  renderSim()
  startCatalog().then(() => recompute())
}

reg.openSim = openSim
