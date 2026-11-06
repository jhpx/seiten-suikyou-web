/*
 * 明细页：复刻 miao-plugin 的评分结果图（profile-detail）。
 * renderDetail 在加载时注册进 core.reg，由 openDetail / renderAll 调用。
 * 卡片与伤害段拆到 detail-card.js / detail-damage.js，页面适配拆到 detail-fit.js。
 */

import {
  $, state, T, el, setBg, rankOf, backToRoster, richText,
  api, reg, renderAll, uidApiUrl, banner
} from '../../core.js'
import { downloadDetailCard } from './detail-screenshot.js'
import { renderWeaponCard, renderArtiCard } from './detail-card.js'
import { loadDamage } from './detail-damage.js'
import { fitLongText, fitSelectText, fitDetailScale } from './detail-fit.js'

function renderDetail () {
  const box = $('view-detail')
  box.innerHTML = ''

  const av = state.view?.avatars.find(a => a.avatarId === state.selectedAvatarId)
  if (!av) {
    box.append(el('div', 'placeholder', T('noData')))
    return
  }

  /* 顶部返回栏：画布之外不跟着缩放；与下方 600px 卡片同宽，故右缘对齐卡片 */
  const bar = el('div', 'detail-bar')
  const back = el('button', 'btn back', '← ' + T('back'))
  back.addEventListener('click', backToRoster)
  /* 这一行只放返回钮：角色名在下面 600px 画布最顶上写了更大一号，这儿再来一遍是重复，
     灰色小字挨着金色按钮还会分走按钮的分量。 */
  bar.append(back)

  /* 右端一组：模拟比对 + 分享。两个钮要 gap，不能用 space-between 拉到栏的两端。 */
  const actions = el('div', 'detail-actions')

  /* 进模拟比对页：点哪个角色就把哪个角色带过去（reg 反调，避免 detail→sim 直接 import 成环） */
  const simBtn = el('button', 'btn sim-entry', T('simEntry'))
  simBtn.addEventListener('click', () => reg.openSim?.(av.avatarId))
  actions.append(simBtn)

  /* 分享钮：与「返回」同行右端。纯图标，不配任何文字说明。 */
  const share = el('button', 'btn share')
  share.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>'
  share.addEventListener('click', () => onShare(share))
  actions.append(share)

  bar.append(actions)

  box.append(bar)

  /* 600px 画布。元素类名照 miao 的 elemLayout 挂在容器上，CSS 据此选背景图 */
  const canvas = setBg(el('div', 'pd-canvas elem-' + (av.elem || 'hydro')), av.elemBg)
  const cont = el('div', 'profile-cont game-gs')
  const frame = el('div', 'pd-frame')
  canvas.append(cont)
  frame.append(canvas)
  box.append(frame)

  /* ===== .basic ===== */
  const basic = el('div', 'basic')
  basic.append(setBg(el('div', 'main-pic'), av.splash))

  const detail = el('div', 'detail')
  detail.append(el('div', 'char-name', av.name))

  const lvRow = el('div', 'char-lv')
  lvRow.append(el('span', '', `UID ${av.uid} - Lv.${av.level ?? '?'}`))
  lvRow.append(el('span', 'cons-badge', `${av.cons}${T('cons')}`))
  detail.append(lvRow)

  /* 天赋 a/e/q：图标 + 等级牌。talent-plus = 被命座提升过，talent-crown = 原始等级满 10 —— 判定来自后端 */
  const talents = el('div', 'char-talents')
  for (const k of ['a', 'e', 'q']) {
    const t = av.talent?.[k] || {}
    const icon = el('div', 'talent-icon' + (t.plus ? ' talent-plus' : '') + (t.crown ? ' talent-crown' : ''))
    icon.append(setBg(el('div', 'talent-icon-img'), av.imgs?.[k]))
    icon.append(el('strong', '', String(t.level ?? 0)))
    const item = el('div', 'talent-item')
    item.append(icon)
    talents.append(item)
  }
  detail.append(talents)

  /* 面板属性表：图标 + 名称 + 权重胶囊 + 总值 +（基础值 / 绿字） */
  if (av.attrTable?.length) {
    /* attr-tall：面板超过 8 行时给 .basic 加一条 class 撑开底部空间。
       面板的 7 个固定项之外，dmg/phy/heal 是按需出行的，行数在 8~9 之间浮动。9 行时右侧信息列会
       顶进下方评分卡（实测压 1px）。以前用 CSS 的 min-height 解决，那会给只有 8 行的角色凭空多留空白 ——
       改成「按需」：只有真的多出一行时才撑。 */
    const tall = av.attrTable.length > 8 ? ' attr-tall' : ''
    const ul = el('ul', 'char-attr' + tall)
    for (const r of av.attrTable) {
      const li = el('li')
      const ic = el('div', 'icon')
      /* 图标类名默认就是属性 key，只有元素伤害那行会被后端换成具体元素（.i-pyro / .i-cryo …）
         —— 因为图标是一属性一张独立 SVG，没有「通用元素伤害」那张，只有七元素各自的。 */
      ic.append(el('i', 'i-' + (r.iconKey || r.key)))
      li.append(ic, el('div', 'title', r.label))
      const wt = el('div', 'weight')
      /* 权重 0 的项 miao 也留空位，保持列对齐 */
      if (r.weight) wt.append(el('span', r.weight >= 80 ? 'gold' : 'normal', String(r.weight)))
      li.append(wt, el('div', 'value', r.value))
      const v2 = el('div', 'value2')
      v2.append(el('span', 'base' + (r.baseZero ? ' zero' : ''), r.base))
      v2.append(el('span', 'plus', '+' + r.plus))
      li.append(v2)
      ul.append(li)
    }
    detail.append(ul)
  }
  basic.append(detail)

  /* 命座 6 格：未点亮的置灰（.off） */
  const cons = el('div', 'char-cons')
  for (let i = 1; i <= 6; i++) {
    const icon = el('div', 'talent-icon' + (i <= (av.cons ?? 0) ? '' : 'off'))
    icon.append(setBg(el('div', 'talent-icon-img'), av.imgs?.[`cons${i}`]))
    const item = el('div', 'cons-item')
    item.append(icon)
    cons.append(item)
  }
  basic.append(cons)

  const info = el('div', 'data-info')
  /* 明细页报这个角色的上次同步时间（av.fetchedAt），不是整个 UID 的 ——
     展柜分批攒，角色之间能差好几天，报 UID 级会把老角色说成刚抓过。 */
  if (av.fetchedAt) info.append(el('span', 'time', `${T('scoredAt')} ${av.fetchedAt}`))
  basic.append(info)
  cont.append(basic)

  /* ===== .profile-detail ===== */
  const pd = el('div', 'profile-detail')

  /* 圣遗物评分汇总：左总分卡 + 右有效词条 */
  const statBox = el('div', 'arti-stat')
  const ret = el('div', 'arti-stat-ret')
  for (const [label, value, cls] of [
    [T('artisTotal'), av.score.mark, ''],
    /* 档位本身按 miao 的配色上色：红(ACE/MAX) / 黄(SSS/SS) / 紫(S/A) */
    [T('artisRank'), av.score.markClass, 'mark-' + rankOf(av.score.markClass)]
  ]) {
    const d = el('div')
    d.append(el('span', '', label), el('strong', cls, value))
    ret.append(d)
  }
  statBox.append(ret)
  /* 评分规则那条细条：多套规则的角色，把它就地变成规则下拉（复用这一格，不另起大块）；
     单套仍是静态规则名。列表要异步拉，先按静态文案占位，回来再替换。 */
  const titleBar = el('div', 'arti-class-title')
  /* 显示后端拼好的 rubricLabel（当前语言的「角色名-规则名」）；classTitle 是 miao 的中文原文，
     只在后端认不出这条规则时才会等于它 */
  const ruleName = av.score.rubricLabel || av.score.classTitle
  /* 冒号也按语言来（英文半角、中日韩全角），所以整句交给一个键，不在前端拼 */
  if (ruleName) titleBar.textContent = T('ruleLine', { name: ruleName })
  statBox.append(titleBar)
  loadRubric(av, titleBar)

  const infoBox = el('div', 'arti-info')
  const allWrap = el('div', 'arti-all-attr')
  const allUl = el('ul', 'detail attr arti-attr')
  /* 右边网格只取前 9 个；第 10 个走上面的溢出格，不在循环里 */
  for (const a of (av.allAttr || []).slice(0, 9)) {
    if (!a || !a.key) { allUl.append(el('li')); continue }
    const li = el('li', a.cls || 'nouse')
    const title = el('span', 'title')
    if (a.eff && a.eff !== '-') title.append(el('i', 'eff', a.eff))
    title.append(document.createTextNode(a.label))
    li.append(title, el('span', 'val', '+' + a.value))
    allUl.append(li)
  }
  allWrap.append(allUl)
  infoBox.append(allWrap)
  /* 后端文案表里已把上游那句「可使用 #角色名圣遗物 …」QQ 指令提示剪掉，这里不再拼 tag 插值。
     第 10 个副词条（按有效值排最末那条）不进右边 3×3 网格，也不单独占一行 ——
     它拼到「评分为喵喵版规则…」这行的右端：文案占左侧 flex:1，溢出格占右侧 33.33%
     （与上方第 9 个词条的第 3 列同宽、右端对齐），二者同行。右边网格永远只排前 9 个。 */
  const notice = el('div', 'arti-notice')
  const noticeText = el('span', 'notice-text')
  richText(noticeText, T('artisNotice'))
  notice.append(noticeText)
  const overflowAttr = (av.allAttr || [])[9]
  if (overflowAttr && overflowAttr.key) {
    const cell = el('div', 'arti-overflow ' + (overflowAttr.cls || 'nouse'))
    const oTitle = el('span', 'title')
    if (overflowAttr.eff && overflowAttr.eff !== '-') oTitle.append(el('i', 'eff', overflowAttr.eff))
    oTitle.append(document.createTextNode(overflowAttr.label))
    cell.append(oTitle, el('span', 'val', '+' + overflowAttr.value))
    notice.append(cell)
  }
  infoBox.append(notice)

  const markCont = el('div', 'arti-mark-cont')
  markCont.append(statBox, infoBox)
  pd.append(markCont)

  /* 武器卡：图标（右上溢出）+ 名 + 精N·Lv.N + 主副属性 + 精炼描述。
     只要装备了就出这张卡（state 非 'none'）—— 元数据不认识这把时名字/属性/描述都是空的，
     但等级和精炼是 enka 给的真实数据，不该整张卡消失。 */
  const artis = el('div', 'artis')
  if (av.weapon && av.weapon.state !== 'none') artis.append(renderWeaponCard(av.weapon))
  for (const a of av.artifacts) artis.append(renderArtiCard(a, av.charWeight))
  pd.append(artis)

  cont.append(pd)

  /* 伤害计算（miao 明细页下侧的「伤害计算」表）：先放一个 loading 骨架占位，数据到了再填 ——
     renderDetail 是同步的（reg 契约），而伤害要跑一遍评分内核。 */
  const dmgBox = el('div', 'dmg-wrap')
  cont.append(dmgBox)
  loadDamage(av, dmgBox)

  /* 这行报数据时间，不再抄一遍评级/规则名（那两块在 .arti-stat / .arti-class-title 里） */
  cont.append(el('div', 'pd-scored-at', `${T('scoredAt')} ${av.fetchedAt || '—'}`))

  fitLongText()
  fitDetailScale()
  /* 字体/图片回流可能改高度，下一帧再算一次兜底 */
  requestAnimationFrame(fitDetailScale)
}

/*
 * 评分规则下拉 —— 用户觉得评分不合自己理解时，换成 miao 给这个角色内置的另一套规则。
 * 选中后覆盖主评分并落库（后端），所以走「重拉整包视图」：评分/档位/逐件分/首页卡片一起更新。
 *
 * 复用「评分规则」那条小细条（.arti-class-title，185px × 25px）：就地换成「评分规则」标签 + 下拉，
 * 不再另起一块大条（用户嫌大）。自动模式下，下拉选项直接写成「自动：<匹配到的规则名>」。
 * 单套规则不换 —— 选不选一样，静态「评分规则：X-通用」已经够。
 * renderDetail 是同步的（reg 契约），列表得异步拉；回来前可能已切走或页面已重画，
 * 填之前核对还在同一角色、且这一格还挂在文档上。
 */
async function loadRubric (av, bar) {
  let data
  try {
    /* locale 必须带上：规则名（角色名+规则名）是后端按语言拼的，漏了就一直拿默认语言（中文） */
    data = await api(`accounts/${av.uid}/characters/${av.avatarId}/rubrics?locale=${encodeURIComponent(state.locale)}`)
  } catch (e) {
    /* 拉不到就维持静态规则名，评分照旧 —— 附加能力不该拖累主流程 */
    console.error('[rubric] 拉规则列表失败:', e)
    return
  }
  if (state.selectedAvatarId !== av.avatarId || !bar.isConnected) return
  if (!data.rubrics || data.rubrics.length <= 1) return

  bar.classList.add('has-select')
  bar.textContent = ''
  /* 明示「评分规则」标签（复用 rule 键），后面跟下拉 */
  const label = el('span', 'arti-rubric-label', T('rule'))
  const sel = el('select', 'arti-rubric-select')
  sel.setAttribute('aria-label', T('rule'))
  /* 当前是「自动」时，把匹配到的规则名直接写进选项文案，一眼看出自动匹配到哪条 */
  const autoText = data.current == null
    ? T('rubricAutoMatch', { name: av.score.rubricLabel || av.score.classTitle || '—' })
    : T('rubricAuto')
  const auto = el('option', '', autoText)
  auto.value = ''
  sel.append(auto)
  for (const s of data.rubrics) {
    /* 显示用「角色名-规则名」全名（和自动 / classTitle 同形），提交仍用裸 name */
    const o = el('option', '', s.label || s.name)
    o.value = s.name
    sel.append(o)
  }
  sel.value = data.current ?? ''
  bar.append(label, sel)
  /* 细条只有 185px（左边还要放「评分规则」标签），各语言里日文最长 ——
     差十来个像素就被原生 select 从半个字切开（原生 select 不打省略号）。量一下再定字号。 */
  fitSelectText(sel)

  /* 失败回滚到「页面渲染时生效的那个」—— 成功后整页重画，这个闭包随之作废，只有失败路径用得上 */
  const confirmed = data.current ?? ''
  sel.addEventListener('change', async () => {
    const next = sel.value || null
    sel.disabled = true
    try {
      await api(`accounts/${av.uid}/characters/${av.avatarId}/rubric`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rubric: next })
      })
      /* 选完重拉整包视图：评分、档位、逐件分数、首页卡片全变 —— 复用切语言那条路。
         不切视图（还在明细页），renderAll 只重画不跳转 */
      state.view = await api(uidApiUrl(av.uid))
      renderAll()
    } catch (e) {
      banner(e.message, 'err')
      sel.value = confirmed
      sel.disabled = false
    }
  })
}

/* 分享：截整张卡并下载；生成期间由 detail-screenshot.js 盖一层转圈蒙版，失败要在页面上说一声 */
async function onShare (btn) {
  if (btn.disabled) return
  btn.disabled = true
  try {
    /* downloadDetailCard 返回 false = 没画布 / 没生成出图，同样算失败 */
    const ok = await downloadDetailCard()
    if (!ok) banner(T('shareFail'), 'err')
  } catch (e) {
    /* ⚠️ 别只 console.error：失败时页面上一点动静都没有，用户只会觉得「按钮坏了」。
       吃过一次亏 —— 线上托管把 vendor 里那个 .mjs 当 application/octet-stream 返回，
       浏览器对模块脚本卡死 MIME 校验，import 直接抛，界面全然无声。 */
    console.error('[share] 截图失败:', e)
    banner(T('shareFail'), 'err')
  } finally {
    btn.disabled = false
  }
}

reg.renderDetail = renderDetail
