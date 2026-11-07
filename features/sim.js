/*
 * 模拟比对页：同一角色两套配装并排 —— 左栏当前实装，右栏手工调整后的。
 * 数据来自两个接口：
 *   GET  .../characters/:avatarId/simulator  → 可选装备目录（武器 / 套装 / 词条候选）
 *   POST .../characters/:avatarId/simulator  → 按草稿重算的面板 + 伤害
 * 右栏词条是用户手填的最终值（自由口径），不显示评分。
 */
import {
  $, state, T, el, api, reg, showView, openDialog, setBg, imgError,
  weightClass, hitMark
} from '../core.js'

/* 模拟页本地状态：草稿 + 目录 + 右栏结果 */
const sim = {
  avatarId: null,
  catalog: null,
  draft: { weapon: null, artifacts: [] },
  right: null,
  busy: false,
  /* 重算请求号：连着改两件时两份请求并行，算得慢的那份可能后回来，
     用 seq 拦掉过期结果，避免「改了看似没反应」。 */
  seq: 0,
  /* 左栏伤害只跟当前实装有关，进页面取一次即可（dmgBox 是底部对比表容器引用）。 */
  leftDamage: null,
  dmgBox: null
}

/* 目录在途请求：复用 openSim 发起的那次抓取，避免重复打接口；切角色时置空重拉。 */
let catalogReq = null

/* ── 数据 ── */

/* 当前实装角色（账号视图里的 avatars[]） */
function currentAvatar () {
  if (!state.view || sim.avatarId == null) return null
  return state.view.avatars.find(a => a.avatarId === sim.avatarId) || null
}

/* 等目录就绪。所有「改」弹窗都依赖 sim.catalog（武器 affixText、套装 positions 等）；
   目录没回来就开弹窗会让武器落进合成兜底项，简介空白。复用在途请求，失败退回 null。 */
async function ensureCatalog () {
  if (sim.catalog) return sim.catalog
  if (!catalogReq) {
    catalogReq = api(`accounts/${state.uid}/characters/${sim.avatarId}/simulator?locale=${encodeURIComponent(state.locale)}`)
      .then(c => { sim.catalog = c })
  }
  try {
    await catalogReq
  } catch {
    catalogReq = null
    return null
  }
  return sim.catalog
}

/* 按草稿重算右栏 */
async function recompute () {
  const uid = state.uid
  if (!uid || sim.avatarId == null) return
  const seq = ++sim.seq
  sim.busy = true
  try {
    const res = await api(`accounts/${uid}/characters/${sim.avatarId}/simulator?locale=${encodeURIComponent(state.locale)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sim.draft)
    })
    if (seq !== sim.seq) return
    sim.right = res
  } catch (e) {
    if (seq !== sim.seq) return
    /* 失败不清空 sim.right：留着上次成功结果，否则整页静默退回原值，像「改了没反应」。 */
    console.error('[sim] 模拟失败:', e)
  } finally {
    if (seq === sim.seq) {
      sim.busy = false
      renderSim()
      drawDamageCompare()
    }
  }
}

/* ── 渲染 ── */

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

/* 角色头（肖像 | 元素+名 | 等级/命座/天赋），视觉取自明细页；背景由外层 .sim-card 铺满。
   肖像用 face（256×256，头肩构图），圆圈 background-position: center top 以免裁掉帽檐。 */
function heroBanner () {
  const av = currentAvatar()
  if (!av) return null
  const box = el('div', 'sim-hero')

  const avBox = el('div', 'sim-av')
  avBox.append(el('div', 'sim-av-ring'))
  avBox.append(setBg(el('div', 'sim-av-pic'), av.imgs?.face || av.splash || ''))
  box.append(avBox)

  /* 元素图标已说明元素，不重复写文字名。 */
  const mid = el('div', 'sim-hero-mid')
  const name = el('div', 'sim-hero-name')
  if (av.elemIcon) {
    const ic = el('img', 'sim-hero-elem')
    ic.src = av.elemIcon
    ic.alt = ''
    ic.addEventListener('error', () => imgError(ic))
    name.append(ic)
  }
  name.append(el('span', '', av.name || ''))
  mid.append(name)
  box.append(mid)

  const rt = el('div', 'sim-hero-rt')
  const lvRow = el('div', 'sim-hero-lvrow')
  const lv = el('div', 'sim-hero-lv')
  lv.append(el('span', '', 'Lv.'), el('b', '', String(av.level ?? '?')))
  lvRow.append(lv, el('span', 'cons-badge', `${av.cons ?? 0}${T('cons')}`))
  rt.append(lvRow)

  const tal = el('div', 'sim-hero-tal')
  for (const k of ['a', 'e', 'q']) {
    const t = av.talent?.[k] || {}
    /* plus = 被命座提升过（深底金字），判定由后端给，前端别自己算。 */
    const item = setBg(el('div', 'sim-tal' + (t.plus ? ' is-plus' : '')),
      `assets/common/bg/talent-${av.elem || 'hydro'}.webp`)
    item.append(setBg(el('div', 'sim-tal-img'), av.imgs?.[k]))
    item.append(el('strong', '', String(t.level ?? 0)))
    tal.append(item)
  }
  rt.append(tal)
  box.append(rt)
  return box
}

/* 左栏伤害（与明细页同接口），只取一次缓存在 sim.leftDamage。 */
async function loadLeftDamage () {
  if (sim.leftDamage) return
  const uid = state.uid
  if (!uid) return
  try {
    sim.leftDamage = await api(`accounts/${uid}/characters/${sim.avatarId}/damage`)
  } catch {
    sim.leftDamage = null
  }
}

/* ── 面板 ── */

/* 面板属性表（左右同款）。不复用明细页 .char-attr（列宽写死 600px 画布，半屏会错位）。
   ⚠️ 固定两行高（名称跨两行、值/拆分上下），右栏「旧→新」变长也不撑高行，两栏严格逐行对齐。
   差异行提亮并写「改动前 → 改动后」——这是本页存在的理由。 */
const ATTR_ROWS = 8

function attrPanel (av) {
  const box = el('div', 'sim-attrs')
  const base = currentAvatar()
  const baseMap = new Map((base?.attrTable || []).map(r => [r.key, r.value]))
  for (const r of av.attrTable || []) {
    const row = el('div', 'sim-attr')
    row.append(el('span', 'sim-aname', r.label))
    const val = el('span', 'sim-aval')
    const prev = baseMap.get(r.key)
    if (prev !== undefined && prev !== r.value) {
      row.classList.add('is-changed')
      val.append(el('span', 'sim-old', prev), document.createTextNode(' → '), el('span', 'sim-new', r.value))
    } else {
      val.append(document.createTextNode(r.value))
    }
    row.append(val)
    row.append(el('span', 'sim-abreak', `${r.base} + ${r.plus}`))
    box.append(row)
  }
  /* 补空行到固定行数：武器副属性是元素伤时会多一行，两栏行数不同会让下方整块错位。
     必须 clone 最后真行再隐藏（空 span 高度对不上，手机端逐行差 2px 累计成错位）。 */
  const n = (av.attrTable || []).length
  const last = box.lastElementChild
  if (last) {
    for (let i = n; i < ATTR_ROWS; i++) {
      const blank = last.cloneNode(true)
      blank.classList.add('sim-attr-empty')
      blank.classList.remove('is-changed')
      box.append(blank)
    }
  }
  return box
}

/* ── 武器 ── */

/* 每件装备（武器 / 圣遗物）词条表的固定行数：两栏齐高，否则下方整列错位。
   武器 = 等级 + 精炼 + 最多 3 条属性；圣遗物 = 主词条 + 最多 4 条副词条；都 <= 5。 */
const PIECE_ROWS = 5

/* 武器卡：压缩版式（40px 图标 + 名称行 + 词条表），不画说明。改过的件左上旧图、右上新图，
   词条全套「旧→新」。 */
function weaponCard (av, editable) {
  const weapon = av?.weapon || {}
  const dirty = editable && isWeaponDirty()
  /* 改过时左上放原武器图（新图在右上），词条才有旧值可比。 */
  const equipped = dirty ? currentAvatar()?.weapon : null
  const item = el('div', 'item weapon' + (dirty ? ' is-sim' : ''))

  /* 左上图标不带角标：等级/精炼已进词条表，角标重复且会盖住竖长的武器图下半截。
     40px 小格用 weapon.thumb（96px 预处理件）；w.icon 原图留给明细页那张 100px 的卡。 */
  const icon = el('div', 'sim-wicon')
  icon.append(setBg(el('div', 'sim-wimg'), (equipped?.thumb || weapon.thumb) || ''))
  item.append(icon)

  if (dirty) item.append(simNewIcon(weapon.thumb))

  const head = el('div', 'head')
  head.append(nameCell(equipped?.name, weapon.name || weapon.sName || T('noWeapon')))
  item.append(head)

  /* 词条表：等级 / 精炼 / 主副属性，改过的件整套「旧→新」。 */
  const ul = el('ul', 'detail attr')
  ul.append(weaponCardRow(T('simLevel'), 'Lv.' + (weapon.level ?? '?'),
    equipped ? 'Lv.' + (equipped.level ?? '?') : null, dirty))
  ul.append(weaponCardRow(T('simRefine'), `${T('refine')}${weapon.affix ?? 1}`,
    equipped ? `${T('refine')}${equipped.affix ?? 1}` : null, dirty))

  /* 属性：新旧 key 并集 —— 换武器类型时消失/新增的条才看得见（消失写「旧值→0」、新增「0→新值」）。 */
  const nv = new Map((weapon.attrs || []).map(a => [a.key, a]))
  const ov = new Map((equipped?.attrs || []).map(a => [a.key, a]))
  const keys = [...nv.keys(), ...[...ov.keys()].filter(k => !nv.has(k))]
  for (const k of keys) {
    const n = nv.get(k)
    const o = ov.get(k)
    const label = (n || o).label
    /* 武器主副属性都不带 +（游戏里是「基础攻击力 608」，只有圣遗物副词条带）。 */
    const newText = n ? n.value : '0'
    /* 没改过不给旧值；新加的条旧值记 0。 */
    const oldText = o ? o.value : (dirty && n ? '0' : null)
    ul.append(weaponCardRow(label, newText, oldText, dirty))
  }
  for (let i = ul.children.length; i < PIECE_ROWS; i++) ul.append(el('li', 'sim-row-empty'))
  item.append(ul)
  item.append(simCardBtns(editable, openWeapon, dirty, revertWeapon))
  return item
}

/* 武器卡词条表的一行「标签 | 旧 → 新」。oldText 已格式化，没改过时传 null。 */
function weaponCardRow (label, newText, oldText, showOld) {
  const li = el('li')
  const t = el('span', 'title')
  t.append(el('span', 'label', label))
  li.append(t, valCell(newText, oldText, showOld))
  return li
}

/* 改武器弹窗右侧信息栏的一行（主/副属性单值，无旧值可比，别与武器卡对比行混用）。 */
function weaponInfoRow (label, value) {
  const row = el('div', 'sim-wstat')
  row.append(el('span', 'sim-wstat-k', label), el('span', 'sim-wstat-v', value))
  return row
}

/* ── 卡片操作按钮 ── */

/* 一组操作按钮（改 / 还原），挂在卡片本体上（绝对定位相对整张卡）。
   「还原」只在改过的件上出现，且只还原这一件。 */
function simCardBtns (editable, onEdit, dirty, onRevert) {
  const box = el('div', 'sim-btns')
  box.append(simEditBtn(editable, onEdit))
  if (dirty) box.append(simRevertBtn(onRevert))
  return box
}

/* 「还原」：同「改」外观，但青色描边（与模拟值同色，一看是一组）。 */
function simRevertBtn (onRevert) {
  const btn = el('button', 'sim-inbtn sim-revertbtn', T('simReset'))
  btn.addEventListener('click', onRevert)
  return btn
}

/* 「改」：左栏同样渲染但隐形占位，两栏才严格等高。 */
function simEditBtn (editable, onEdit) {
  const btn = el('button', 'sim-inbtn', T('simEdit'))
  if (editable) {
    btn.addEventListener('click', onEdit)
  } else {
    btn.classList.add('sim-ghostbtn')
    btn.disabled = true
  }
  return btn
}

/* 点「改」武器：先等目录，确保弹窗里自带武器带 affixText（否则简介空白）。 */
async function openWeapon () {
  await ensureCatalog()
  openWeaponDialog()
}

/* 改武器：型号 / 等级 / 精炼（草稿存 1 基等级，与 profile.weapon.level 同口径）。 */
function openWeaponDialog () {
  const draft = draftWeapon()
  const equipped = currentAvatar()?.weapon
  const dlg = openDialog({
    title: T('simWeaponTitle'),
    onOk: () => {
      setDraftWeapon({
        itemId: Number(wSel.value),
        level: Number(lvSel.value),
        affix: Number(afSel.value)
      })
    }
  })

  const body = dlg.body
  /* 多一栏简介，放宽弹窗（窄屏仍整屏宽）。 */
  body.parentElement?.classList.add('sim-wwide')

  const wrap = el('div', 'sim-wbody')
  const form = el('div', 'sim-wform')

  /* 型号：目录后端已按角色武器类型滤过（迪奥娜只有弓），三星到五星一律标★。 */
  const list = [...(sim.catalog?.weapons || [])]
  /* 当前武器不在目录里（miao 不认识）时补一项，否则下拉落到第一项、看着像没选中。 */
  if (draft.itemId && !list.some(w => w.itemId === draft.itemId)) {
    list.unshift({ itemId: draft.itemId, name: equipped?.name || T('noWeapon'), star: equipped?.star || 0, affixText: '', affixVals: [], main: null, sub: null })
  }
  const wSel = el('select', 'sim-select')
  for (const w of list) {
    const o = el('option', '', w.star ? `${w.name} ${w.star}★` : w.name)
    o.value = String(w.itemId)
    if (w.itemId === draft.itemId) o.selected = true
    wSel.append(o)
  }
  form.append(field(T('simWeaponType'), wSel))

  /* 等级档位由选中武器给（main.values 的键就是档位），别写死 [1,20,…,90]（低星会选到升不到的档）。
     值即 1 基等级，别 -1（那是圣遗物口径）。 */
  const lvSel = el('select', 'sim-select')
  const drawLevels = (initial) => {
    const picked = list.find(x => String(x.itemId) === wSel.value)
    const lvs = Object.keys(picked?.main?.values || {}).map(Number).sort((a, b) => a - b)
    /* 无档位数据（miao 不认识的新武器）退回常规档位。 */
    if (!lvs.length) lvs.push(1, 20, 40, 60, 70, 80, 90)
    const max = lvs[lvs.length - 1]
    let keep = initial ? (draft.level || 1) : (Number(lvSel.value) || draft.level || 1)
    /* 初次打开按真实等级显示（可能是 50/55 这种非档位值），不补会落到第一项像被重置。 */
    if (initial && keep <= max && !lvs.includes(keep)) {
      lvs.push(keep)
      lvs.sort((a, b) => a - b)
    }
    /* 换武器后档位表变了，keep 不在新表里就收敛到不超过它的最大档（否则 select 赋不存在值变空串）。 */
    if (!lvs.includes(keep)) {
      const under = lvs.filter(lv => lv <= keep)
      keep = under.length ? under[under.length - 1] : lvs[0]
    }
    lvSel.innerHTML = ''
    for (const lv of lvs) {
      const o = el('option', '', `Lv.${lv}`)
      o.value = String(lv)
      lvSel.append(o)
    }
    lvSel.value = String(keep)
  }
  drawLevels(true)
  form.append(field(T('simLevel'), lvSel))

  const afSel = el('select', 'sim-select')
  for (const a of [1, 2, 3, 4, 5]) {
    const o = el('option', '', `${T('refine')}${a}`)
    o.value = String(a)
    if (a === draft.affix) o.selected = true
    afSel.append(o)
  }
  form.append(field(T('refine'), afSel))

  /* 右侧：主/副属性 + 简介，随两个下拉走（等级改属性、精炼改简介里的数值）。 */
  const info = el('div', 'sim-winfo')
  const stats = el('div', 'sim-wstats')
  const desc = el('div', 'sim-wdesc-body')
  const drawInfo = () => {
    const picked = list.find(x => String(x.itemId) === wSel.value)
    const lv = lvSel.value
    stats.innerHTML = ''
    /* 值按选中等级档取，没有就空着（不编数）。 */
    if (picked?.main) stats.append(weaponInfoRow(picked.main.label, picked.main.values?.[lv] || ''))
    if (picked?.sub) stats.append(weaponInfoRow(picked.sub.label, picked.sub.values?.[lv] || ''))

    /* 简介模板 $[0] $[1] 换成当前精炼档数值并高亮（标出跟着精炼变的那几个数）。
       1★/2★ 无精炼效果，整段为空 → 占位。 */
    desc.innerHTML = ''
    if (!picked?.affixText) {
      desc.append(document.createTextNode(T('noData')))
      return
    }
    for (const [i, part] of picked.affixText.split(/\$\[(\d+)\]/).entries()) {
      if (i % 2 === 0) {
        if (part) desc.append(document.createTextNode(part))
      } else {
        const v = (picked.affixVals?.[Number(part)] || [])[Number(afSel.value) - 1]
        if (v) desc.append(el('span', 'sim-whl', v))
      }
    }
  }
  wSel.addEventListener('change', () => { drawLevels(false); drawInfo() })
  lvSel.addEventListener('change', drawInfo)
  afSel.addEventListener('change', drawInfo)

  info.append(stats, desc)
  wrap.append(form, info)
  body.append(wrap)
  drawInfo()
}

/* 草稿里的武器（没改过即当前实装那把）。 */
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

/* 还原武器：清掉草稿武器，右栏回到当前实装那把。 */
function revertWeapon () {
  sim.draft.weapon = null
  recompute()
}

/* 武器是否被改过：比值不比「草稿里有没有」（原样点确定也会写草稿，不该算改动）。 */
function isWeaponDirty () {
  const d = sim.draft.weapon
  if (!d) return false
  const w = currentAvatar()?.weapon
  if (!w || w.state === 'none') return true
  return d.itemId !== (w.itemId ?? 0) || d.level !== (w.level ?? 1) || d.affix !== (w.affix ?? 1)
}

/* ── 圣遗物 ── */

/* 每张卡包一层 .artis：miao 规则全是 .artis .item.xxx（带容器前缀），不包命中不了底图/圆角/投影。 */
function wrapArti (card) {
  const box = el('div', 'artis')
  box.append(card)
  return box
}

/* 一件圣遗物，1:1 复刻明细页卡片（miao.css 的 .item.arti）：套装图标斜压右上、名称压图上层、
   主副词条表。少两样（用户要求）：评分胶囊、权重三档边框色。保留图标/+等级/名称/词条/强化命中圈。 */
function artiCard (a, editable, cw = {}) {
  if (a.empty) {
    const c = el('div', 'item arti empty')
    const icon = el('div', 'arti-icon')
    const head = el('div', 'head')
    head.append(el('strong', '', a.posName))
    c.append(icon, head, el('div', 'arti-empty', T('notEquipped')))
    return c
  }

  const dirty = editable && isArtiDirty(a.pos)
  /* 改过时左上放原件图标（新图在右上），词条有旧值可比。 */
  const equipped = dirty ? originalArti(a.pos) : null
  const c = el('div', 'item arti' + (dirty ? ' is-sim' : ''))

  /* 左上图标半透明当底纹，名称和首行词条压在上层。 */
  const icon = el('div', 'arti-icon')
  const iconUrl = (equipped?.icon || a.icon) || ''
  const iconLv = (equipped?.level ?? a.level) ?? 0
  icon.append(setBg(el('div', 'img'), iconUrl))
  icon.append(el('span', '', '+' + iconLv))
  c.append(icon)

  if (dirty) c.append(simNewIcon(a.icon, '+' + (a.level ?? 0)))

  const head = el('div', 'head')
  head.append(nameCell(equipped?.name, a.name))
  c.append(head)

  const ul = el('ul', 'detail attr')
  if (a.main) {
    const li = el('li', 'arti-main')
    const mt = el('span', 'title')
    mt.append(el('span', 'label', a.main.label))
    /* 主词条不带 +（只有副词条带）。旧值只在同一条主词条时才算数，否则记 0。 */
    const sameMain = equipped?.main?.key === a.main.key
    li.append(mt, valCell(a.main.value, sameMain ? equipped.main.value : (dirty ? '0' : null), dirty))
    ul.append(li)
  }
  /* 副词条：新旧 key 并集，删除的条写「旧值→0」看得见。一件里同 key 只出现一次，按 key 配对。 */
  const subs = a.subs || []
  const equippedSubs = equipped?.subs || []
  const subKeys = [...subs.map(x => x.key), ...equippedSubs.map(x => x.key).filter(k => !subs.some(x => x.key === k))]
  for (const key of subKeys) {
    const s = subs.find(x => x.key === key)
    const oldSub = equippedSubs.find(x => x.key === key)
    /* 权重三档色由 miao.css 的 .artis ul.detail li.great/.nouse 给，本文件不另写。 */
    const li = el('li', weightClass(Number(cw[key] ?? 0)))
    const lab = el('span', 'title')
    /* 不渲染 i.eff（权重/有效率小数，用户要求隐藏）。 */
    const hit = s ? Math.min(5, (s.upNum || 0) - 1) : 0
    /* 词条名在前、强化圈号在后（同明细页「词条名 → 圈号」读法）。 */
    lab.append(el('span', 'label', (s || oldSub).label))
    if (hit > 0) {
      const um = el('i', 'up-num')
      um.append(hitMark(hit))
      lab.append(um)
    }
    /* 新件没这条 = 被删 → 新值记 0；旧件没这条 = 新加 → 旧值记 0。 */
    const newText = s ? '+' + s.value : '0'
    const oldText = oldSub ? '+' + oldSub.value : (dirty ? '0' : null)
    li.append(lab, valCell(newText, oldText, dirty))
    ul.append(li)
  }
  for (let i = ul.children.length; i < PIECE_ROWS; i++) ul.append(el('li', 'sim-row-empty'))
  c.append(ul)
  c.append(simCardBtns(editable, () => openArti(a), dirty, () => revertArti(a.pos)))
  return c
}

/* 卡片标题。改名写「旧名 → 新名」：新名不能顶掉旧名，得一眼看出换的是哪一件。
   名字是识别主要信息，宁可折行也不省略。 */
function nameCell (oldName, newName) {
  const s = el('strong')
  if (oldName && newName && oldName !== newName) {
    /* 竖排两行（head 仅 92px 宽，一行两名字会被右侧按钮压住）。 */
    const nn = el('span', 'sim-newname')
    nn.append(el('i', 'sim-arrow', '→'), document.createTextNode(newName))
    s.append(el('span', 'sim-oldname', oldName), nn)
  } else {
    s.append(document.createTextNode(newName || ''))
  }
  return s
}

/* 右上「新图标」（改过的件才有）：图 + 可选标签，青色描边表示模拟出来的。 */
function simNewIcon (url, label) {
  const box = el('div', 'sim-newicon')
  box.append(setBg(el('div', 'img'), url || ''))
  if (label) box.append(el('span', '', label))
  return box
}

/* 数值单元格。值真变了才写「旧 → 新」（旧灰新青），否则只写新值（免噪声）。
   删掉的条能出来是靠新值记 0，不是靠「没旧值」判断。 */
function valCell (newVal, oldVal, showOld) {
  const cell = el('span', 'val')
  const nv = String(newVal)
  const hasOld = showOld && oldVal !== undefined && oldVal !== null && oldVal !== ''
  if (!hasOld || String(oldVal) === nv) {
    cell.append(document.createTextNode(nv))
    return cell
  }
  cell.append(
    el('span', 'sim-val-old', String(oldVal)),
    el('i', 'sim-arrow', '→'),
    el('span', 'sim-val-new', nv)
  )
  return cell
}

/* 点「改」圣遗物：先等目录，确保弹窗里套装/主词条候选齐全。 */
async function openArti (a) {
  await ensureCatalog()
  openArtiDialog(a)
}

/* 改一件圣遗物：套装（带星级）/ 等级 / 主词条 / 副词条。 */
function openArtiDialog (a) {
  const draft = draftOfPos(a.pos) || defaultDraftOf(a)
  const dlg = openDialog({
    title: `${T('simEdit')} · ${a.posName}`,
    onOk: () => {
      const next = {
        set: setSel.value,
        pos: a.pos,
        star: starOf(),
        level: Number(lvSel.value),
        mainKey: mainSel ? mainSel.value : fixedMainKey,
        subs: subs.map((s) => ({
          key: s.keySel.value,
          value: Number(s.valInput.value)
        }))
      }
      setDraftArtifact(next)
    }
  })

  const body = dlg.body

  /* 套装：只列有这个部位的（「祭雷之人的花」后端认不出会整件跳过、值被染模拟色却没变）。
     !x.positions 是给前端比后端新时的兜底（web 可能先发，老接口无此字段就不过滤）。 */
  const setOpts = (sim.catalog?.sets || []).filter(x => !x.positions || x.positions.includes(a.pos))
  const setSel = el('select', 'sim-select')
  for (const s of setOpts) {
    const o = el('option', '', s.star ? `${s.name} ${s.star}★` : s.name)
    o.value = s.key
    if (s.key === draft.set) o.selected = true
    setSel.append(o)
  }
  body.append(field(T('simSet'), setSel))

  /* 星级由套装决定（4★ 满级 +16，5★ 能 +20）。取 min(原星级, 套装最高)：5★ 套装里穿 4★ 件
     直接按套装最高会悄悄升星、主词条变一截。 */
  const starOf = () => Math.min(draft.star || 5, setOpts.find(s => s.key === setSel.value)?.star || 5)

  /* 等级：草稿存 enka 原始 1 基（1..21），玩家读「+N」（0..20），标签显示 lv-1。
     上限跟星级走（4★ 只 +16），档位表从目录拿。 */
  const lvSel = el('select', 'sim-select')
  const drawLevels = () => {
    const keep = Number(lvSel.value) || draft.level || 1
    const max = (sim.catalog?.starLevels || []).find(x => x.star === starOf())?.maxLevel ?? 21
    lvSel.innerHTML = ''
    for (let lv = 1; lv <= max; lv += 4) {
      const o = el('option', '', `+${lv - 1}`)
      o.value = String(lv)
      lvSel.append(o)
    }
    lvSel.value = String(Math.min(keep, max))
  }
  setSel.addEventListener('change', drawLevels)
  drawLevels()
  body.append(field(T('simLevel'), lvSel))

  /* 主词条：花/羽固定（后端只给一项），写只读文字；沙/杯/冠才给下拉。 */
  const mainOpts = (sim.catalog?.mains || []).find(m => m.pos === a.pos)?.options || []
  const fixedMainKey = mainOpts[0]?.key || draft.mainKey
  let mainSel = null
  if (mainOpts.length > 1) {
    mainSel = el('select', 'sim-select')
    for (const m of mainOpts) {
      const o = el('option', '', m.name)
      o.value = m.key
      if (m.key === draft.mainKey) o.selected = true
      mainSel.append(o)
    }
    body.append(field(T('simMainStat'), mainSel))
  } else {
    /* 单项用当前装备主词条 label（后端中文名）。别用 mainOpts[0].name —— 花/羽候选的 name 就是 key 本身。 */
    body.append(field(T('simMainStat'), el('span', 'sim-rofn', a.main?.label || fixedMainKey)))
  }

  /* 副词条：类型下拉 + 数值输入，类型候选标出大小。 */
  const subsBox = el('div', 'sim-subs')
  const subs = (draft.subs || []).map(s => ({
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
    /* 最多 4 条副词条，满了就不画「加一条」（比点了没反应的灰按钮清楚）。 */
    if (subs.length < 4) {
      const add = el('button', 'sim-submore', '+ ' + T('simAddStat'))
      add.addEventListener('click', () => {
        const first = (sim.catalog?.subs || [])[0]
        if (!first || subs.length >= 4) return
        subs.push({ keySel: keySelect(first.key), valInput: numberInput(0) })
        drawSubs()
      })
      subsBox.append(add)
    }
  }
  drawSubs()
  body.append(field(T('simSubStats'), subsBox))
}

/* 副词条类型下拉（标出大小词条）。 */
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

/* 数值输入框。 */
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

/* 该部位当前草稿（没改过给默认值）。 */
function draftOfPos (pos) {
  return (sim.draft.artifacts || []).find(a => a.pos === pos) || null
}

/* 未改过时的初值：取当前实装那件。 */
function defaultDraftOf (a) {
  return {
    set: a.setNameZh || '',
    pos: a.pos,
    star: a.star || 5,
    /* 内核 0 基（levelRaw - 1），页面用 1 基，这里 +1。 */
    level: (a.level ?? 0) + 1,
    mainKey: mainKeyOf(a.main),
    subs: (a.subs || []).map(s => ({ key: s.key, value: parseNum(s.value) }))
  }
}

/* 主词条 key：内核口径 → 目录/下拉口径。
   ⚠️ 元素伤害杯在核心里是具体元素（cryo/pyro…），目录只给一项 dmg。不翻回来下拉一个都选不中，
   默认选第一项（攻击力），只改个副词条也会把冰伤悄悄换成大攻击（实测冰伤 46.6% → 0 → 46.6%）。 */
function mainKeyOf (main) {
  const key = main?.key
  if (!key) return 'hpPlus'
  return key === currentAvatar()?.elem ? 'dmg' : key
}

/* 显示串（"10.9%" / "478"）→ 数字。 */
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

/* 还原圣遗物：从草稿摘掉该部位，右栏回到当前实装。 */
function revertArti (pos) {
  sim.draft.artifacts = (sim.draft.artifacts || []).filter(a => a.pos !== pos)
  recompute()
}

/* 该部位当前实装件（用作旧值/旧图标基准）；找不到或空件返回 null。 */
function originalArti (pos) {
  return (currentAvatar()?.artifacts || []).find(x => x.pos === pos) || null
}

/* 圣遗物是否被改过：必须跟左栏原始视图比，不能跟右栏 a 比（a 已是改后结果，永远相等）。 */
function isArtiDirty (pos) {
  const d = draftOfPos(pos)
  if (!d) return false
  const equipped = originalArti(pos)
  if (!equipped || equipped.empty) return true          // 原本空着，现在填了 = 改动
  const o = defaultDraftOf(equipped)
  /* 星级也算改动：它改主词条数值档位和满级上限（4★ 最高 +16）。 */
  if (d.set !== o.set || d.star !== o.star || d.level !== o.level || d.mainKey !== o.mainKey) return true
  if ((d.subs || []).length !== o.subs.length) return true
  return (d.subs || []).some((s, i) => s.key !== o.subs[i].key || s.value !== o.subs[i].value)
}

/* ── 伤害对比表 ── */

/* 底部跨整卡对比表：技能名合并，当前/调整后/变化并排。视觉沿用明细页 .dmg-cont。
   ⚠️ 左右 rows 按下标配对（同一角色技能列表恒定），不按标题配（缺行会静默错位）。哪边短显示「—」。 */
function drawDamageCompare () {
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

/* ── 入口 ── */

/* 从明细页点进来。 */
export function openSim (avatarId) {
  sim.avatarId = avatarId
  sim.draft = { weapon: null, artifacts: [] }
  sim.right = null
  sim.leftDamage = null
  sim.dmgBox = null
  /* 目录跟「角色武器类型」走（迪奥娜只有弓），换角色必须重拉。 */
  sim.catalog = null
  catalogReq = null
  showView('sim')
  renderSim()
  catalogReq = api(`accounts/${state.uid}/characters/${avatarId}/simulator?locale=${encodeURIComponent(state.locale)}`).then(c => {
    sim.catalog = c
    recompute()
  })
}

reg.renderSim = renderSim
reg.openSim = openSim
