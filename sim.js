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
  $, state, T, el, slotGlyph, api, reg, showView, openDialog, W_ATTR_TITLE, setBg, imgError
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

  /* 顶栏：← 返回 + 复原。角色名交给下面的 hero（顶栏再来一遍是重复，明细页也正是这么砍掉的） */
  const bar = el('div', 'sim-head')
  const back = el('button', 'btn back', '← ' + T('back'))
  back.addEventListener('click', () => showView('detail'))
  bar.append(back, el('span', 'sim-gap'))
  /* 复原：把草稿清空 = 右栏回到当前实装。改花了眼时一键回到起点，省得一件件退回 */
  const reset = el('button', 'btn', T('simReset'))
  reset.addEventListener('click', resetDraft)
  bar.append(reset)
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

  /*
   * 伤害对比表：**跨整卡宽度**放在两栏下面，不在任何一栏里。
   * 一栏一张表的旧摆法，520px 里每张只有 242px，「Q泡影破裂蒸发」这种长标题 + 两列数字
   * 必然折行（用户明确说折行不好看）。合成一张表后：第一列技能名合并，后面
   * 「当前 / 调整后 / 变化」四列并排 —— 496px 容得下，而且左右一眼能对读。
   */
  const dmgBox = el('div', 'sim-dmgfull')
  dmgBox.append(el('div', 'placeholder', T('dmgLoading')))
  card.append(dmgBox)
  box.append(card)

  sim.dmgBox = dmgBox
  loadLeftDamage().then(drawDamageCompare)
}

/**
 * 顶部的角色头 —— 明细页 `.pd-canvas` + `.basic` 那套视觉语言的横向版：圆圈肖像 | 元素+名字 | 等级命座天赋。
 *
 * ⚠️ 这里**不画自己的背景**：元素背景由外层 `.sim-card` 整张铺满（详见 renderSim），
 *   hero 只是浮在上面的一行。以前 hero 自带背景 = 「标题块」，上下会有一条硬边。
 *
 * ⚠️ 为什么用 `face` 不用 `splash` / `side` / `face-q`（都实测过）：
 *   · splash（970~1615×1024，比例 0.95~1.58）—— 横条和纵向立绘尺寸对不上，缩着放右边一大片空、
 *     用 cover 铺满又把人裁成无头半身，且各角色比例不一，裁完每人效果都不同，没法统一。
 *   · side **只有 128×128** —— 名字像是「侧身图」，其实 miao 里只用在列表的小圆头像；
 *     放大到 150px 的圆圈里肉眼可见发虚。
 *   · face-q 是 Q 版（上游仅 83/132 有），风格跟正比混排不统一。
 *   · `card` 是卡背花纹（画面里没有角色）、`splash0`（真横版立绘）只有 8 个角色有、`gacha` 320×1024 更纵。
 *   只有 face（256×256，127/132 覆盖）缩到 150px 是「缩小」，清晰度反而最好。
 *
 * ⚠️ 圆圈必须 `background-position: center top`：face 是头肩构图，往下压会把帽檐切更多。
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

  /* 右：等级 / 命座 / 天赋 a-e-q。UID 不上台面（同一账号下所有角色都一样，占地方） */
  const rt = el('div', 'sim-hero-rt')
  const lv = el('div', 'sim-hero-lv')
  lv.append(el('span', '', 'Lv.'), el('b', '', String(av.level ?? '?')))
  rt.append(lv)
  rt.append(el('span', 'cons-badge', `${av.cons ?? 0}${T('cons')}`))

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
  wrap.append(weaponCard(av, false))
  wrap.append(artiView(av.artifacts))
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
  wrap.append(weaponCard(av, true))
  wrap.append(artiEditor(av.artifacts))
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
 * 武器卡。两栏**同构**：同样的图标 / 名称 / 主副属性 / 说明，右栏多一颗可见的「改」，左栏同位置
 * 放一颗隐形占位钮。
 *
 * ⚠️ 编辑走弹窗，不在卡里摆下拉。早期右栏摆三个下拉（型号/等级/精炼）、左栏跟着摆三个置灰的，
 *   用户明确说「左边的武器不需要修改，没必要有下拉框样式」。现在两边都只显示 + 一颗改按钮，
 *   真正的编辑跟圣遗物一个路子（openWeaponDialog）。
 *
 * ⚠️ 左栏那颗隐形钮不能省：右边这颗吃掉约 50px 宽，不占位的话右栏的说明会多折一行，
 *   武器卡差一截，下面的属性表就跟着错位（实测 5 件下来能差 76px）。
 */
function weaponCard (av, editable) {
  const w = av?.weapon || {}
  const box = el('div', 'sim-weapon')

  /* 第一行：图标 | 名称 + 等级精炼 | 改按钮 */
  const row = el('div', 'sim-wrow')
  if (w.icon) row.append(setBg(el('div', 'sim-wicon'), w.icon))
  const name = el('div', 'sim-wname')
  name.append(el('strong', '', w.sName || w.name || T('noWeapon')))
  name.append(el('span', 'sim-wmeta', `Lv.${w.level ?? '?'} · ${T('refine')}${w.affix ?? 1}`))
  row.append(name)

  const btn = el('button', 'sim-editbtn', T('simEdit'))
  if (editable) {
    btn.addEventListener('click', () => openWeaponDialog())
  } else {
    /* 隐形之外还要 disabled：它虽然看不见，但 Tab 键仍能走上去、读屏也会念出来 */
    btn.classList.add('sim-ghostbtn')
    btn.disabled = true
  }
  row.append(btn)
  box.append(row)

  box.append(weaponAttrs(w))

  /* 说明：miao 的描述里带 <nobr> 高亮标签，这里只取纯文本（顺手避免注入）。
     ⚠️ 限三行不是怕长 —— 两边武器不同、说明长短不一，不限行两栏武器卡就不同高，属性表会错开。 */
  box.append(el('div', 'sim-wdesc', String(w.desc || '').replace(/<[^>]*>/g, '')))
  return box
}

/** 改武器：型号 / 等级 / 精炼（草稿里存的是 1 基等级，跟 profile.weapon.level 同口径） */
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

  /* 按钮两栏都渲染，左栏只占位不显示。为什么不干脆不渲染：右边这颗钮吃掉约 50px 宽，
     右栏的副词条就会比左栏多折一行，5 件下来伤害表要错开 76px（实测过）。
     留着同宽的隐形钮，两栏才逐行对齐。 */
  const btn = el('button', 'sim-editbtn', T('simEdit'))
  if (editable) {
    btn.addEventListener('click', () => openArtiDialog(a))
  } else {
    /* 隐形之外还要 disabled：它虽然看不见，但 Tab 键仍能走上去、读屏也会念出来 */
    btn.classList.add('sim-ghostbtn')
    btn.disabled = true
  }
  row.append(btn)
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
  api(`accounts/${state.uid}/characters/${avatarId}/simulator`).then(c => {
    sim.catalog = c
    recompute()
  })
}

reg.renderSim = renderSim
reg.openSim = openSim
