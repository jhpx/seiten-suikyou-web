/*
 * 明细页下侧的伤害计算段：标题条 + 表格 + 页脚 + Buff 列表。
 * 结构照 miao 的 profile-detail.html「伤害表格」块；去掉了网页版没有对应物的两样
 * （dmg-idx 列、QQ 指令提示）。api 与 fitDetailScale 来自 core / detail-fit。
 */
import { el, T, api, state } from '../../core.js'
import { fitDetailScale } from './detail-fit.js'

/*
 * ⚠️ renderDetail 每次渲染都会调 loadDamage（切语言、回首页再进来都会），而 fetch 是异步的：
 * 回来时用户可能已经点了另一个角色。所以填之前必须核对还停在同一个角色上
 * （state.selectedAvatarId === av.avatarId），否则会把 A 的伤害填进 B 的页面。
 * 同一个角色重复渲染时旧请求回来也没关系：数据一样，且 box 已被 innerHTML='' 清空重建。
 */
async function loadDamage (av, box) {
  box.append(dmgStatus(T('dmgLoading')))
  let dmg = null
  try {
    dmg = await api(`accounts/${av.uid}/characters/${av.avatarId}/damage`)
  } catch (e) {
    if (state.selectedAvatarId !== av.avatarId) return
    console.error('[damage] 明细页伤害计算失败:', e)
    box.innerHTML = ''
    box.append(dmgStatus(T('dmgFail'), true))
    return
  }
  if (state.selectedAvatarId !== av.avatarId) return
  box.innerHTML = ''
  /* data 为 null = 这个角色算不出伤害（没配 calc.js 等）—— 出一行小字说明，不出表 */
  if (!dmg) { box.append(dmgStatus(T('dmgNone'))); return }
  box.append(renderDmgList(dmg))
  if (dmg.buffs?.length) box.append(renderDmgBuffs(dmg.buffs))
  /* 伤害表加到画布里会让整卡变高，重算外壳高度，否则下方内容叠上来 */
  fitDetailScale()
}

/* 骨架 / 失败 / 无数据三种「只有一行字」的状态共用一个外壳 */
function dmgStatus (text, err = false) {
  const cont = el('div', 'dmg-cont dmg-list cont')
  cont.append(el('div', 'cont-title', T('dmgSection')))
  cont.append(el('div', 'dmg-status' + (err ? ' err' : ''), text))
  return cont
}

function dmgHead () {
  const tr = el('div', 'tr thead')
  tr.append(el('div', 'title dmg-title', T('dmgType')))
  tr.append(el('div', '', T('dmgCrit')))
  tr.append(el('div', '', T('dmgAvg')))
  return tr
}

function renderDmgList (dmg) {
  const cont = el('div', 'dmg-cont dmg-list cont')
  cont.append(el('div', 'cont-title', T('dmgSection')))
  const table = el('div', 'cont-table')
  table.append(dmgHead())
  for (const e of dmg.rows) {
    const tr = el('div', 'dmg tr')
    tr.append(el('div', 'title dmg-title', e.title))
    if (e.dmg) {
      tr.append(el('div', 'value', e.dmg + e.unit))
      tr.append(el('div', 'value', e.avg + e.unit))
    } else {
      /* 反应 / 护盾 / 治疗类不吃暴击，没有暴击伤害 —— 期望值跨两列独占一行。
         行里只发两个单元格（标题 + 期望值），跨列靠 CSS 的 grid-column，不是留个空单元格。 */
      tr.append(el('div', 'value value-full', e.avg + e.unit))
    }
    table.append(tr)
  }
  cont.append(table)
  const foot = el('div', 'cont-footer dmg-desc')
  foot.append(el('span', '', T('dmgEnemy', { lv: dmg.enemyLv, name: dmg.enemyName })))
  if (dmg.createdBy) {
    /* 冒号在文案键里（dmgSource 末尾）—— 各语言的标点不一样，不硬拼 */
    const by = el('span', 'dmg-created-by')
    by.append(document.createTextNode(T('dmgSource')))
    by.append(el('strong', '', dmg.createdBy))
    foot.append(by)
  }
  cont.append(foot)
  return cont
}

function renderDmgBuffs (buffs) {
  const cont = el('div', 'dmg-cont dmg-msg cont')
  const title = el('div', 'cont-title')
  title.append(document.createTextNode(T('dmgBuff')))
  title.append(el('span', '', T('dmgBuffTip')))
  cont.append(title)
  const table = el('div', 'cont-table')
  for (const b of buffs) {
    const tr = el('div', 'tr')
    tr.append(el('div', 'th', b.title))
    tr.append(el('div', 'td', b.desc))
    table.append(tr)
  }
  cont.append(table)
  return cont
}

export { loadDamage }
