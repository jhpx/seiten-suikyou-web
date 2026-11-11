/*
 * 明细页的 YSIN 评分板块：与喵喵评分平级的第二个板块，夹在它和伤害计算之间。
 *
 * 两段式与喵喵完全同构：深标题栏（板块名 + 流派控件 + 评估对象）→ 全透内容。
 * 内容里是左 185px 两个分数加三行汇总、右侧四列词条对照与三个伤害读数，
 * 免责句只是内容末尾靠右的一行小字，不再单做一条深色尾带。
 * 板块外壳在 detail-base.css 的 .score-block 共用规格里，本文件只建内部。
 * 内部配色与行高对齐 miao 的评分卡（score-card.css），视觉规格见 docs/wireframe/05-ysin.html。
 *
 * 与 miao 那套完全分开：不换算分数、不共用评级与档位色。
 * 流派控件坐在标题栏，因为换流派会重算整块的词条与伤害；后端一次返回全部流派，
 * 切换只重画数字、不再发请求。标题栏的「评估对象」也必须跟着流派一起换。
 *
 * 和 loadDamage 一样是异步填坑：回来时用户可能已经点了别的角色或切了语言，
 * 填之前核对 state.selectedAvatarId 与容器是否还挂在文档上。
 */
import { el, T, api, state, richText } from '../../core.js'
import { fitSelectText, fitDetailScale } from './detail-fit.js'

/* 数值全精度过来，只在最外层展示时统一格式化：词条 / 分数 1 位小数，伤害取整数 */
const n1 = v => Number(v ?? 0).toFixed(1)
const dmg = v => Math.round(Number(v ?? 0)).toLocaleString('en-US')

async function loadYsin (av, box) {
  box.append(ysinStatus(T('ysinLoading')))
  let view = null
  try {
    /* locale 必须带：技能名、天赋槽、属性名都是后端按语言给的 */
    view = await api(`accounts/${av.uid}/characters/${av.avatarId}/ysin?locale=${encodeURIComponent(state.locale)}`)
  } catch (e) {
    if (state.selectedAvatarId !== av.avatarId || !box.isConnected) return
    console.error('[ysin] 明细页 YSIN 评分读取失败:', e)
    box.replaceChildren(ysinStatus(T('ysinFail'), true))
    box.dataset.ysinReady = '1'
    fitDetailScale()
    return
  }
  if (state.selectedAvatarId !== av.avatarId || !box.isConnected) return
  /* data 为 null = 这个角色在 YSIN 网页里没有可评分流派，出一行小字，不出空卡 */
  if (!view?.schools?.length) {
    box.replaceChildren(ysinStatus(T('ysinNone')))
    box.dataset.ysinReady = '1'
    fitDetailScale()
    return
  }
  box.replaceChildren(renderYsinCard(view))
  /* 截图等待靠这个标记认「已经不是 loading」，别去猜状态卡的 DOM 形状 */
  box.dataset.ysinReady = '1'
  fitDetailScale()
  /* 字体 / 图片回流可能改高度，下一帧再算一次兜底 */
  requestAnimationFrame(fitDetailScale)
}

/* 标题栏：竖条 + 板块名 + 流派控件 + 右侧评估对象。
   没有流派数据的三种状态也走这里，控件显示破折号占位，标题栏高度就不跳。 */
function ysinHead (view) {
  const head = el('div', 'score-block-head')
  head.append(el('span', 'dot'), el('span', 'name', T('ysinSection')))

  const schools = view?.schools?.length ? view.schools : null
  const ctl = el('div', 'block-control' + (schools ? ' has-select' : ''))
  ctl.append(el('span', 'ctl-label', T('ysinSchool')))
  let sel = null
  if (schools) {
    sel = el('select', 'ctl-select')
    sel.setAttribute('aria-label', T('ysinSchool'))
    for (const s of schools) {
      const o = el('option', '', s.name)
      o.value = s.id
      sel.append(o)
    }
    ctl.append(sel)
  } else {
    ctl.append(el('span', 'ctl-value', '—'))
  }
  head.append(ctl)

  const object = el('div', 'meta')
  head.append(object)
  return { head, sel, object }
}

/* 内容末尾的一行免责句：全透背景，不是独立的尾行 */
function ysinNotice () {
  const notice = el('div', 'block-notice')
  richText(notice, T('ysinNotice'))
  return notice
}

/* loading / 失败 / 无数据也保持完整的两段式外壳，避免加载完成时整块跳形 */
function ysinStatus (text, err = false) {
  const card = el('div', 'score-block ysin')
  const { head } = ysinHead(null)
  const body = el('div', 'score-block-body')
  body.append(el('div', 'ysin-status' + (err ? ' err' : ''), text), ysinNotice())
  card.append(head, body)
  return card
}

/* 一个英雄数字格：标签常驻，数值留给 paint 填 */
function heroCell (label, store, key) {
  const cell = el('div')
  cell.append(el('div', 'ysin-hero-label', label))
  const num = el('div', 'ysin-hero-num', '—')
  store[key] = num
  cell.append(num)
  return cell
}

/* 汇总区一行：左边标签、右边数值 */
function kvRow (label, store, key) {
  const row = el('div', 'ysin-kv')
  row.append(el('span', '', label))
  const num = el('span', 'ysin-kv-num', '—')
  store[key] = num
  row.append(num)
  return row
}

function renderYsinCard (view) {
  const card = el('div', 'score-block ysin')
  const { head, sel, object } = ysinHead(view)

  const blockBody = el('div', 'score-block-body')
  const body = el('div', 'ysin-body')

  /* ── 左栏 ── */
  const left = el('div', 'ysin-left')
  const heroNums = {}
  const heroes = el('div', 'ysin-heroes')
  heroes.append(
    heroCell(T('ysinSubScore'), heroNums, 'sub'),
    heroCell(T('ysinGearScore'), heroNums, 'gear')
  )
  left.append(heroes)

  const kvNums = {}
  const summary = el('div', 'ysin-summary')
  summary.append(
    kvRow(T('ysinTotal'), kvNums, 'total'),
    kvRow(T('ysinCounted'), kvNums, 'counted'),
    kvRow(T('ysinBench'), kvNums, 'bench')
  )
  left.append(summary)

  /* 底部细条：这套「基准配装」就是 dmgDefault 的计算配置，来自网站、跟着流派换。
     文字只是身份说明，真正当分母的是右栏「默认整套」那格数值。 */
  const foot = el('div', 'ysin-foot')
  left.append(foot)

  /* ── 右栏 ── */
  const right = el('div', 'ysin-right')
  const grid = el('div', 'ysin-grid')
  right.append(grid)

  const dmgNums = {}
  const dmgBox = el('div', 'ysin-dmg')
  for (const [key, label] of [
    ['dmgYou', 'ysinDmgYou'],
    ['dmgBench', 'ysinDmgBench'],
    ['dmgDefault', 'ysinDmgDefault']
  ]) {
    const cell = el('div')
    cell.append(el('div', 'ysin-hint', T(label)))
    const num = el('div', 'ysin-dmg-num', '—')
    dmgNums[key] = num
    cell.append(num)
    dmgBox.append(cell)
  }
  right.append(dmgBox)

  body.append(left, right)
  blockBody.append(body, ysinNotice())
  card.append(head, blockBody)

  /* 切流派：只换数字，不重建 select、不重新发请求 */
  function paint (id) {
    const s = view.schools.find(x => x.id === id) || view.schools[0]
    sel.value = s.id

    object.textContent = T('ysinObject', {
      skill: s.skillName, slot: s.talentSlot, lv: s.talentLevel
    })
    heroNums.sub.textContent = n1(s.subScore)
    heroNums.gear.textContent = n1(s.gearScore)
    kvNums.total.textContent = n1(view.total)
    kvNums.counted.textContent = n1(view.counted)
    kvNums.bench.textContent = n1(s.benchTotal)
    /* 185px 装不下「前缀 + 配装」一整句：内联会折行，把「4件」两个字孤零零甩到第二行。
       索性拆成上下两行 —— 标签一行、配装一行，都在细条内居中，标签不会被拆开。
       用 replaceChildren 而不是 textContent，切流派时高亮标签才不会被冲掉。 */
    foot.replaceChildren(
      el('div', 'ysin-foot-label', T('ysinBasisGear')),
      el('div', 'ysin-foot-gear', [s.wText, s.aText].filter(Boolean).join(' · '))
    )

    grid.replaceChildren(...gridCells(s))
    dmgNums.dmgYou.textContent = dmg(s.dmgYou)
    dmgNums.dmgBench.textContent = dmg(s.dmgBench)
    dmgNums.dmgDefault.textContent = dmg(s.dmgDefault)

    /* 各语言流派名长短不一，原生 select 会切字；量过再定字号。
       切完流派可能改变卡片高度，顺手重配外壳。 */
    requestAnimationFrame(() => {
      if (sel.isConnected) fitSelectText(sel)
      fitDetailScale()
    })
  }

  sel.addEventListener('change', () => paint(sel.value))
  paint(view.current)
  return card
}

/* 四列词条对照：属性 / 你的 / 其中武器 / 基准，末行是「未计入」 */
function gridCells (s) {
  const cells = []
  for (const text of [T('ysinAttr'), T('ysinYours'), T('ysinWeapon'), T('ysinBenchCol')]) {
    cells.push(el('div', 'ysin-cell head', text))
  }
  for (const r of s.rows) {
    cells.push(el('div', 'ysin-cell', r.label))
    cells.push(el('div', 'ysin-cell num', n1(r.yours)))
    /* 没有武器贡献时画破折号，不写 0.0 —— 「其中武器」是「你的」的一部分 */
    cells.push(r.weapon == null
      ? el('div', 'ysin-cell num dim', '—')
      : el('div', 'ysin-cell num', n1(r.weapon)))

    const bench = el('div', 'ysin-cell num', n1(r.bench))
    /* 配平只在双爆之间搬运，只有这两行标原始基准值 */
    if (r.originalBench != null) {
      bench.append(el('span', 'ysin-raw', T('ysinOriginal', { n: n1(r.originalBench) })))
    }
    cells.push(bench)
  }
  const uncounted = el('div', 'ysin-cell wide dim')
  uncounted.append(el('span', '', T('ysinUncounted')), el('span', '', n1(s.uncounted)))
  cells.push(uncounted)
  return cells
}

export { loadYsin }
