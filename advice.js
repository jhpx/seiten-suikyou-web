/*
 * 首页的「刷圣遗物建议」面板 —— 挂在角色列表**下面**（见 roster.js）。
 *
 * 数据全在接口里（view.advice），这里一个数都不算 —— 前端只决定长什么样。
 * 面板回答的是「接下来该刷哪个本」，所以按套装排，不按角色排：
 * 一个套装一张卡，卡里**每人一行**，点一行进那个角色的明细页。
 *
 * 页面里**不分层**：颜色本身就是等级 —— 每件的分数用全站同一套档位色
 * （miao.css 的 .mark-<档位>，明细页、卡片评级也是这套）。分成「D-B / A-S / SS」
 * 三行等于把同一件事说两遍：颜色已经告诉你它有多差，再套一个分组标题反而多了块灰。
 *
 * 少写字：部位用图（素材就在套装图同目录，文件名 1~5 就是部位号），
 * 件数/人数用两个内联小图，于是每行只剩「人名 + 一串部位图带分数」。
 */

import { state, T, el, setBg, slotGlyph, openDetail, reg } from './core.js'

/* 档位从差到好 —— 只用来排序（成色条、行序），颜色仍由 .mark-<档位> 给 */
const CLASS_RANK = { D: 0, C: 1, B: 2, A: 3, S: 4, SS: 5, SSS: 6, ACE: 7, MAX: 8 }

/* 一个套装的全部件，摊平成一份 —— 页面不再分三档，所以也不需要分组了 */
function allPieces (s) {
  return [...s.bad, ...s.mid, ...s.good]
}

/* 两个 12px 的内联图标：件（菱形 = 一件圣遗物）、人。颜色跟 currentColor 走 */
const ICONS = {
  piece: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M8 1.9 14.1 8 8 14.1 1.9 8z"/></svg>',
  owner: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="8" cy="5" r="2.5"/><path d="M3.4 13.8c0-2.6 2-4.4 4.6-4.4s4.6 1.8 4.6 4.4"/></svg>'
}

function icon (name) {
  const i = el('i', 'adv-ico')
  i.innerHTML = ICONS[name] || ''
  return i
}

/* 套装图是「.../imgs/<套装>/1.webp」（1 = 生之花），把末段换成部位号就是该部位的图 */
function slotIcon (setIcon, pos) {
  return setIcon ? setIcon.replace(/[^/]+$/, pos + '.webp') : ''
}

/*
 * 按角色合并成一个人一份：一个套装里同一个人常有 4~5 件，
 * 一件一个 chip 的话名字要重复四遍，件数与人头数也被看花。
 */
function byChar (list) {
  const map = new Map()
  for (const p of list) {
    const key = p.avatarId ?? p.name
    let g = map.get(key)
    if (!g) {
      g = { avatarId: p.avatarId, name: p.name, items: [] }
      map.set(key, g)
    }
    g.items.push(p)
  }
  return [...map.values()]
}

/* 一行 = 一个角色：人名 + 他的若干部「部位图 + 分」。件按部位 1→5 排，
   各行之间对得齐（都是花羽沙杯冠的顺序），看谁的沙烂一眼扫下来就行。
   不带头像：16px 的脸认不出是谁（名字就在左边），只是往整齐的色块里再塞一团噪点。 */
function charLine (g, setIcon) {
  const line = el('button', 'adv-line')
  line.type = 'button'
  line.append(el('span', 'adv-char', g.name))

  for (const p of g.items.sort((a, b) => a.pos - b.pos)) {
    const cell = el('span', 'adv-piece')
    const src = slotIcon(setIcon, p.pos)
    if (src) {
      const pic = el('img', 'ap-icon')
      pic.src = src
      pic.alt = p.posName
      pic.onerror = () => {
        pic.remove()
        cell.prepend(el('span', 'ap-glyph', slotGlyph(p.pos)))
      }
      cell.append(pic)
    } else {
      cell.append(el('span', 'ap-glyph', slotGlyph(p.pos)))
    }
    cell.append(el('b', 'ap-mark mark-' + (p.markClass || 'D'), p.markText))
    line.append(cell)
  }

  line.addEventListener('click', () => openDetail(g.avatarId))
  return line
}

/* 一个人一行。行序 = 这人在这套里最差那件的分（越差越上）。
   不能按档凑行：同一个角色常常横跨两档（花是 SS、冠是 D），按档分会把他拆成两行，
   读起来像两个人 —— 而「谁整身最差」才是排在前面的依据。 */
function charRows (s) {
  const rows = el('div', 'adv-rows')
  const groups = byChar(allPieces(s))
  for (const g of groups) g.worst = Math.min(...g.items.map(p => p.mark))
  groups.sort((a, b) => a.worst - b.worst || a.name.localeCompare(b.name))
  for (const g of groups) rows.append(charLine(g, s.icon))
  return rows
}

/* 成色条：**一件一格**，格子颜色就是那件的档位色，按档位从差到好排。
 * 比「D-B 3 · A-S 6 · SS 6」一行字快：左边一片冷色 = 这套还差得远，
 * 右边泛紫 = 大部分已经毕业。每格定宽，所以**整条的长度就是件数** ——
 * 件多的高一截，一眼比得出谁的池子大（件数右边也写着，条只是让「多」看得见）。 */
function heatBar (s) {
  const bar = el('span', 'adv-bar')
  const list = allPieces(s).sort((a, b) =>
    (CLASS_RANK[a.markClass] ?? 9) - (CLASS_RANK[b.markClass] ?? 9) || a.mark - b.mark)
  for (const p of list) {
    const seg = el('i', 'adv-seg mark-' + (p.markClass || 'D'))
    bar.append(seg)
  }
  return bar
}

/* 人数与件数：图标 + 数字。人数在前 —— 一行从左往右是
   「哪套 → 几个人穿 → 一共几件 → 成色怎样」，先认套装再认量 */
function ownBox (s) {
  const box = el('span', 'adv-own')
  box.append(icon('owner'), el('b', '', String(s.count.owners)))
  box.append(icon('piece'), el('b', '', String(s.count.total)))
  return box
}

/* 一个套装一张卡。**全部默认收起**：这块是「看结论」的地方，不是清单页，
   全展开会拉成两屏；要看得自己点开 —— 手机上一屏能扫完 8 个套装比什么都强 */
function setCard (s) {
  const card = el('details', 'adv-set')

  const head = el('summary', 'adv-head')
  const mark = setBg(el('span', 'adv-icon'), s.icon)

  const main = el('span', 'adv-main')
  const nameRow = el('span', 'adv-name')
  nameRow.append(el('span', 'adv-name-text', s.name))
  if (!s.farmable) {
    nameRow.append(el('span', 'adv-tag', T('adviceUnfarmable')))
  }
  main.append(nameRow)

  /* 一行里四段，从左到右：套装图 | 名字（可省略）| 人数/件数 | 成色条。
     先认是哪套，再看多少人、多少件，最后一条色带扫成色；
     全部靠左排，名字不再撑满整行，尾部留白比两端拉开更好扫。 */
  head.append(mark, main, ownBox(s), heatBar(s))
  card.append(head)

  const body = el('div', 'adv-body')
  body.append(charRows(s))
  card.append(body)
  return card
}

function renderAdvice () {
  const adv = state.view?.advice
  if (!adv) return null

  const box = el('section', 'adv-panel')
  const head = el('div', 'adv-panel-head')
  head.append(
    el('h2', 'adv-panel-title', T('adviceTitle')),
    el('span', 'adv-panel-scope', T('adviceScope', { lv: adv.minLevel }))
  )
  box.append(head)

  if (!adv.sets.length) {
    box.append(el('p', 'adv-empty', T('adviceEmpty')))
    return box
  }

  const list = el('div', 'adv-list')
  adv.sets.forEach(s => list.append(setCard(s)))
  box.append(list)
  return box
}

reg.renderAdvice = renderAdvice
