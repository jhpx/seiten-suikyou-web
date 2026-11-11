/*
 * 明细页的 YSIN 独立评分板块：夹在装备卡与伤害计算之间。
 *
 * 与 miao 那套完全分开：不换算分数、不共用评级与档位色。视觉规格见
 * docs/wireframe/05-ysin.html —— 左 185px 两个分数加三行汇总，右侧四列词条对照
 * 与同一技能的三个伤害读数，右下只写规则归属与「仅供参考与娱乐」。
 *
 * 后端一次返回这个角色的全部流派，切流派只重画数字、不再发请求；
 * 标题条的「评估对象」必须跟着流派一起换，不能写成静态文案。
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

/* loading / 失败 / 无数据三种「只有一行字」的状态共用一个外壳，仍然带标题条 */
function ysinStatus (text, err = false) {
  const card = el('div', 'ysin-card')
  const head = el('div', 'ysin-head')
  head.append(el('div', 'ysin-title', T('ysinSection')))
  card.append(head, el('div', 'ysin-status' + (err ? ' err' : ''), text))
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
  const card = el('div', 'ysin-card')

  const head = el('div', 'ysin-head')
  head.append(el('div', 'ysin-title', T('ysinSection')))
  const object = el('div', 'ysin-object')
  head.append(object)
  card.append(head)

  const body = el('div', 'ysin-body')

  /* ── 左卡 ── */
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

  const schoolRow = el('div', 'ysin-school')
  schoolRow.append(el('span', '', T('ysinSchool')))
  const sel = el('select')
  sel.setAttribute('aria-label', T('ysinSchool'))
  for (const s of view.schools) {
    const o = el('option', '', s.name)
    o.value = s.id
    sel.append(o)
  }
  schoolRow.append(sel)
  left.append(schoolRow)

  /* 底部细条：默认整套到底是什么装备，来自网站，跟着流派换 */
  const foot = el('div', 'ysin-foot')
  left.append(foot)

  /* ── 右卡 ── */
  const right = el('div', 'ysin-right')
  const grid = el('div', 'ysin-grid')
  right.append(grid)
  right.append(el('div', 'ysin-hint', T('ysinDmgHint')))

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

  /* 右下只说规则归属与娱乐用途，不写公式 —— 这套规则是闭源的 */
  const notice = el('div', 'ysin-notice')
  richText(notice, T('ysinNotice'))
  right.append(notice)

  body.append(left, right)
  card.append(body)

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
    /* 细条只有 185px，不加「默认整套」前缀（右卡那一格已经写了标签），不然必被截断 */
    foot.textContent = [s.wText, s.aText].filter(Boolean).join(' · ')

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
