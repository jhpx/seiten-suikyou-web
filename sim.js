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
  $, state, T, el, slotGlyph, api, reg, showView, openDialog, setBg, imgError,
  weightClass, hitMark
} from './core.js'

/* 模拟页的本地状态：草稿（用户改到哪了）+ 目录 + 右栏结果 */
const sim = {
  avatarId: null,
  catalog: null,
  draft: { weapon: null, artifacts: [] },
  right: null,
  busy: false,
  /* 重算请求号。连着改两件时两份请求是并行的，内核算得慢的那份可能后回来 ——
     照旧无脑写回就会把后改的那件悄悄退回原样（看着就是「改了没反应」）。 */
  seq: 0,
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
  const seq = ++sim.seq
  sim.busy = true
  try {
    const res = await api(`accounts/${uid}/characters/${sim.avatarId}/simulator?locale=${encodeURIComponent(state.locale)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sim.draft)
    })
    /* 已经有更新的请求发出去了，这份结果作废（它比当前草稿旧） */
    if (seq !== sim.seq) return
    sim.right = res
  } catch (e) {
    if (seq !== sim.seq) return
    /* ⚠️ 失败时**不要**把 sim.right 清空：那会让整页静默退回账号原值，
       看着就像「我改了、页面没反应」。留着上一次算成功的结果，错误只进控制台。 */
    console.error('[sim] 模拟失败:', e)
  } finally {
    if (seq === sim.seq) {
      sim.busy = false
      renderSim()
      /* 右栏伤害变了 → 底部对比表要跟着重画。renderSim 里也会画一次，这里是重算完成的补刀 */
      drawDamageCompare()
    }
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

  /* 单栏：右边那份（重算后的视图）已经完全表达「旧 → 新」，左栏那份纯旧值只是重复。
     6 张卡（武器 + 5 圣遗物）排成两列，纵向从 12 块收到 6 块。
     还没算完时先用账号视图顶上（两者结构一样，只差 dirty 标记），算完 renderSim 会重画。 */
  const view = sim.right?.avatar || av
  if (!view) {
    card.append(el('div', 'placeholder', T('noData')))
  } else {
    /* 属性表要垫一层深底：元素背景当底时白字读不出来（原来那层底在 .sim-col 上，已随两栏一起删了） */
    const panel = el('div', 'sim-panel')
    panel.append(attrPanel(view))
    card.append(panel)
    const grid = el('div', 'sim-pieces')
    grid.append(wrapArti(weaponCard(view, true)))
    for (const a of view.artifacts || []) grid.append(wrapArti(artiCard(a, true, view.charWeight)))
    card.append(grid)
  }

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
/* 面板属性表固定行数：7 条基础 + 元素伤害加成（武器副属性是元素伤时才有）。
   两栏必须一样高，靠补空行做到。 */
const ATTR_ROWS = 8

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
  /* 补空行到固定行数：武器副属性是元素伤害加成时会多出一行「水伤加成」，
     两栏行数一不同，下面的武器 / 圣遗物 / 伤害就整块错位（这页全部价值在逐行对读）。
     空行用同样的三段结构（高度自然一致）+ visibility: hidden，看着就是留白。 */
  const n = (av.attrTable || []).length
  /* ⚠️ 空行必须 **clone 最后一个真行** 再隐藏：自己造三个空 span 的话高度对不上
     （空 span 高度是 0，塞 &nbsp; 也不够——手机断点下每行仍差 2px，累计 17px）。
     clone 出来的行结构、字号、内外边距全都一样，高度必然相等。 */
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

/* ───────────────────────── 武器 ───────────────────────── */

/* 武器表固定行数：等级 + 精炼 + 最多 3 条属性（主属性 + 新副属性 + 已消失的旧副属性）。
   两栏必须一样高，否则下面的圣遗物整列错位 —— 这页全部价值就在逐行对读。 */
const WEAPON_ROWS = 5

/**
 * 武器卡 —— 跟圣遗物卡同一套压缩版式：40px 图标在左上、名称行 34px、
 * 下面一张词条表（等级 / 精炼 / 主副属性）。**不再画说明**（用户明确不要）。
 * 改过的件：左上旧图 + 右上新图，词条全套写成「旧 → 新」。
 */
function weaponCard (av, editable) {
  const w = av?.weapon || {}
  /* 改过的件挂 is-sim：属性数值一律青色（CSS 里染），一眼分清账号真值和模拟值 */
  const dirty = editable && isWeaponDirty()
  /* 改过时左上放**原来那把**的图（新图在右上），属性也才有旧值可比 */
  const org = dirty ? currentAvatar()?.weapon : null
  const item = el('div', 'item weapon' + (dirty ? ' is-sim' : ''))

  /* 左上图标**不带角标**：等级/精炼都进下面的词条表了，角标再写一遍是重复，
     而且 34px 的角标会盖住图的下半截（武器图竖长，比圣遗物更容易被遮）。 */
  const icon = el('div', 'sim-wicon')
  icon.append(setBg(el('div', 'sim-wimg'), (org?.icon || w.icon) || ''))
  item.append(icon)

  if (dirty) item.append(simNewIcon(w.icon))

  const head = el('div', 'head')
  head.append(nameCell(org?.name, w.name || w.sName || T('noWeapon')))
  item.append(head)

  /* 词条表：等级 / 精炼 / 主副属性。改过的件整套写成「旧 → 新」——
     等级和精炼也在这儿对比，不再靠两颗图标的角标去猜。 */
  const ul = el('ul', 'detail attr')
  ul.append(statRow(T('simLevel'), 'Lv.' + (w.level ?? '?'),
    org ? 'Lv.' + (org.level ?? '?') : null, dirty))
  ul.append(statRow(T('simRefine'), `${T('refine')}${w.affix ?? 1}`,
    org ? `${T('refine')}${org.affix ?? 1}` : null, dirty))

  /* 属性：把新旧两边的 key **并起来** —— 换武器类型时（攻击% → 暴击率），只列新列表的话
     消失和新增的那条就完全看不见。消失的写「旧值 → 0」、新增的写「0 → 新值」。
     `attrs` 是数组 `{key,label,value}`（名字由后端按 locale 给），这里按 key 建 Map 再并集。 */
  const nv = new Map((w.attrs || []).map(a => [a.key, a]))
  const ov = new Map((org?.attrs || []).map(a => [a.key, a]))
  const keys = [...nv.keys(), ...[...ov.keys()].filter(k => !nv.has(k))]
  for (const k of keys) {
    const n = nv.get(k)
    const o = ov.get(k)
    /* 名字优先取新的；只有旧值时用旧的（换掉的那条也得有名字） */
    const label = (n || o).label
    /* 武器主副属性**都不带 +**（游戏里是「基础攻击力 608」，只有圣遗物副词条才带） */
    const newText = n ? n.value : '0'
    /* 没改过时不给旧值（否则每条都「608 → 608」）；新加的那条旧值记 0 */
    const oldText = o ? o.value : (dirty && n ? '0' : null)
    ul.append(statRow(label, newText, oldText, dirty))
  }
  /* 补齐到固定行数：换武器时属性条数会变（2 条变 3 条），两栏武器卡就不同高，
     下面的圣遗物整列跟着错位。空行不画条纹，看着就是留白。 */
  for (let i = ul.children.length; i < WEAPON_ROWS; i++) ul.append(el('li', 'sim-row-empty'))
  item.append(ul)
  item.append(simCardBtns(editable, openWeaponDialog, dirty, revertWeapon))
  return item
}

/** 词条表里的一行「标签 | 旧 → 新」。oldText 是已经格式化好的串，没改过时传 null */
function statRow (label, newText, oldText, showOld) {
  const li = el('li')
  const t = el('span', 'title')
  t.append(el('span', 'label', label))
  li.append(t, valCell(newText, oldText, showOld))
  return li
}

/**
 * 改武器弹窗右侧的一行属性（主属性 / 副属性）。
 * 跟上面 statRow 不是一回事：那行是「旧 → 新」的对比，这里显示的是**这把武器自己的属性**，
 * 没有旧值可比 —— 别顺手复用成对比行。
 */
function wstat (label, value) {
  const row = el('div', 'sim-wstat')
  row.append(el('span', 'sim-wstat-k', label), el('span', 'sim-wstat-v', value))
  return row
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
  /* 这个弹窗多一栏简介，默认那档 520 宽塞两栏就太挤 —— 单独放宽（窄屏仍是整屏宽） */
  body.parentElement?.classList.add('sim-wwide')

  const wrap = el('div', 'sim-wbody')
  const form = el('div', 'sim-wform')

  /* 型号：目录后端已按角色武器类型滤过（迪奥娜只有弓）。三星到五星**一律标星级** ——
     只给五星标 ★，四星三星看着就像「没有星级」，反正一行放得下。 */
  const list = [...(sim.catalog?.weapons || [])]
  /* 当前那把不在目录里（miao 不认识这把新武器）时补一项：不补的话下拉会落到第一项，
     看着就是「打开对话框没选中我现在的武器」。 */
  const curW = currentAvatar()?.weapon
  if (cur.itemId && !list.some(w => w.itemId === cur.itemId)) {
    /* 补的这项没属性也没简介（miao 认不出），右侧那栏会显示「无数据」—— 比编数字强 */
    list.unshift({ itemId: cur.itemId, name: curW?.name || T('noWeapon'), star: curW?.star || 0, affixText: '', affixVals: [], main: null, sub: null })
  }
  const wSel = el('select', 'sim-select')
  for (const w of list) {
    const o = el('option', '', w.star ? `${w.name} ${w.star}★` : w.name)
    o.value = String(w.itemId)
    if (w.itemId === cur.itemId) o.selected = true
    wSel.append(o)
  }
  form.append(field(T('simWeaponType'), wSel))

  /* 等级：档位**由选中的那把武器给**（目录里 main.values 的键就是档位）—— 
     写死 [1,20,40,60,80,90] 的话 1★/2★ 那批能选到它们根本升不到的 Lv.90，
     跟「4★ 圣遗物能选 +20」是同一个坑。值就是 1 基等级本身，别 -1（那是圣遗物的口径）。 */
  const lvSel = el('select', 'sim-select')
  const drawLevels = (initial) => {
    const w = list.find(x => String(x.itemId) === wSel.value)
    const lvs = Object.keys(w?.main?.values || {}).map(Number).sort((a, b) => a - b)
    /* 当前那把没档位数据（miao 不认识的新武器）时退回常规档位，别让下拉空掉 */
    if (!lvs.length) lvs.push(1, 20, 40, 60, 70, 80, 90)
    const max = lvs[lvs.length - 1]
    let keep = initial ? (cur.level || 1) : (Number(lvSel.value) || cur.level || 1)
    /* 真实等级常常不是档位上的数（50 级、55 级），**初次打开**要按真值显示 ——
       不补的话下拉落到第一项，看着像「等级被重置成 1 级」 */
    if (initial && keep <= max && !lvs.includes(keep)) {
      lvs.push(keep)
      lvs.sort((a, b) => a - b)
    }
    /* 换武器后档位表会变（1★/2★ 只有 1/20/40/60/70，5★ 是 1/20/40/60/80/90）。
       keep 不在新表里就收敛到**不超过它的最大档** —— 不收敛的话 select.value 赋一个
       不存在的值会变成空串（浏览器直接把 selectedIndex 置 -1），右栏属性全部取不到值。 */
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
    if (a === cur.affix) o.selected = true
    afSel.append(o)
  }
  form.append(field(T('refine'), afSel))

  /* 右边：主/副属性 + 简介。三项都跟着上面两个下拉走 —— 等级改属性、精炼改简介里的数值。 */
  const info = el('div', 'sim-winfo')
  const stats = el('div', 'sim-wstats')
  const desc = el('div', 'sim-wdesc-body')
  const drawInfo = () => {
    const w = list.find(x => String(x.itemId) === wSel.value)
    const lv = lvSel.value
    stats.innerHTML = ''
    /* 值按**选中的等级档**取（后端每个档位都给了一份），没有就空着 —— 不编数 */
    if (w?.main) stats.append(wstat(w.main.label, w.main.values?.[lv] || ''))
    if (w?.sub) stats.append(wstat(w.sub.label, w.sub.values?.[lv] || ''))

    /* 简介：模板里的 $[0] $[1] 换成当前精炼那档的数值并**高亮**。
       游戏里就这几个数字跟着精炼变，标出来才看得出「改精炼改的是哪几个数」。
       1★/2★ 那批（无锋剑之类）没有精炼效果，整段是空的 → 给占位。 */
    desc.innerHTML = ''
    if (!w?.affixText) {
      desc.append(document.createTextNode(T('noData')))
      return
    }
    for (const [i, part] of w.affixText.split(/\$\[(\d+)\]/).entries()) {
      if (i % 2 === 0) {
        if (part) desc.append(document.createTextNode(part))
      } else {
        const v = (w.affixVals?.[Number(part)] || [])[Number(afSel.value) - 1]
        if (v) desc.append(el('span', 'sim-whl', v))
      }
    }
  }
  /* 换武器 → 档位可能变（1★/2★ 最高只到 70），先重画档位再重画右栏 */
  wSel.addEventListener('change', () => { drawLevels(false); drawInfo() })
  lvSel.addEventListener('change', drawInfo)
  afSel.addEventListener('change', drawInfo)

  info.append(stats, desc)
  wrap.append(form, info)
  body.append(wrap)
  drawInfo()
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

/** 每张卡都要包一层 `.artis`：miao 的规则全是 `.artis .item.xxx`（带容器前缀），
 *  不包的话卡片底图、圆角、投影一条都命中不了。 */
function wrapArti (card) {
  const box = el('div', 'artis')
  box.append(card)
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
  /* 右栏改过时，左上那颗要放**原来那件**的图标（新图在右上），词条也要有旧值可比 */
  const org = dirty ? originalArti(a.pos) : null
  const c = el('div', 'item arti' + (dirty ? ' is-sim' : ''))

  /* 左上图标：半透明当底纹，名称和第一行词条压在上面（CSS 里 opacity + 缩到 40px）。
     data-slot 给 CSS 的 ::before 当兜底部位字，跟明细页一个路子。 */
  const icon = el('div', 'arti-icon')
  icon.dataset.slot = slotGlyph(a.pos)
  const iconUrl = (org?.icon || a.icon) || ''
  const iconLv = (org?.level ?? a.level) ?? 0
  icon.append(setBg(el('div', 'img'), iconUrl))
  icon.append(el('span', '', '+' + iconLv))
  c.append(icon)

  /* 右上「新图标」：只有改过的件才有 —— 一眼看出这件是模拟出来的、套装甚至换了 */
  if (dirty) c.append(simNewIcon(a.icon, '+' + (a.level ?? 0)))

  const head = el('div', 'head')
  head.append(nameCell(org?.name, a.name))
  c.append(head)

  const ul = el('ul', 'detail attr')
  if (a.main) {
    const li = el('li', 'arti-main')
    const mt = el('span', 'title')
    mt.append(el('span', 'label', a.main.label))
    /* 旧值也要补 + 号：明细页主副词条一律 「+4,780」，只给新值加会一边有一边没有 */
    /* 主词条不带 +（只有副词条带）。旧值只在**还是同一条主词条**时才算数 ——
       换了属性（生命值 → 攻击力）旧值就不是「这条」的了，那条记 0。 */
    const sameMain = org?.main?.key === a.main.key
    li.append(mt, valCell(a.main.value, sameMain ? org.main.value : (dirty ? '0' : null), dirty))
    ul.append(li)
  }
  /* 副词条：把新旧两边的 key **并起来** —— 用户删掉一条时，只顺着新列表画的话
     那一行会整个消失，看不出「这条没了」；消失的写「旧值 → 0」（和武器属性同一个口径）。
     一个新 key 在一件圣遗物里只会出现一次（内核已把多次强化合成一条），所以按 key 配对。 */
  const subs = a.subs || []
  const orgSubs = org?.subs || []
  for (const key of [...subs.map(x => x.key), ...orgSubs.map(x => x.key).filter(k => !subs.some(x => x.key === k))]) {
    const s = subs.find(x => x.key === key)
    const oldSub = orgSubs.find(x => x.key === key)
    /* 挂权重三档类：颜色由 miao.css 的 `.artis ul.detail li.great/.nouse` 给
       （金 = 高权重、白 = 有用、灰 = 无用），跟明细页同一套规则，本文件不另写颜色 */
    const li = el('li', weightClass(Number(cw[key] ?? 0)))
    const lab = el('span', 'title')
    /* up-num = 强化命中圈（core.hitMark，实心圆+镂空数字）。删掉的那条没有新值，不画圈。
       ⚠️ 不渲染 i.eff（词条前面的「2.8」「5.2」那种小数）—— 那是权重/有效率，
         用户明确要求隐藏。别顺手加回来。 */
    const hit = s ? Math.min(5, (s.upNum || 0) - 1) : 0
    if (hit > 0) {
      const um = el('i', 'up-num')
      um.append(hitMark(hit))
      lab.append(um)
    }
    lab.append(el('span', 'label', (s || oldSub).label))
    /* 旧件没这条 = 本次新加的副词条 → 旧值记 0（写「0 → +31」而不是只写「+31」，
       否则看不出这条是这次才有的）；反之新件没这条 = 被删掉的 → 新值记 0 */
    const newText = s ? '+' + s.value : '0'
    const oldText = oldSub ? '+' + oldSub.value : (dirty ? '0' : null)
    li.append(lab, valCell(newText, oldText, dirty))
    ul.append(li)
  }
  c.append(ul)
  c.append(simCardBtns(editable, () => openArtiDialog(a), dirty, () => revertArti(a.pos)))
  return c
}

/**
 * 卡片标题。改名时写成「旧名 → 新名」—— **新名不能把旧名顶掉**，
 * 换掉的是哪一把/哪一件，得一眼看出来（只显示新名就分不清是「本来就是这样」还是「刚换的」）。
 * 名字是识别这件东西的主要信息，所以宁可折行也不省略。
 */
function nameCell (oldName, newName) {
  const s = el('strong')
  if (oldName && newName && oldName !== newName) {
    /* 竖排两行（旧名一行、新名一行），不写「A → B」一整串：head 只有 92px 宽，
       一行塞两个名字会被右侧的按钮压住。箭头放在新名前面，读起来还是「变成」。
       用 flex column 而不是 <br>，行高和间距好控。 */
    const nn = el('span', 'sim-newname')
    nn.append(el('i', 'sim-arrow', '→'), document.createTextNode(newName))
    s.append(el('span', 'sim-oldname', oldName), nn)
  } else {
    s.append(document.createTextNode(newName || ''))
  }
  return s
}

/** 右上那颗「新图标」（改过的件才有）：图 + 右下角标签，青色描边表示是模拟出来的。
 *  标签由调用方给全（圣遗物「+20」、武器「Lv.90」）—— 两者写法本来就不一样。 */
function simNewIcon (url, label) {
  const box = el('div', 'sim-newicon')
  box.append(setBg(el('div', 'img'), url || ''))
  /* label 可省：武器卡把等级/精炼都放进词条表了，图标只留图，不再压一个角标上去 */
  if (label) box.append(el('span', '', label))
  return box
}

/**
 * 数值单元格。改过的件写成「旧 → 新」（旧的灰、新的青）。
 *
 * ⚠️ 只有**值真的变了**才写箭头：改一件装备时，那张卡上大多数词条其实没动，
 *   全写成「+5.8% → +5.8%」只是噪声（面板属性表也是同一个规矩，见 attrPanel）。
 *   删掉的那条能出来，是因为新值明确记 0（`+54 → 0`），不是靠「没旧值」判断的。
 */
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
/** 改一件圣遗物：套装（带星级）/ 等级（按星级封顶）/ 主词条 / 副词条 */
function openArtiDialog (a) {
  const cur = draftOfPos(a.pos) || defaultDraftOf(a)
  const dlg = openDialog({
    title: `${T('simEdit')} · ${slotGlyph(a.pos)}`,
    onOk: () => {
      const next = {
        set: setSel.value,
        pos: a.pos,
        star: starOf(),
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

  /* 套装：只列**有这个部位**的套装（祭X之人那批只有冠），名字后面标这套**最高几星**。
     不过滤部位的话能选到「祭雷之人的花」，后端认不出这种组合会整件草稿静默跳过 ——
     现象是值被染成模拟色、但一个数都没变（用户实测报过这个）。
     `!x.positions` 是给「前端比后端新」的场合兜底（web/ 是独立仓库，可能先发）：
     老接口没这个字段时照旧全列，不至于让下拉空掉。 */
  const setOpts = (sim.catalog?.sets || []).filter(x => !x.positions || x.positions.includes(a.pos))
  const setSel = el('select', 'sim-select')
  for (const s of setOpts) {
    const o = el('option', '', s.star ? `${s.name} ${s.star}★` : s.name)
    o.value = s.key
    if (s.key === cur.set) o.selected = true
    setSel.append(o)
  }
  body.append(field(T('simSet'), setSel))

  /*
   * 星级由**套装**决定，不单独选：4★ 那批（教官/战狂/祭X之人…）满级 +16，5★ 套装能到 +20。
   * ⚠️ 取 `min(这件原本的星级, 套装最高)`：5★ 套装里也可能穿着一件 4★ 的（掉落就有 4★），
   *   直接按套装最高算会把它悄悄升星、主词条跟着变一截。
   */
  const starOf = () => Math.min(cur.star || 5, setOpts.find(s => s.key === setSel.value)?.star || 5)

  /*
   * 等级：**草稿里存的是 enka 原始等级（1 基，1..21）**，而玩家读的是「+N」（0..20）。
   * 每 4 级一档，标签显示 lv-1；别把 0 塞进来 —— 后端按 levelRaw 处理，0 会变负等级。
   * 上限跟着星级走（4★ 只到 +16），档位表从目录拿（`starLevels`），前端不另存一份游戏规则。
   */
  const lvSel = el('select', 'sim-select')
  const drawLevels = () => {
    const keep = Number(lvSel.value) || cur.level || 1
    const max = (sim.catalog?.starLevels || []).find(x => x.star === starOf())?.maxLevel ?? 21
    lvSel.innerHTML = ''
    for (let lv = 1; lv <= max; lv += 4) {
      const o = el('option', '', `+${lv - 1}`)
      o.value = String(lv)
      lvSel.append(o)
    }
    /* 换到更低星的套装时把超出上限的档位收敛掉（+20 → +16），别停在一个不存在的档 */
    lvSel.value = String(Math.min(keep, max))
  }
  setSel.addEventListener('change', drawLevels)
  drawLevels()
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
    mainKey: mainKeyOf(a.main),
    subs: (a.subs || []).map(s => ({ key: s.key, value: parseNum(s.value) }))
  }
}

/**
 * 主词条 key：内核口径 → 目录/下拉用的口径。
 *
 * ⚠️ 元素伤害杯的主词条在核心里是**具体元素**（`cryo` / `pyro` …），而目录只给一项 `dmg`。
 *   不翻回来的话下拉里一个都选不中，浏览器按规则默认选第一项（攻击力）——
 *   于是「只改个副词条、顺手点确定」会把主词条悄悄换成攻击力，冰伤直接归零
 *   （实测：冰伤加成 46.6% → 大攻击 0 → 46.6%）。
 */
function mainKeyOf (main) {
  const key = main?.key
  if (!key) return 'hpPlus'
  return key === currentAvatar()?.elem ? 'dmg' : key
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
 * 左栏那件原件（按部位找）。右栏画「旧 → 新」、放「旧图标」都要比着它。
 * 找不到 / 原本就是空件时返回 null，调用方自己兜底。
 */
function originalArti (pos) {
  return (currentAvatar()?.artifacts || []).find(x => x.pos === pos) || null
}

/**
 * 这件圣遗物是否被改过。
 * ⚠️ 必须跟**左栏原始视图**（currentAvatar）比，不能跟右栏那个 `a` 比 ——
 *   右栏的 a 本身就是改后的结果，拿它跟草稿比永远相等，改过的件会被判成没改。
 */
function isArtiDirty (pos) {
  const d = draftOfPos(pos)
  if (!d) return false
  const org = originalArti(pos)
  if (!org || org.empty) return true          // 原本空着，现在填了东西 = 改动
  const o = defaultDraftOf(org)
  /* 星级也算改动：它会改主词条的数值档位和满级上限（4★ 最高 +16） */
  if (d.set !== o.set || d.star !== o.star || d.level !== o.level || d.mainKey !== o.mainKey) return true
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
