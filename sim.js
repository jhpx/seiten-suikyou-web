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
  $, state, T, el, slotGlyph, api, reg, showView, openDialog, W_ATTR_TITLE, setBg, imgError,
  weightClass, hitMark
} from './core.js'

/* 模拟页的本地状态：草稿（用户改到哪了）+ 目录 + 右栏结果 */
const sim = {
  avatarId: null,
  catalog: null,
  draft: { weapon: null, artifacts: [] },
  right: null,
  busy: false,
  /* 左栏伤害只跟「当前实装」有关，进页面取一次就够，别每次重绘都去打接口。
     dmgBox 是底部那张对比表的容器引用 —— 重算完右栏变了，只重画这一块，不动整页。 */
  leftDamage: null,
  dmgBox: null
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
    const res = await api(`accounts/${uid}/characters/${sim.avatarId}/simulator?locale=${encodeURIComponent(state.locale)}`, {
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
    /* 右栏伤害变了 → 底部对比表要跟着重画。renderSim 里也会画一次，这里是重算完成的补刀 */
    drawDamageCompare()
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

  /* 顶栏：只有 ← 返回。角色名交给下面的 hero（顶栏再来一遍是重复，明细页也正是这么砍掉的）；
     「还原」不再放这儿 —— 现在挂在每一件装备卡上，只还原那一件（见 simCardBtns） */
  const bar = el('div', 'sim-head')
  const back = el('button', 'btn back', '← ' + T('back'))
  back.addEventListener('click', () => showView('detail'))
  bar.append(back)
  box.append(bar)

  /*
   * 卡片本体：元素背景**铺满整张卡**，不是只当顶部标题块 —— 和明细页 `.pd-canvas` 一个路子。
   * 宽度用 --app-width（跟首页/明细页同一条 520px 内容带），别再另起一个数。
   */
  const av = currentAvatar()
  const card = setBg(el('div', 'sim-card' + (av ? ' elem-' + av.elem : '')), av?.elemBg || '')
  card.append(heroBanner())

  const cols = el('div', 'sim-cols')

  const left = el('div', 'sim-col')
  left.append(el('h2', 'sim-col-title', T('simCurrent')))
  left.append(currentPane())
  cols.append(left)

  const right = el('div', 'sim-col')
  right.append(el('h2', 'sim-col-title', T('simAdjusted')))
  right.append(adjustedPane())
  cols.append(right)

  card.append(cols)

  /* 伤害对比表：跨整卡宽放在两栏下面，不在任何一栏里。
     一栏一张表时每张只有两百多 px，「Q泡影破裂蒸发」这种长标题加两列数字必然折行。
     合成一张后第一列技能名合并，后面 当前/调整后/变化 四列并排，左右一眼能对读。 */
  const dmgBox = el('div', 'sim-dmgfull')
  dmgBox.append(el('div', 'placeholder', T('dmgLoading')))
  card.append(dmgBox)
  box.append(card)

  sim.dmgBox = dmgBox
  loadLeftDamage().then(drawDamageCompare)
}

/**
 * 角色头（圆圈肖像 | 元素+名字 | 等级/命座/天赋），视觉语言取自明细页。
 * 不画自己的背景 —— 元素背景由外层 .sim-card 整张铺满，hero 只是浮在上面的一行。
 *
 * ⚠️ 肖像用 face（256×256，127/132 覆盖）不用 splash/side/face-q，都实测过：
 *   splash 比例 0.95~1.58 各角色不一，横条里缩着放右侧大片空、cover 铺满又裁成无头半身；
 *   side 只有 128×128（miao 里是列表小圆头像），放大就糊；face-q 是 Q 版、只 83/132 有。
 *   另外 card 是卡背花纹（没人物）、splash0 只 8 个角色有。
 * ⚠️ 圆圈必须 background-position: center top —— face 是头肩构图，往下压会把帽檐切更多。
 */
function heroBanner () {
  const av = currentAvatar()
  if (!av) return null
  const box = el('div', 'sim-hero')

  /* 左：圆圈肖像。外层 .sim-av-ring 是那圈淡金细环，纯装饰，别加交互 */
  const avBox = el('div', 'sim-av')
  avBox.append(el('div', 'sim-av-ring'))
  avBox.append(setBg(el('div', 'sim-av-pic'), av.imgs?.face || av.splash || ''))
  box.append(avBox)

  /* 中：元素图标 + 名字。元素名不写文字 —— 图标已经说清楚了，再写个「水」是重复 */
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

  /* 右：等级 + 命座同一行，下面天赋 a-e-q。UID 不上台面（同账号下所有角色都一样，占地方） */
  const rt = el('div', 'sim-hero-rt')
  const lvRow = el('div', 'sim-hero-lvrow')
  const lv = el('div', 'sim-hero-lv')
  lv.append(el('span', '', 'Lv.'), el('b', '', String(av.level ?? '?')))
  lvRow.append(lv, el('span', 'cons-badge', `${av.cons ?? 0}${T('cons')}`))
  rt.append(lvRow)

  const tal = el('div', 'sim-hero-tal')
  for (const k of ['a', 'e', 'q']) {
    const t = av.talent?.[k] || {}
    /* plus = 被命座提升过（深底金字）—— 判定由后端给，前端别自己算 */
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

/** 左栏：当前实装的面板 + 武器 + 圣遗物 + 伤害 */
function currentPane () {
  const wrap = el('div', 'sim-pane')
  const av = currentAvatar()
  if (!av) {
    wrap.append(el('div', 'placeholder', T('noData')))
    return wrap
  }
  wrap.append(attrPanel(av))
  /* 武器卡也要包一层 .artis：miao 的规则是 `.artis .item.weapon`（带容器前缀），
     不包的话卡片底图、圆角、投影全都命中不了 */
  const wbox = el('div', 'artis')
  wbox.append(weaponCard(av, false))
  wrap.append(wbox)
  wrap.append(artiView(av.artifacts, av.charWeight))
  /* 伤害不在这里出 —— 挪到卡片底部做「当前 / 调整后」并排的对比表（见 drawDamageCompare） */
  return wrap
}

/** 左栏伤害：与明细页同一个接口。只取一次，结果缓存在 sim.leftDamage */
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

/** 右栏：改后的面板 + 可编辑的武器/圣遗物（伤害同样挪到底部对比表） */
function adjustedPane () {
  const wrap = el('div', 'sim-pane')
  if (!sim.right) {
    wrap.append(el('div', 'placeholder', sim.busy ? T('simCalculating') : T('simEmpty')))
    return wrap
  }
  const av = sim.right.avatar
  wrap.append(attrPanel(av))
  const wbox = el('div', 'artis')
  wbox.append(weaponCard(av, true))
  wrap.append(wbox)
  wrap.append(artiEditor(av.artifacts, av.charWeight))
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
 * ⚠️ 每行固定**两行高**（名称跨两行居中、值在第一行、拆分在第二行，都右对齐）：
 *   右栏的值列会因为「旧 → 新」变长，如果值/拆分挤在同一行，那一行就会被顶宽、把拆分挤成两行，
 *   整张表从那一行起全部错位（实测截图里攻击力那行就是这样）。拆成固定两行后，
 *   值列怎么变都不影响行高，两栏严格逐行对齐。
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

    /* 值列：变了的写成「旧 → 新」（旧值灰、新值金）。
       ⚠️ 别另起一行放 diff —— 多一行就把右栏整体撑高，下面的武器 / 圣遗物 / 伤害
       会一块块往下错，两栏就再也对不齐了（这个页面全部价值就在逐行对读）。 */
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
  return box
}

/* ───────────────────────── 武器 ───────────────────────── */

/**
 * 武器卡 —— **1:1 复刻明细页**那张（miao.css 的 .item.weapon）：100×100 图标斜压在右上、
 * 名称 + 精炼徽章 + 等级、主副属性条贴在卡底、下面一整块说明。结构照 detail.js 的
 * renderWeaponCard 抄。属性名的金色是 miao 的固定色（不是权重色），所以保留。
 * 「改」按钮放在 head 里名称右侧（见 simEditBtn），不占额外行高。
 */
function weaponCard (av, editable) {
  const w = av?.weapon || {}
  /* 改过的件挂 is-sim：属性数值一律青色（CSS 里染），一眼分清账号真值和模拟值 */
  const dirty = editable && isWeaponDirty()
  const item = el('div', 'item weapon' + (dirty ? ' is-sim' : ''))
  if (w.icon) item.append(setBg(el('div', 'img'), w.icon))

  const head = el('div', 'head')
  head.append(el('strong', '', w.name || w.sName || T('noWeapon')))

  const info = el('span', 'info')
  info.append(el('span', 'affix affix-' + (w.affix ?? 1), `${T('refine')}${w.affix ?? 1}`))
  info.append(document.createTextNode(` Lv.${w.level ?? '?'}`))
  head.append(info)

  /* 主副属性：贴在卡底的一条通栏，属性名金色（miao 固定色） */
  const wa = el('div', 'weapon-attr')
  for (const [k, v] of Object.entries(w.attrs || {})) {
    const d = el('div')
    d.append(el('span', '', W_ATTR_TITLE[k] || k), document.createTextNode(' +' + v))
    wa.append(d)
  }
  head.append(wa)
  item.append(head)

  /* 说明：miao 的描述里带 <nobr> 高亮标签，只取纯文本（顺手避免注入） */
  const dc = el('div', 'weapon-desc-cont')
  dc.append(el('div', 'weapon-desc', String(w.desc || '').replace(/<[^>]*>/g, '')))
  item.append(dc)
  item.append(simCardBtns(editable, openWeaponDialog, dirty, revertWeapon))
  return item
}

/**
 * 卡片上那组操作按钮（改 / 还原）。挂在**卡片本体**上（不是 head）—— 绝对定位相对整张卡，
 * 桌面放卡内、手机放卡片下方，都由 CSS 坐标决定。
 *
 * 「还原」**只在这件被改过时才出现**：没改过的件上多一颗灰按钮纯属添乱；
 * 而且它只还原这一件，不是整页复原（整页复原那颗已按用户要求删掉）。
 */
function simCardBtns (editable, onEdit, dirty, onRevert) {
  const box = el('div', 'sim-btns')
  box.append(simEditBtn(editable, onEdit))
  if (dirty) box.append(simRevertBtn(onRevert))
  return box
}

/** 「还原」按钮：跟「改」同一套外观，但用青色描边 —— 跟模拟值的颜色对上，一看就知道是一组 */
function simRevertBtn (onRevert) {
  const btn = el('button', 'sim-inbtn sim-revertbtn', T('simReset'))
  btn.addEventListener('click', onRevert)
  return btn
}

/**
 * 「改」按钮。挂在**卡片本体**上（不是 head）—— 这样绝对定位能相对整张卡，
 * 桌面放卡内、手机放到卡片下方都由坐标决定。
 * 左栏同样渲染，只是隐形占位，两栏才严格等高。
 */
function simEditBtn (editable, onEdit) {
  const btn = el('button', 'sim-inbtn', T('simEdit'))
  if (editable) {
    btn.addEventListener('click', onEdit)
  } else {
    /* 隐形之外还要 disabled：Tab 键仍能走上去、读屏也会念出来 */
    btn.classList.add('sim-ghostbtn')
    btn.disabled = true
  }
  return btn
}/** 改武器：型号 / 等级 / 精炼（草稿里存的是 1 基等级，跟 profile.weapon.level 同口径） */
function openWeaponDialog () {
  const cur = draftWeapon()
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

  /* 型号：目录后端已按角色武器类型滤过（迪奥娜只有弓），星级标在名字后面方便认 */
  const wSel = el('select', 'sim-select')
  for (const w of sim.catalog?.weapons || []) {
    const o = el('option', '', w.star >= 5 ? `${w.name} ★` : w.name)
    o.value = String(w.itemId)
    if (w.itemId === cur.itemId) o.selected = true
    wSel.append(o)
  }
  body.append(field(T('simWeaponType'), wSel))

  /* 等级：档位取 1/20/40/60/80/90。值就是 1 基等级本身 —— 后端 new Weapon 直接吃这个数，
     别在这儿 -1（那是**圣遗物**的口径，武器不减）。 */
  const lvSel = el('select', 'sim-select')
  for (const lv of [1, 20, 40, 60, 80, 90]) {
    const o = el('option', '', `Lv.${lv}`)
    o.value = String(lv)
    if (lv === cur.level) o.selected = true
    lvSel.append(o)
  }
  body.append(field(T('simLevel'), lvSel))

  const afSel = el('select', 'sim-select')
  for (const a of [1, 2, 3, 4, 5]) {
    const o = el('option', '', `${T('refine')}${a}`)
    o.value = String(a)
    if (a === cur.affix) o.selected = true
    afSel.append(o)
  }
  body.append(field(T('refine'), afSel))
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

/** 还原这一件武器：清掉草稿里的武器 = 右栏回到当前实装那把 */
function revertWeapon () {
  sim.draft.weapon = null
  recompute()
}

/**
 * 这件武器是否被改过。
 * ⚠️ 比的是**值**，不是「草稿里有没有」：打开弹窗又原样点确定也会写草稿，
 *   那种不该算改动、更不该把属性标成模拟值。
 */
function isWeaponDirty () {
  const d = sim.draft.weapon
  if (!d) return false
  const w = currentAvatar()?.weapon
  if (!w || w.state === 'none') return true
  return d.itemId !== (w.itemId ?? 0) || d.level !== (w.level ?? 1) || d.affix !== (w.affix ?? 1)
}

/* ───────────────────────── 圣遗物 ───────────────────────── */

/** 圣遗物列表（只读） */
function artiView (list, cw) {
  const box = el('div', 'artis')
  for (const a of list || []) box.append(artiCard(a, false, cw))
  return box
}

/** 圣遗物列表（可改） */
function artiEditor (list, cw) {
  const box = el('div', 'artis')
  for (const a of list || []) box.append(artiCard(a, true, cw))
  return box
}

/**
 * 一件圣遗物 —— **1:1 复刻明细页**那张（miao.css 的 .item.arti）：90×90 套装图标斜压在右上
 * （自带 45° 淡出遮罩）、名称压在图上一层、主副词条表 26px 一行。
 * 结构对应 detail.js 的 renderArtiCard，只少两样（用户明确要求）：
 *   · 评分胶囊 `.mark mark-<档位>`
 *   · 档位边框色 `arti-class-<rank>` 与词条的权重三档配色
 * 保留：图标、+等级、名称、主词条、副词条、权重三档色、强化命中圈 i.up-num。
 */
function artiCard (a, editable, cw = {}) {
  /* 空件：明细页那条分支照抄（部位字兜底 + 「未装备」） */
  if (a.empty) {
    const c = el('div', 'item arti empty')
    const icon = el('div', 'arti-icon')
    icon.append(el('span', 'arti-fallback', slotGlyph(a.pos)))
    const head = el('div', 'head')
    head.append(el('strong', '', a.posName))
    c.append(icon, head, el('div', 'arti-empty', T('notEquipped')))
    return c
  }

  const dirty = editable && isArtiDirty(a.pos)
  const c = el('div', 'item arti' + (dirty ? ' is-sim' : ''))
  /* data-slot 给 CSS 的 ::before 当兜底字（图标没同步到时露一个淡部位字），跟明细页一个路子 */
  const icon = el('div', 'arti-icon')
  icon.dataset.slot = slotGlyph(a.pos)
  icon.append(setBg(el('div', 'img'), a.icon || ''))
  icon.append(el('span', '', '+' + (a.level ?? 0)))
  c.append(icon)

  const head = el('div', 'head')
  head.append(el('strong', '', a.name))
  c.append(head)

  const ul = el('ul', 'detail attr')
  if (a.main) {
    const li = el('li', 'arti-main')
    const mt = el('span', 'title')
    mt.append(el('span', 'label', a.main.label))
    li.append(mt, el('span', 'val', '+' + a.main.value))
    ul.append(li)
  }
  for (const s of a.subs || []) {
    /* 挂权重三档类：颜色由 miao.css 的 `.artis ul.detail li.great/.nouse` 给
       （金 = 高权重、白 = 有用、灰 = 无用），跟明细页同一套规则，本文件不另写颜色 */
    const li = el('li', weightClass(Number(cw[s.key] ?? 0)))
    const lab = el('span', 'title')
    /* up-num = 强化命中圈（core.hitMark，实心圆+镂空数字）。
       ⚠️ 不渲染 i.eff（词条前面的「2.8」「5.2」那种小数）—— 那是权重/有效率，
         用户明确要求隐藏。别顺手加回来。 */
    const hit = Math.min(5, (s.upNum || 0) - 1)
    if (hit > 0) {
      const um = el('i', 'up-num')
      um.append(hitMark(hit))
      lab.append(um)
    }
    lab.append(el('span', 'label', s.label))
    li.append(lab, el('span', 'val', '+' + s.value))
    ul.append(li)
  }
  c.append(ul)
  c.append(simCardBtns(editable, () => openArtiDialog(a), dirty, () => revertArti(a.pos)))
  return c
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
        mainKey: mainSel ? mainSel.value : fixedMainKey,
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

  /* 主词条：花/羽在游戏里是**固定**的（后端只给一个候选 hpPlus / atkPlus），
     给个只有一项的下拉框纯属摆设 —— 直接写成只读文字。
     沙/杯/冠才有多个候选（沙 5、杯 6、冠 7），那几个仍给下拉，模拟换装要能换。 */
  const mainOpts = (sim.catalog?.mains || []).find(m => m.pos === a.pos)?.options || []
  const fixedMainKey = mainOpts[0]?.key || cur.mainKey
  let mainSel = null
  if (mainOpts.length > 1) {
    mainSel = el('select', 'sim-select')
    for (const m of mainOpts) {
      const o = el('option', '', m.name)
      o.value = m.key
      if (m.key === cur.mainKey) o.selected = true
      mainSel.append(o)
    }
    body.append(field(T('simMainStat'), mainSel))
  } else {
    /* 单项时用**当前装备的主词条 label**（后端 shapeCharacter 给的中文名）。
       ⚠️ 别用 mainOpts[0].name —— 花/羽这两个候选的 name 就是 key 本身（"hpPlus"/"atkPlus"），
          只有沙/杯/冠的候选才带中文名。 */
    body.append(field(T('simMainStat'), el('span', 'sim-rofn', a.main?.label || fixedMainKey)))
  }

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
    /* 一件圣遗物最多 4 条副词条（游戏规则）—— 满了就不画「加一条」，
       比给一个点了没反应的灰按钮清楚。 */
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

/** 还原这一件圣遗物：把该部位从草稿里摘掉，右栏这一格回到当前实装 */
function revertArti (pos) {
  sim.draft.artifacts = (sim.draft.artifacts || []).filter(a => a.pos !== pos)
  recompute()
}

/**
 * 这件圣遗物是否被改过。
 * ⚠️ 必须跟**左栏原始视图**（currentAvatar）比，不能跟右栏那个 `a` 比 ——
 *   右栏的 a 本身就是改后的结果，拿它跟草稿比永远相等，改过的件会被判成没改。
 */
function isArtiDirty (pos) {
  const d = draftOfPos(pos)
  if (!d) return false
  const org = (currentAvatar()?.artifacts || []).find(x => x.pos === pos)
  if (!org || org.empty) return true          // 原本空着，现在填了东西 = 改动
  const o = defaultDraftOf(org)
  if (d.set !== o.set || d.level !== o.level || d.mainKey !== o.mainKey) return true
  if ((d.subs || []).length !== o.subs.length) return true
  return (d.subs || []).some((s, i) => s.key !== o.subs[i].key || s.value !== o.subs[i].value)
}

/* ───────────────────────── 伤害对比表 ───────────────────────── */

/**
 * 底部那张跨整卡的对比表：**第一列技能名合并**，后面「当前 / 调整后 / 变化」并排。
 *
 * 视觉沿用明细页 `.dmg-cont`（标题条 + 表头 + 斑马纹 + 页脚），只把每行的 grid 从三列
 * 改成四列（明细页是 技能|暴击|期望，这里是 技能|当前|调整后|变化）。
 *
 * ⚠️ 左右两边的 rows **按下标配对**，不按标题配：同一个角色的技能列表恒定的，
 *   按标题配反而会在某一侧缺行时静默错位。哪边短就显示「—」。
 */
function drawDamageCompare () {
  const box = sim.dmgBox
  if (!box) return
  const L = sim.leftDamage
  const R = sim.right?.damage
  box.innerHTML = ''
  if (!L || !R || !L.rows?.length || !R.rows?.length) {
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

  const n = Math.max(L.rows.length, R.rows.length)
  for (let i = 0; i < n; i++) {
    const a = L.rows[i]
    const b = R.rows[i]
    const tr = el('div', 'tr')
    /* 技能名取左边的（右边可能还没有这一行）；左侧缺失才用右边的 */
    tr.append(el('div', 'title dmg-title', (a || b)?.title || ''))

    /* 数值：不吃暴击的行只有 avg，把它当唯一值显示 */
    const va = a ? (a.dmg || a.avg) : null
    const vb = b ? (b.dmg || b.avg) : null
    tr.append(el('div', 'value', va == null ? '—' : va + (a.unit || '')))
    tr.append(el('div', 'value', vb == null ? '—' : vb + (b.unit || '')))

    const cell = el('div', 'value')
    const delta = diffOf(va, vb)
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
  foot.append(el('span', '', T('dmgEnemy', { lv: L.enemyLv, name: L.enemyName })))
  cont.append(foot)
  box.append(cont)
}

/** 两个「3,946」这样的字符串相减。任一边不是纯数字就返回 null（宁可显示「—」也别显示 NaN） */
function diffOf (a, b) {
  const na = typeof a === 'string' ? Number(a.replace(/,/g, '')) : a
  const nb = typeof b === 'string' ? Number(b.replace(/,/g, '')) : b
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null
  return nb - na
}

/* ───────────────────────── 入口 ───────────────────────── */

/** 从明细页点进来 */
export function openSim (avatarId) {
  sim.avatarId = avatarId
  sim.draft = { weapon: null, artifacts: [] }
  sim.right = null
  /* 换角色了，左栏伤害的缓存必须扔 —— 那是上一个角色的 */
  sim.leftDamage = null
  sim.dmgBox = null
  showView('sim')
  renderSim()
  api(`accounts/${state.uid}/characters/${avatarId}/simulator?locale=${encodeURIComponent(state.locale)}`).then(c => {
    sim.catalog = c
    recompute()
  })
}

reg.renderSim = renderSim
reg.openSim = openSim
