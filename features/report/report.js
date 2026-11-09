/*
 * 评定报告单：把当前账号的评分榜排成一张「纸面评定报告单」，首页一点直接导出成图片。
 *
 * 为什么要这个功能：报告单这种形式天然适合发社交平台（一张图讲清「我号里谁最强」），
 * 但它必须**是网站上真能点出来的东西**，否则就是虚假宣传。所以这里的报告单和宣传海报
 * 用同一套版式逻辑 —— 海报不是画出来的效果图，是这张单子的截图。
 *
 * 数据全部来自 state.view（后端算好的评分结果），前端一个分都不算，只决定长什么样。
 * 排序用 sortAvatars —— 和首页同一套排序口径，用户在首页排好的顺序这里照旧。
 *
 * 这个文件只管「单子长什么样」：渲染出一个 .rp-sheet 节点就收工，不碰下载。
 * 怎么把它变成 PNG、怎么下载，在 report-shot.js（那边反过来 import 本文件）。
 *
 * 依赖方向：report.js → core.js + roster/sort.js（复用排序），不反向依赖任何页面模块。
 */

import { T, el, rankOf, imgError, regionOfUid } from '../../core.js'
import { sortAvatars } from '../roster/sort.js'

/* 报告单列几个角色。10 个够看出「谁强谁弱」的形状，又不至于把报告单撑到两页。 */
const TOP_N = 10

/* 元素配色：和全站元素色一致（web/css 里的 --elem-* 同色系），
   报告单是纸质底，标签做成实色块才压得住纸。 */
const ELEM_COLOR = {
  '火': '#f2854f', '水': '#4d9be0', '冰': '#6fc3e8', '雷': '#a878e0',
  '风': '#5fc2a5', '岩': '#cfa95e', '草': '#93bd3e'
}

/* 档位徽章的样式类：和首页卡片、明细页共用同一套 .mark-* 配色 */
function gradeClass (cls) {
  return 'mark-' + rankOf(cls)
}

/* 报告单顶部：标题 + 右上角的 ACE 印章（页脚不另放落款） */
function renderHead (acct) {
  const head = el('div', 'rp-head')

  const left = el('div')
  left.append(el('h2', 'rp-title', T('reportTitle')))
  left.append(el('div', 'rp-sub', T('reportSubtitle')))

  /* 印章：右上角一枚，斜盖。它不压任何数据（表格在它下面另起一块），
     只是让整张单子看着像一份「盖过章的评定件」而不是网页截图。 */
  const stamp = el('div', 'rp-stamp')
  stamp.append(el('div', 'rp-stamp-big', 'ACE'))
  const mid = el('div', 'rp-stamp-mid')
  for (const line of T('reportStamp').split('\n')) mid.append(el('span', '', line))
  stamp.append(mid)
  stamp.append(el('div', 'rp-stamp-tick', T('title')))

  head.append(left, stamp)
  return head
}

/* 账号信息条：等级 / 世界等级 / 评定角色数 / 日期 / 区服。
   ⚠️ 最后一项是「这个号在哪个服」，从 UID 首位读出来（regionOfUid）。
   别写成「本站支持几个服」再铺一排区服代号 —— 看单子的人只关心自己这个号属于哪。 */
function renderMeta (acct, count, date) {
  const bar = el('div', 'rp-meta')
  const items = [
    [T('level'), acct?.level],
    [T('worldLevel'), acct?.worldLevel],
    [T('reportChar'), count],
    [T('reportDate'), date],
    [T('reportRegion'), regionOfUid(acct?.uid)]
  ]
  for (const [label, value] of items) {
    const d = el('div', 'rp-meta-item')
    d.append(el('b', '', value ?? '—'))
    if (label) d.append(el('span', '', label))
    bar.append(d)
  }
  return bar
}

/* 一行：一个角色。头像 + 名字 + 武器 + 元素 + 等级 + 总分 */
function renderRow (av, no) {
  const row = el('div', 'rp-row')

  row.append(el('div', 'rp-no', String(no)))

  const who = el('div', 'rp-who')
  const face = el('img', 'rp-face')
  face.src = av.imgs?.face || av.splash
  face.alt = ''
  face.onerror = () => imgError(face)
  const txt = el('div', 'rp-who-txt')
  txt.append(el('div', 'rp-nm', av.nameZh || av.name || '—'))
  /* 武器名 + 角色等级：接口给的是本地化名字，前端不拼业务文本 */
  const wname = av.weapon?.name || ''
  txt.append(el('div', 'rp-wp', wname ? `${wname} · Lv.${av.level ?? '?'}` : `Lv.${av.level ?? '?'}`))
  who.append(face, txt)

  const elem = el('div', 'rp-elem', av.elemText || '')
  elem.style.background = ELEM_COLOR[av.elemText] || '#8a8578'

  row.append(who, elem)

  /* 等级和总分各占一列、各有各的表头；早先挤在一格写「等级 / 总分」，
     读者得自己把徽章和数字对上号，窄了还会挤掉数字。 */
  const gradeCell = el('div', 'rp-grade-cell')
  gradeCell.append(el('span', 'rp-grade ' + gradeClass(av.score.markClass), rankOf(av.score.markClass)))
  row.append(gradeCell, el('div', 'rp-score', av.score.mark))
  return row
}

/* 整张报告单。渲染成一个 detached 节点 —— 往哪儿挂、什么时候摘，由调用方决定。 */
export function renderSheet (view) {
  const acct = view.account
  /* 报告单和首页共用排序口径：sortAvatars 读的是 state.sort，用户在首页排过的顺序这里照旧 */
  const list = sortAvatars(view.avatars || []).slice(0, TOP_N)

  const sheet = el('div', 'rp-sheet')

  sheet.append(renderHead(acct))

  /* 账号昵称 + UID 单独一行：这是报告单上「谁的成绩单」的那一行 */
  const who = el('div', 'rp-owner')
  who.append(el('span', 'rp-owner-name', acct?.nickname || `UID ${acct?.uid ?? ''}`))
  who.append(el('span', 'rp-owner-uid', `UID ${acct?.uid ?? '—'}`))
  sheet.append(who)

  sheet.append(renderMeta(acct, view.avatars?.length ?? 0, view.fetchedAt?.slice(0, 10)))

  /* 表头五列，和数据行的栅格一一对应。
     评级 / 评分两列直接用明细页那对键（artisRank / artisTotal）—— 这里摆的就是
     同一份 av.score.markClass / av.score.mark，别另造一套叫法；元素列同理用 filterElem。 */
  const head = el('div', 'rp-row rp-row-head')
  head.append(el('div', 'rp-no', T('reportRank')))
  head.append(el('div', '', T('reportChar')))
  head.append(el('div', 'rp-elem', T('filterElem')))
  head.append(el('div', 'rp-th-grade', T('artisRank')))
  head.append(el('div', 'rp-th-score', T('artisTotal')))
  sheet.append(head)

  for (const [i, av] of list.entries()) sheet.append(renderRow(av, i + 1))

  /* 页脚：评分依据 + 免责说明，两行小字 */
  const foot = el('div', 'rp-foot')
  foot.append(el('span', '', T('reportNote')))
  foot.append(el('span', 'rp-note-sub', T('reportNoteSub')))
  sheet.append(foot)

  return sheet
}
