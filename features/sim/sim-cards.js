/*
 * 模拟比对页的卡片渲染：角色头、属性表、武器卡、五件圣遗物卡，以及它们共用的小部件
 * （旧→新标题、新旧数值单元格、改 / 还原按钮）。
 *
 * 从原 sim.js 原样搬出。卡片上的「改」「还原」回调来自 sim-dialogs.js / sim-state.js，
 * 本文件只负责把它们挂到按钮上，不碰状态本身。
 */

import { T, el, setBg, imgError, weightClass, hitMark } from '../../core.js'
import { currentAvatar, isWeaponDirty, revertWeapon, isArtiDirty, originalArti, revertArti } from './sim-state.js'
import { openWeapon, openArti } from './sim-dialogs.js'

/* 面板属性表：固定两行高（名称跨两行、值/拆分上下），右栏「旧→新」变长也不撑高行。
   ⚠️ 不复用明细页 .char-attr（列宽写死 600px 画布，半屏会错位）。两栏严格逐行对齐。
   差异行提亮并写「改动前 → 改动后」—— 这是本页存在的理由。 */
const ATTR_ROWS = 8

/* 每件装备（武器 / 圣遗物）词条表的固定行数：两栏齐高，否则下方整列错位。
   武器 = 等级 + 精炼 + 最多 3 条属性；圣遗物 = 主词条 + 最多 4 条副词条；都 <= 5。 */
const PIECE_ROWS = 5

/* 角色头（肖像 | 元素+名 | 等级/命座/天赋），视觉取自明细页；背景由外层 .sim-card 铺满。
   肖像用 face（256×256，头肩构图），圆圈 background-position: center top 以免裁掉帽檐。 */
export function heroBanner () {
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

export function attrPanel (av) {
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

/* 武器卡：压缩版式（40px 图标 + 名称行 + 词条表），不画说明。改过的件左上旧图、右上新图，
   词条全套「旧→新」。 */
export function weaponCard (av, editable) {
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

/* 每张卡包一层 .artis：miao 规则全是 .artis .item.xxx（带容器前缀），不包命中不了底图/圆角/投影。 */
export function wrapArti (card) {
  const box = el('div', 'artis')
  box.append(card)
  return box
}

/* 一件圣遗物，1:1 复刻明细页卡片（miao.css 的 .item.arti）：套装图标斜压右上、名称压图上层、
   主副词条表。少两样（用户要求）：评分胶囊、权重三档边框色。保留图标/+等级/名称/词条/强化命中圈。 */
export function artiCard (a, editable, cw = {}) {
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
