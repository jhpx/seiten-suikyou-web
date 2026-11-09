/*
 * 首页：账号头 + 角色网格 + 卡片，实际上就是整个首屏。
 * 名字里的 roster 是「花名册 / 阵容」：游戏里说 my roster，就是「我账号里这堆角色」。
 * 三个视图按粒度分：roster（全体名单）→ detail（单人明细）→ sim（模拟推演）。
 * 名字比内容窄了点：筛选、排序、刷取建议面板也都长在这个模块里。
 * ⚠️ state.rosterMode 跟名单无关，它管的是卡片下半块显示武器还是圣遗物套装。
 *
 * 渲染器在加载时注册进 core.reg（renderRoster / renderRosterGrid），由编排函数统一调用。
 */

import { $, state, T, el, setBg, rankOf, weaponFallback, imgError, openDetail, reg } from '../../core.js'
import { sortAvatars } from './sort.js'
import { filteredAvatars } from './filter-options.js'

/* 卡片元素 ↔ avatar 的映射：切「武器/圣遗物」视图时靠它把每张卡的下半块就地换掉，
   不用重建整张卡，上半块（含立绘 <img>）原样保留，浏览器不重新请求/解码。 */
const cardAvatar = new WeakMap()

function renderAccountHeader (acct) {
  const box = el('div', 'acct-header')
  if (!acct) return box

  box.append(el('div', 'acct-nick', acct.nickname || `UID ${acct.uid}`))
  if (acct.signature) box.append(el('div', 'acct-sig', acct.signature))

  const meta = el('div', 'acct-meta')
  for (const [label, value] of [[T('level'), acct.level], [T('worldLevel'), acct.worldLevel], ['UID', acct.uid]]) {
    const d = el('div')
    d.append(el('b', '', value ?? '—'))
    d.append(el('span', '', label))
    meta.append(d)
  }
  box.append(meta)
  return box
}

/*
 * 首页的一张角色卡 —— 照原魔工具箱「角色展柜」中间那块做的。
 *
 * 它跟明细页是两种东西：明细页是 miao 那张**出图**，要 1:1；首页是**列表**，
 * 只借它的视觉语言（星级底色 / 半透明分数带 / 白色等级条 / 元素图标），
 * 所以这里不照抄 miao 的任何 CSS。
 *
 * 一条铁律：**不显示角色名**（名字只在 hover 提示和明细页里出现）。既然版面上一个名字都没有，
 * 提示就是唯一的「认人」入口，得**分两块挂**：画像区报角色那四项，武器块报武器那三项 ——
 * 整卡挂一个提示的话，鼠标停在武器上却报角色等级，答非所问。
 *
 * 卡片两段：ⓐ 画像区（四个角：元素图标 / 等级 / 评分 / 评级）ⓑ 武器块（白底）。
 * 分数不再单独占一条通栏黑带（黑带 + 白条上下叠会把卡片切成四段，太重），
 * 但它自己那块半透明黑底不能省 —— 星级橙底/紫底上奶白字不垫底看不清（见 style.css 的 .cc-score）。
 */
/*
 * 两种视图共用的画像区：星级底图 / 立绘 / 元素图标 / 等级 / 分数 / 评级，六层按这个顺序叠。
 * 阶段 B 把这段从两种卡里抽成 renderCardTop 共用；现在整张卡 = 上半块(renderCardTop) + 下半块(buildFoot)，
 * 下半块按 state.rosterMode 在「武器块 / 圣遗物套装块」间切换，切视图时 swapRosterFoot 只换这一小块。
 */
function renderCardTop (av, rank) {
  const bg = setBg(el('div', 'cc-bg'), av.rarityBg)

  const face = el('img', 'cc-face')
  face.src = av.imgs?.face || av.splash
  face.alt = ''
  face.loading = 'lazy'
  face.onerror = () => imgError(face)

  const elem = el('img', 'cc-elem')
  elem.src = av.elemIcon
  elem.alt = av.elemText || ''
  elem.onerror = () => imgError(elem)

  const lv = el('div', 'cc-lv', `Lv.${av.level ?? '?'}`)
  const score = el('div', 'cc-score', av.score.mark)
  /* 色走 miao.css 的 .mark-*（档位名就是类名后缀），跟明细页 / 圣遗物卡同一套 */
  const badge = el('span', 'cc-rank mark-' + rank, rank)

  const top = el('div', 'cc-top')
  top.append(bg, face, elem, lv, score, badge)
  return top
}

/*
 * 卡片下半块：武器块（weapon 视图）或圣遗物套装块（artis 视图）。
 *
 * 两种视图**只差这一块**——上半块（renderCardTop：星级底图 / 立绘 / 元素 / 等级 / 评分 / 评级）
 * 完全一样。所以切视图时只换这块（见 swapRosterFoot），上半块（含立绘 <img>）原样保留、不重建，
 * 浏览器就不会重新请求/解码，切换就不卡了。脚注块统一挂 .cc-foot 类，方便精准替换。 */
function buildFoot (av) {
  if (state.rosterMode === 'artis') {
    /* 只认激活的套装（2 件起）：单件不激活套装效果，列出来只是噪音。
       接口给的是全量件数（含 count:1），过滤放在显示层，筛选项那边同一个口径。
       最多两行：4件 或 2+2；一个都没带时出「无圣遗物」占位，整排高度才整齐。 */
    const sets = (av.sets || []).filter(s => s.count >= 2).sort((a, b) => b.count - a.count)
    const sp = el('div', 'cc-sets cc-foot')
    if (!sets.length) {
      sp.append(el('div', 'cc-sets-empty', T('noArtis')))
    } else {
      const box = el('div', 'cc-sets-list')
      for (const s of sets) {
        const row = el('div', 'cc-set-row')
        /* 图标是这一行的第一个格子：同一行垂直居中 → 天然和这行字对齐 */
        row.append(setIcon(s.icon), el('span', '', s.name), el('b', 'cc-set-n', `×${s.count}`))
        box.append(row)
      }
      sp.append(box)
    }
    return sp
  }

  /* 武器块：白底。没武器（或 miao 不认识这把）也要出这一块，整排高度才整齐。
     左边图标一整栏、右边名字 + 等级·精炼两行 —— 短名字也不会在底部空出一块。
     等级 · 精炼跟在名字下面，中间那个「·」由 CSS 补。 */
  const wName = av.weapon?.name || weaponFallback(av.weapon)
  const wText = el('div', 'cc-wtext')
  wText.append(el('strong', '', wName))
  const meta = el('div', 'cc-wmeta')
  if (av.weapon?.level) meta.append(el('b', '', `Lv.${av.weapon.level}`))
  if (av.weapon?.affix) meta.append(el('b', 'refine', `${T('refine')}${av.weapon.affix}`))
  wText.append(meta)
  const wp = el('div', 'cc-weapon cc-foot')
  wp.append(setBg(el('div', 'cc-wicon'), av.weapon?.thumb), wText)
  return wp
}

/*
 * 一张角色卡 = 上半块（画像，两种视图共用）+ 下半块（buildFoot，随视图切换）。
 * 卡片元素 ↔ avatar 记进 cardAvatar（见文件头），切视图时靠它把下半块就地换掉，不用重建整张卡。 */
function renderCard (av) {
  const rank = rankOf(av.score.markClass)
  const card = el('div', 'char-card')
  card.append(renderCardTop(av, rank), buildFoot(av))
  card.addEventListener('click', () => openDetail(av.avatarId))
  cardAvatar.set(card, av)
  return card
}

/*
 * 套装图标：一套一个图标放在它自己那行最左边（图标 + 名字 + 件数同一行），两套就是两行、
 * 每行各一个图标，所以「第几个图标 = 第几行字」由结构保证，不靠算偏移。
 * 用花（1 号位）当代表图：每套都出全五件、部位图不缺，且花（和羽）造型差别最大，
 * 沙/杯/冠缩到 17cqw 分不出来。图是 tools/gen_flower.py 预处理过的（裁透明边、缩 96px）。 */
function setIcon (src) {
  const slot = el('div', 'ci-slot')
  const i = el('img')
  i.src = src || ''
  i.alt = ''
  i.onerror = () => imgError(i)
  slot.append(i)
  return slot
}

function renderRoster () {
  const view = state.view
  const box = $('view-roster')
  box.innerHTML = ''

  box.append(renderAccountHeader(view?.account))

  /* 页脚只报「数据时间」。写在这里（早退之前）：没角色可评时卡片不画，
     但时间得跟着当前这份数据走，不能停在上一个 UID 的时刻上。
     这里报的是 **UID 级**时间（= 上次抓 enka 的时刻，view.fetchedAt 来自 fetch_log）；
     某个角色自己的时间在明细页看（av.fetchedAt）。两个粒度不许混 —— 展柜分批攒，
     用 UID 级时间去说单个角色有多新，会把 10 月 6 号的老数据说成刚抓的。 */
  $('footmeta').textContent = `${T('scoredAt')} ${view?.fetchedAt || '—'}`

  /* 纯首屏：从没查过任何账号（state.view 还是 null）。给一句引导就够，
     别用「这个账号里没有可评分的角色」—— 人家根本还没账号呢，那话看着像 bug。 */
  if (!view) {
    const ph = el('div', 'placeholder')
    ph.append(el('p', '', T('noUid')), el('p', 'dim', T('noUidHint')))
    box.append(ph)
    return
  }
  if (!view.avatars.length) {
    const ph = el('div', 'placeholder')
    ph.append(el('p', '', T('noScorable')), el('p', 'dim', T('noScorableHint')))
    box.append(ph)
    return
  }

  box.append(reg.renderFilterBar?.(view))
  const slot = el('div', 'rf-grid')
  box.append(slot)
  renderRosterGrid(slot)

  /* 刷圣遗物建议放在角色列表**后面**：它是「翻完人再看」的整号结论，
     放上面会把首屏的角色挤走；而筛选/排序是「找人」的操作，得紧贴网格。 */
  const advice = reg.renderAdvice?.()
  if (advice) box.append(advice)
}

function renderRosterGrid (slot) {
  slot.innerHTML = ''
  const list = filteredAvatars(state.view)
  if (!list.length) {
    slot.append(el('div', 'placeholder', T('noMatch')))
    return
  }
  const sorted = sortAvatars(list)
  const grid = el('div', 'char-grid')
  /* 两种视图只差卡片下半块：武器（默认）/ 圣遗物套装。
     画像区、网格、筛选、排序全共用 —— 视图切换不重置任何筛选条件。 */
  for (const av of sorted) grid.append(renderCard(av))
  slot.append(grid)

  /* 限高 + 滚动机理由 fitRosterGrid 统一处理（切视图后下半块高度会变，也得重算一次）。 */
  fitRosterGrid(slot)
}

/* 量出第一张卡高，给 .rf-grid 设「限 4 行」的 max-height（见 char-card.css 的 .rf-grid）。
   卡片高度是 cqw 自适应的，纯 CSS 写不出精确的 4 行高，这里 JS 量；offsetHeight 是未缩放布局高，
   坐标系与 max-height 一致，不用除以 fitShell 的倍率。 */
function fitRosterGrid (slot) {
  const grid = slot.querySelector('.char-grid')
  const first = grid?.querySelector('.char-card')
  if (!first) return
  const cardH = first.offsetHeight
  const gap = parseFloat(getComputedStyle(grid).rowGap) || 10
  slot.style.maxHeight = (4 * cardH + 3 * gap) + 'px'
}

/* 切「武器 / 圣遗物」视图：avatar 名单和排序都没变，只有卡片下半块不同，
   所以只把每张卡的下半块（.cc-foot）就地替换掉，上半块（含立绘 <img>）原样保留 ——
   立绘不重建，浏览器就不会重新请求/解码，切换就不卡了。上半块不动也意味着整张卡的
   click 监听不动。下半块高度可能变（武器块 vs 套装块 min-height 不同），换完顺手重算一下限高。 */
function swapRosterFoot () {
  const slot = document.querySelector('#view-roster .rf-grid')
  if (!slot) return
  const grid = slot.querySelector('.char-grid')
  if (!grid) return
  for (const card of grid.querySelectorAll('.char-card')) {
    const av = cardAvatar.get(card)
    if (!av) continue
    card.querySelector('.cc-foot')?.remove()
    card.append(buildFoot(av))
  }
  fitRosterGrid(slot)
}

reg.renderRoster = renderRoster
reg.renderRosterGrid = renderRosterGrid
reg.swapRosterFoot = swapRosterFoot
