/*
 * 模拟比对页 —— 同一角色的两套配装并排：左栏是当前实装，右栏是手工调整后的。
 *
 * 版式不照抄明细页那张 600px 画布（那是「一张结果图」），而是**两栏各自成列**：
 * 明细页的 .basic/.artis 那些宽度都写死在 miao.css 里（600px 画布的前提），
 * 塞进半屏会被裁。所以这里只借用它的**卡片语言**（圆角 + 描边 + 深色底 + 金色标题），
 * 尺寸全部自己定 —— 布局用 CSS grid，窄屏自动上下堆叠。
 *
 * 数据来自两个接口：
 *   GET  .../characters/:avatarId/simulator   → 可选装备目录（武器 / 套装 / 主副词条候选）
 *   POST .../characters/:avatarId/simulator   → 按草稿重算的面板 + 伤害
 * 左栏是**当前实装**：直接用账号视图里那个角色（shapeCharacter 的产物）+ 伤害接口。
 *
 * ⚠️ 右栏的词条数值是**用户手填的最终值**，与真实装备的「若干次 roll 之和」口径不同
 *    （这是用户明确选的自由口径）。所以右栏不显示评分 —— 评分对不上真实装备的算法，
 *    显示出来会误导。
 */
import {
  $, state, T, el, slotGlyph, api, reg, showView, openDialog, W_ATTR_TITLE
} from './core.js'

/* 模拟页的本地状态：草稿（用户改到哪了）+ 目录 + 右栏结果 */
const sim = {
  avatarId: null,
  catalog: null,
  draft: { weapon: null, artifacts: [] },
  right: null,
  busy: false
}

/* ───────────────────────── 数据 ───────────────────────── */

/** 当前实装那个角色的视图（账号视图里的 avatars[]） */
function currentAvatar () {
  if (!state.view || sim.avatarId == null) return null
  return state.view.avatars.find(a => a.avatarId === sim.avatarId) || null
}

/** 按草稿重算右栏 */
async function recompute () {
  const uid = state.uid
  if (!uid || sim.avatarId == null) return
  sim.busy = true
  try {
    const res = await api(`accounts/${uid}/characters/${sim.avatarId}/simulator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sim.draft)
    })
    sim.right = res
  } catch (e) {
    sim.right = null
    console.error('[sim] 模拟失败:', e)
  } finally {
    sim.busy = false
    renderSim()
  }
}

/* ───────────────────────── 渲染 ───────────────────────── */

function renderSim () {
  const box = $('view-sim')
  box.innerHTML = ''
  if (sim.avatarId == null) {
    box.append(el('div', 'placeholder', T('noData')))
    return
  }

  /* 顶栏：← 返回 + 角色名 */
  const bar = el('div', 'sim-head')
  const back = el('button', 'btn back', '← ' + T('back'))
  back.addEventListener('click', () => { showView('detail'); renderSim() })
  const av = currentAvatar()
  bar.append(back, el('span', 'sim-title', av ? av.name : ''), el('span', 'sim-gap'))
  /* 复原：把草稿清空 = 右栏回到当前实装。改花了眼时一键回到起点，省得一件件退回 */
  const reset = el('button', 'btn', T('simReset'))
  reset.addEventListener('click', resetDraft)
  bar.append(reset)
  box.append(bar)

  const cols = el('div', 'sim-cols')

  const left = el('div', 'sim-col')
  left.append(el('h2', 'sim-col-title', T('simCurrent')))
  left.append(currentPane())
  cols.append(left)

  const right = el('div', 'sim-col')
  right.append(el('h2', 'sim-col-title', T('simAdjusted')))
  right.append(adjustedPane())
  cols.append(right)

  box.append(cols)
}

/** 左栏：当前实装的面板 + 武器 + 圣遗物 + 伤害 */
function currentPane () {
  const wrap = el('div', 'sim-pane')
  const av = currentAvatar()
  if (!av) {
    wrap.append(el('div', 'placeholder', T('noData')))
    return wrap
  }
  wrap.append(attrPanel(av))
  wrap.append(weaponView(av.weapon))
  wrap.append(artiView(av.artifacts))
  const dmg = el('div', 'sim-dmg')
  dmg.append(el('div', 'placeholder', T('dmgLoading')))
  wrap.append(dmg)
  loadCurrentDamage(dmg)
  return wrap
}

/** 左栏伤害：与明细页同一个接口 */
async function loadCurrentDamage (box) {
  const uid = state.uid
  if (!uid) return
  try {
    const d = await api(`accounts/${uid}/characters/${sim.avatarId}/damage`)
    box.innerHTML = ''
    box.append(damageTable(d))
  } catch {
    box.innerHTML = ''
    box.append(el('div', 'placeholder', T('dmgFail')))
  }
}

/** 右栏：改后的面板 + 可编辑的武器/圣遗物 + 伤害 */
function adjustedPane () {
  const wrap = el('div', 'sim-pane')
  if (!sim.right) {
    wrap.append(el('div', 'placeholder', sim.busy ? T('simCalculating') : T('simEmpty')))
    return wrap
  }
  const av = sim.right.avatar
  wrap.append(attrPanel(av))
  wrap.append(weaponEditor(av))
  wrap.append(artiEditor(av.artifacts))
  wrap.append(damageTable(sim.right.damage))
  return wrap
}

/* ───────────────────────── 面板 ───────────────────────── */

/**
 * 面板属性表（左右两栏同款）。
 *
 * ⚠️ 这里**不复用**明细页那个 `ul.char-attr`：它的列宽是照 600px 画布写死的
 * （图标 / 标题 / 权重 / 数值 / 拆分五列 + 绝对定位），塞进半屏的栏里会整体错位。
 * 模拟页只要三样东西 —— 词条名、最终值、基础+加成；**评价权重不显示**（用户明确要求两栏都不显示评分）。
 *
 * 差异标注：与左栏同一项数值不同就整行提亮并写出「改动前 → 改动后」。
 * 这是这个页面存在的理由 —— 用户换一件装备就是为了看这里变没变。
 */
function attrPanel (av) {
  const box = el('div', 'sim-attrs')
  const base = currentAvatar()
  const baseMap = new Map((base?.attrTable || []).map(r => [r.key, r.value]))
  for (const r of av.attrTable || []) {
    const row = el('div', 'sim-attr')
    row.append(el('span', 'sim-aname', r.label))
    row.append(el('span', 'sim-aval', r.value))
    row.append(el('span', 'sim-abreak', `${r.base} + ${r.plus}`))
    const prev = baseMap.get(r.key)
    if (prev !== undefined && prev !== r.value) {
      row.classList.add('is-changed')
      row.append(el('span', 'sim-diff', prev + ' → ' + r.value))
    }
    box.append(row)
  }
  return box
}

/* ───────────────────────── 武器 ───────────────────────── */

/** 武器卡（只读） */
function weaponView (w) {
  const box = el('div', 'sim-weapon')
  const head = el('div', 'sim-whead')
  head.append(el('strong', '', w?.name || T('noWeapon')))
  head.append(el('span', 'sim-wmeta', `Lv.${w?.level ?? '?'} · ${T('refine')}${w?.affix ?? 1}`))
  box.append(head)
  box.append(weaponAttrs(w))
  return box
}

/* 武器主副属性：key→短名的映射跟明细页共用同一张表（core.W_ATTR_TITLE），
   别再这里另抄一份 —— 两边会漂 */
function weaponAttrs (w) {
  const attrs = el('div', 'sim-wattrs')
  for (const [k, v] of Object.entries(w?.attrs || {})) {
    const d = el('div')
    d.append(el('span', '', W_ATTR_TITLE[k] || k), el('b', '', '+' + v))
    attrs.append(d)
  }
  return attrs
}

/** 武器卡（可改：型号 / 等级 / 精炼） */
function weaponEditor (av) {
  const box = el('div', 'sim-weapon sim-editable')
  const w = av.weapon || {}
  const head = el('div', 'sim-whead')
  head.append(el('strong', '', w.name || T('noWeapon')))
  head.append(el('span', 'sim-wmeta', `Lv.${w.level ?? '?'} · ${T('refine')}${w.affix ?? 1}`))
  box.append(head, weaponAttrs(w))
  /* ⚠️ 不能写 el('div','sim-edit', ...sels) —— el 的第三个参数是**文本**，会把 select 转成
     "[object HTMLSelectElement]" 当字符串塞进去（第一版就是这么翻车的）。逐个 append。 */
  const edit = el('div', 'sim-edit')
  for (const ctl of weaponPickers()) edit.append(ctl)
  box.append(edit)
  return box
}

/** 三个下拉（型号 / 等级 / 精炼） */
function weaponPickers () {
  const cur = draftWeapon()
  const out = []

  const wSel = el('select', 'sim-select')
  for (const w of sim.catalog?.weapons || []) {
    const o = el('option', '', w.star >= 5 ? `${w.name} ★` : w.name)
    o.value = String(w.itemId)
    if (w.itemId === cur.itemId) o.selected = true
    wSel.append(o)
  }
  wSel.addEventListener('change', () => {
    setDraftWeapon({ itemId: Number(wSel.value), level: cur.level, affix: cur.affix })
  })
  out.push(wSel)

  const lvSel = el('select', 'sim-select')
  for (const lv of [1, 20, 40, 60, 80, 90]) {
    const o = el('option', '', `Lv.${lv}`)
    o.value = String(lv)
    if (lv === cur.level) o.selected = true
    lvSel.append(o)
  }
  lvSel.addEventListener('change', () => {
    setDraftWeapon({ itemId: cur.itemId, level: Number(lvSel.value), affix: cur.affix })
  })
  out.push(lvSel)

  const afSel = el('select', 'sim-select')
  for (const a of [1, 2, 3, 4, 5]) {
    const o = el('option', '', `${T('refine')}${a}`)
    o.value = String(a)
    if (a === cur.affix) o.selected = true
    afSel.append(o)
  }
  afSel.addEventListener('change', () => {
    setDraftWeapon({ itemId: cur.itemId, level: cur.level, affix: Number(afSel.value) })
  })
  out.push(afSel)

  return out
}

/** 草稿里的武器（没改过就是当前实装那把） */
function draftWeapon () {
  if (sim.draft.weapon) return sim.draft.weapon
  const w = currentAvatar()?.weapon
  if (!w || w.state === 'none') return { itemId: 0, level: 1, affix: 1 }
  return { itemId: w.itemId ?? 0, level: w.level ?? 1, affix: w.affix ?? 1 }
}

function setDraftWeapon (w) {
  sim.draft.weapon = w
  recompute()
}

/** 清空草稿：右栏立刻回到「当前实装」（空草稿在后端就是「什么都别改」） */
function resetDraft () {
  sim.draft = { weapon: null, artifacts: [] }
  recompute()
}

/* ───────────────────────── 圣遗物 ───────────────────────── */

/** 圣遗物列表（只读） */
function artiView (list) {
  const box = el('div', 'sim-artis')
  for (const a of list || []) box.append(artiRow(a, false))
  return box
}

/** 圣遗物列表（可改） */
function artiEditor (list) {
  const box = el('div', 'sim-artis')
  for (const a of list || []) box.append(artiRow(a, true))
  return box
}

function artiRow (a, editable) {
  const row = el('div', 'sim-arti')
  const icon = el('div', 'sim-aicon')
  icon.append(el('span', '', slotGlyph(a.pos)))
  const main = el('div', 'sim-amain')
  main.append(el('strong', '', a.empty ? T('notEquipped') : (a.name || '')))
  const sub = el('div', 'sim-asub')
  if (a.main) sub.append(el('span', '', `${a.main.label} ${a.main.value}`))
  for (const s of a.subs || []) sub.append(el('span', '', `${s.label} ${s.value}`))
  main.append(sub)
  row.append(icon, main)
  if (editable) {
    const btn = el('button', 'sim-editbtn', T('simEdit'))
    btn.addEventListener('click', () => openArtiDialog(a))
    row.append(btn)
  }
  return row
}

/** 改一件圣遗物：套装 / 等级 / 主词条 / 副词条 */
function openArtiDialog (a) {
  const cur = draftOfPos(a.pos) || defaultDraftOf(a)
  const dlg = openDialog({
    title: `${T('simEdit')} · ${slotGlyph(a.pos)}`,
    onOk: () => {
      const next = {
        set: setSel.value,
        pos: a.pos,
        star: cur.star || 5,
        level: Number(lvSel.value),
        mainKey: mainSel.value,
        subs: subs.map((s, i) => ({
          key: s.keySel.value,
          value: Number(s.valInput.value)
        }))
      }
      setDraftArtifact(next)
    }
  })

  const body = dlg.body

  /* 套装 */
  const setSel = el('select', 'sim-select')
  for (const s of sim.catalog?.sets || []) {
    const o = el('option', '', s.name)
    o.value = s.key
    if (s.key === cur.set) o.selected = true
    setSel.append(o)
  }
  body.append(field(T('simSet'), setSel))

  /* 等级：**草稿里存的是 enka 原始等级（1 基，1..21）**，而玩家读的是「+N」（0..20）。
     所以选项值取 1/5/9/13/17/21（每 4 级一档），标签显示 lv-1。
     别把 0 塞进来 —— 后端会按 levelRaw 处理，0 会变成负等级。 */
  const lvSel = el('select', 'sim-select')
  for (const lv of [1, 5, 9, 13, 17, 21]) {
    const o = el('option', '', `+${lv - 1}`)
    o.value = String(lv)
    if (lv === cur.level) o.selected = true
    lvSel.append(o)
  }
  body.append(field(T('simLevel'), lvSel))

  /* 主词条（按部位给候选） */
  const mainSel = el('select', 'sim-select')
  const mainOpts = (sim.catalog?.mains || []).find(m => m.pos === a.pos)?.options || []
  for (const m of mainOpts) {
    const o = el('option', '', m.name)
    o.value = m.key
    if (m.key === cur.mainKey) o.selected = true
    mainSel.append(o)
  }
  body.append(field(T('simMainStat'), mainSel))

  /* 副词条：类型下拉 + 数值输入，类型候选里标出大小（同名会分不清） */
  const subsBox = el('div', 'sim-subs')
  const subs = (cur.subs || []).map(s => ({
    keySel: keySelect(s.key),
    valInput: numberInput(s.value)
  }))
  const drawSubs = () => {
    subsBox.innerHTML = ''
    for (const s of subs) {
      const row = el('div', 'sim-subrow')
      const del = el('button', 'sim-subdel', '×')
      del.addEventListener('click', () => {
        const i = subs.indexOf(s)
        if (i >= 0) subs.splice(i, 1)
        drawSubs()
      })
      row.append(s.keySel, s.valInput, del)
      subsBox.append(row)
    }
    const add = el('button', 'sim-submore', '+ ' + T('simAddStat'))
    add.addEventListener('click', () => {
      const first = (sim.catalog?.subs || [])[0]
      if (!first) return
      subs.push({ keySel: keySelect(first.key), valInput: numberInput(0) })
      drawSubs()
    })
    subsBox.append(add)
  }
  drawSubs()
  body.append(field(T('simSubStats'), subsBox))
}

/** 副词条类型下拉（标出大小词条） */
function keySelect (cur) {
  const sel = el('select', 'sim-select sim-subkey')
  for (const opt of sim.catalog?.subs || []) {
    const o = el('option', '', opt.name)
    o.value = opt.key
    if (opt.key === cur) o.selected = true
    sel.append(o)
  }
  return sel
}

/** 数值输入框 */
function numberInput (value) {
  const inp = el('input', 'sim-input')
  inp.type = 'number'
  inp.step = '0.1'
  inp.value = String(value)
  return inp
}

function field (label, control) {
  const d = el('label', 'sim-field')
  d.append(el('span', '', label), control)
  return d
}

/** 该部位当前草稿（没改过就给初值） */
function draftOfPos (pos) {
  return (sim.draft.artifacts || []).find(a => a.pos === pos) || null
}

/** 未改过时的初值：取当前实装那件 */
function defaultDraftOf (a) {
  return {
    set: a.setNameZh || '',
    pos: a.pos,
    star: a.star || 5,
    /* 内核口径是 0 基（levelRaw - 1），页面上一律用 1 基 —— 这里 +1 换回来 */
    level: (a.level ?? 0) + 1,
    mainKey: a.main?.key || 'hpPlus',
    subs: (a.subs || []).map(s => ({ key: s.key, value: parseNum(s.value) }))
  }
}

/** 显示串（"10.9%" / "478"）→ 数字 */
function parseNum (text) {
  const n = Number(String(text).replace(/[%,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function setDraftArtifact (next) {
  const list = (sim.draft.artifacts || []).filter(a => a.pos !== next.pos)
  list.push(next)
  sim.draft.artifacts = list
  recompute()
}

/* ───────────────────────── 伤害表 ───────────────────────── */

/** 伤害表（复用明细页那张表的视觉语言：标题条 + 表头 + 斑马纹行） */
function damageTable (d) {
  if (!d) return el('div', 'sim-dmg-empty', T('dmgNone'))
  const cont = el('div', 'dmg-cont')
  const title = el('div', 'cont-title')
  title.append(document.createTextNode(T('dmgSection')))
  cont.append(title)
  const table = el('div', 'cont-table')
  const head = el('div', 'tr thead')
  head.append(el('div', 'title dmg-title', T('dmgType')), el('div', '', T('dmgCrit')), el('div', '', T('dmgAvg')))
  table.append(head)
  for (const r of d.rows || []) {
    const tr = el('div', 'tr')
    tr.append(el('div', 'title dmg-title', r.title))
    if (r.dmg) {
      tr.append(el('div', 'value', r.dmg + r.unit), el('div', 'value', r.avg + r.unit))
    } else {
      tr.append(el('div', 'value value-full', r.avg + r.unit))
    }
    table.append(tr)
  }
  cont.append(table)
  const foot = el('div', 'cont-footer dmg-desc')
  foot.append(el('span', '', T('dmgEnemy', { lv: d.enemyLv, name: d.enemyName })))
  cont.append(foot)
  return cont
}

/* ───────────────────────── 入口 ───────────────────────── */

/** 从明细页点进来 */
export function openSim (avatarId) {
  sim.avatarId = avatarId
  sim.draft = { weapon: null, artifacts: [] }
  sim.right = null
  showView('sim')
  renderSim()
  api(`accounts/${state.uid}/characters/${avatarId}/simulator`).then(c => {
    sim.catalog = c
    recompute()
  })
}

reg.renderSim = renderSim
reg.openSim = openSim
