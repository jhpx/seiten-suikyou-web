/*
 * 首页的「刷圣遗物建议」面板 —— 挂在角色列表**下面**（见 roster.js）。
 *
 * 数据全在接口里（view.advice），这里一个数都不算 —— 前端只决定长什么样。
 * 面板回答的是「接下来该刷哪个本」，所以按套装排，不按角色排：
 * 一个套装一张卡，卡里**每人一行**，点一行进那个角色的明细页。
 *
 * 行里只画**属于这张卡的件**，缺的部位留空占着列 —— 于是各行的花永远落在同一列，
 * 竖着扫下来像一张表，「这套里谁的沙最烂」一眼比得出。
 *
 * 页面里**不分层**：颜色本身就是等级 —— 每件的分数用全站同一套档位色
 * （miao.css 的 .mark-<档位>，明细页、卡片评级也是这套）。分成「D-B / A-S / SS」
 * 三行等于把同一件事说两遍：颜色已经告诉你它有多差，再套一个分组标题反而多了块灰。
 *
 * 少写字：部位用图（素材就在套装图同目录，文件名 1~5 就是部位号），
 * 件数/人数用两个内联小图，于是每行只剩「人名 + 一串部位图带分数」。
 */

import { state, T, el, setBg, slotGlyph, openDetail, closeMenus, reg } from './core.js'

/* 口径开关：SS 件算不算。默认**不算** —— SS 已经接近毕业，算进去只会把「还差多少」摊薄。
   接口一次给了两份（advice / advice.withSS），所以切换只是换一份数据重画，不走网络。 */
let includeSS = false

/* 排序口径，默认「综合权衡」。四种名次都是接口算好的（adv.orders），
   这里只负责换一条序列重画 —— 比较逻辑一行都不在前端。 */
let sortKey = 'balance'

/* 下拉框里的顺序（从「最常想看的」往下排）。改顺序就动这一行，别去动标签表的键序 */
const SORTS = ['balance', 'owners', 'junk', 'boost']
const SORT_LABEL = {
  balance: 'adviceSortBalance',
  junk: 'adviceSortJunk',
  owners: 'adviceSortOwners',
  boost: 'adviceSortBoost'
}

/* 档位从差到好 —— 只用来排序（成色条、行序），颜色仍由 .mark-<档位> 给 */
const CLASS_RANK = { D: 0, C: 1, B: 2, A: 3, S: 4, SS: 5, SSS: 6, ACE: 7, MAX: 8 }

/* 一个套装的全部件，摊平成一份 —— 页面不再分三档，所以也不需要分组了 */
function allPieces (s) {
  return [...s.bad, ...s.mid, ...s.good]
}

/* 两个 11px 的内联图标：件（菱形 = 一件圣遗物）、人。颜色跟 currentColor 走 */
const ICONS = {
  piece: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M8 1.9 14.1 8 8 14.1 1.9 8z"/></svg>',
  owner: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="8" cy="5" r="2.5"/><path d="M3.4 13.8c0-2.6 2-4.4 4.6-4.4s4.6 1.8 4.6 4.4"/></svg>'
}

function icon (name) {
  const i = el('i', 'adv-ico')
  i.innerHTML = ICONS[name] || ''
  return i
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

/* 五个部位 = 五列，编号固定：1 花 2 羽 3 沙 4 杯 5 冠 */
const POSITIONS = [1, 2, 3, 4, 5]

/* 套装图是「.../imgs/<套装>/1.webp」（1 = 生之花），把末段换成部位号就是该部位的图 */
function slotIcon (setIcon, pos) {
  return setIcon ? setIcon.replace(/[^/]+$/, pos + '.webp') : ''
}

/* 一件 = 一个「部位图 + 分」的小标签。
   拼凑件（`missing`）同样走这里：部位图 + `---`，没有分数也没有词条角标 ——
   它表示「这套缺这个部位」，不是一件真实装备。 */
function pieceChip (p, setIcon) {
  const cell = el('span', 'adv-piece' + (p.missing ? ' is-missing' : ''))
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
  /* 初始 3 / 4 词条：角标压在部位图角上（不占宽度 —— 一行五件再加五个数字会换行）。
     认不出词条数（null）就不画，别拿 0 或问号凑一个。 */
  if (p.initSubs === 3 || p.initSubs === 4) {
    cell.append(el('i', 'ap-init', String(p.initSubs)))
  }
  cell.append(el('b', 'ap-mark mark-' + (p.markClass || 'D'), p.markText))
  return cell
}

/* 一行 = 一个角色：人名 + **五个固定槽位**（花羽沙杯冠）。
   缺的那件也占着列 —— 各行的花永远落在同一列，扫下来像一张表，
   而不是「有几件画几件」那样每行各自挤成一堆、对不齐。
   不带头像：格子这么小一张脸认不出是谁（名字就在左边），只是往整齐的色块里再塞一团噪点。 */
function charLine (g, setIcon) {
  const line = el('button', 'adv-line')
  line.type = 'button'
  line.append(el('span', 'adv-char', g.name))

  const byPos = new Map()
  const extra = []
  for (const p of g.items) {
    /* 同一个人同一个部位只有一件。真碰上重复或越界（脏数据）就顺序补在五列后面，
       宁可多画一格也别把数据咽下去 */
    if (POSITIONS.includes(p.pos) && !byPos.has(p.pos)) byPos.set(p.pos, p)
    else extra.push(p)
  }
  /* 这一行画几个框：卡片里这几件算（能进统计就说明凑够 2 件），
     另外「他身上另一套凑够 2 件」占的格子由接口给（`framePos`）。
     散件（那套只在他身上 1 件，吃不到套装效果）不画框 ——
     于是 4+1 和 2+2+1 都是四个框 + 一个散件空位。 */
  const framed = new Set(g.items[0]?.framePos || [])
  for (const pos of POSITIONS) {
    const p = byPos.get(pos)
    line.append(p ? pieceChip(p, setIcon)
      : el('span', 'adv-blank' + (framed.has(pos) ? ' is-frame' : '')))
  }
  for (const p of extra) line.append(pieceChip(p, setIcon))

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
 * 件多的高一截，一眼比得出谁的池子大（件数右边也写着，条只是让「多」看得见）。
 *
 * ⚠️ 条的总宽**必须在这里乘出来**写进 `--adv-w`，不能交给 CSS 的 `max-content`：
 * 「flex item 上挂 max-content + max-width 百分比」这套，Firefox 和 Chrome 算出来
 * 的宽度不一样（同一份数据，条的长度一长一短）。件数是 JS 已知的，乘出来是算术题，
 * 各浏览器结果必然一致。`--adv-seg` 仍由 CSS 的媒体查询按屏宽给，宽度也跟着变。 */
function heatBar (s) {
  const bar = el('span', 'adv-bar')
  const list = allPieces(s).sort((a, b) =>
    (CLASS_RANK[a.markClass] ?? 9) - (CLASS_RANK[b.markClass] ?? 9) || a.mark - b.mark)
  /* 条宽 = n×格宽 + (n-1)×间隙。间隙要和 style.css 的 --adv-gap 一致（两边同源），
     否则算出来的宽度和实际格子跨度差几像素、右边被裁掉一丝。
     0 件时给 0px —— calc 里 (0-1)×1px 是负宽，不合法。 */
  const n = list.length
  const g = 'var(--adv-gap)'
  bar.style.setProperty('--adv-w',
    n ? `calc(${n} * var(--adv-seg) + ${n - 1} * ${g})` : '0px')
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

/* 一个套装一张卡。**全部默认收起** */
function setCard (s, rank) {
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

  /* 一行里五段，从左到右：名次 | 套装图 | 名字| 人数| 件数 | 成色条。
     先认第几，再认是哪套，再看多少人、多少件，最后一条色带扫成色。 */
  head.append(el('span', 'adv-rank', String(rank)), mark, main, ownBox(s), heatBar(s))
  card.append(head)

  const body = el('div', 'adv-body')
  body.append(charRows(s))
  card.append(body)
  return card
}

/* 当前口径下的那份数据：不含 SS 是主份（默认），含 SS 的挂在它下面的 withSS */
function adviceData () {
  const adv = state.view?.advice
  if (!adv) return null
  return includeSS ? adv.withSS : adv
}

/* 按当前排序取套装：`orders[排序]` 是接口算好并截断过的名字序列，
   到全量 `sets` 里逐个取对象即可。名字对不上（接口改了名）就跳过，不画半个卡。 */
function setsOf (adv) {
  const seq = adv.orders && adv.orders[sortKey]
  if (!seq) return adv.sets || []
  const byName = new Map((adv.sets || []).map(s => [s.nameZh, s]))
  return seq.map(n => byName.get(n)).filter(Boolean)
}

/* 换口径只重画面板本身，不走 renderRoster：网格、筛选条、滚动位置都别动。
   套装卡会重建（默认全收起），所以点开关之后看到的就是新的一份排名。 */
function repaintPanel () {
  const old = document.querySelector('.adv-panel')
  const next = renderAdvice()
  if (old && next) old.replaceWith(next)
}

/* 口径开关。文字直接写「含 / 不含 SS 件」，不靠颜色猜状态 ——
   手机上没 hover，一点下去就该知道自己切到了哪边。 */
function scopeToggle () {
  const btn = el('button', 'adv-toggle' + (includeSS ? ' on' : ''),
    T(includeSS ? 'adviceSSOn' : 'adviceSSOff'))
  btn.type = 'button'
  btn.addEventListener('click', () => {
    includeSS = !includeSS
    repaintPanel()
  })
  return btn
}

/* 排序做成下拉：这里照人物筛选条那套自绘（`.rf-dd` + `.rf-menu` + `.rf-opt`）：点面板外面、按 Esc、
   选完一项都会走 core.js 的 closeMenus —— 它认的就是 `.rf-dd`，所以容器必须挂这个类。*/
function sortSelect () {
  const dd = el('div', 'rf-dd rf-dd-end adv-sortdd')
  const btn = el('button', 'adv-sortfield')
  btn.type = 'button'
  btn.append(
    el('span', 'adv-sortfield-key', T('sortBy')),
    el('span', 'adv-sortfield-val', T(SORT_LABEL[sortKey])),
    el('span', 'adv-sortfield-caret', '▼')
  )

  const menu = el('div', 'rf-menu adv-menu')
  for (const k of SORTS) {
    const opt = el('button', 'rf-opt' + (k === sortKey ? ' active' : ''), T(SORT_LABEL[k]))
    opt.type = 'button'
    opt.addEventListener('click', () => {
      /* 先收面板再重画：repaintPanel 会把整块 .adv-panel 换掉，旧节点连同开着的菜单一起没了 */
      closeMenus()
      if (k === sortKey) return
      sortKey = k
      repaintPanel()
    })
    menu.append(opt)
  }

  /* 再点一次就收起来（开关式）。closeMenus 先清掉别的面板，免得两个同时开着 */
  btn.addEventListener('click', () => {
    const isOpen = dd.classList.contains('open')
    closeMenus()
    if (!isOpen) dd.classList.add('open')
  })
  dd.append(btn, menu)
  return dd
}

function renderAdvice () {
  const adv = adviceData()
  if (!adv) return null

  const box = el('section', 'adv-panel')
  const head = el('div', 'adv-panel-head')
  const top = el('div', 'adv-panel-top')
  /* 右边两个控件包一层：标题靠左、这俩一起靠右。*/
  const tools = el('div', 'adv-panel-tools')
  tools.append(sortSelect(), scopeToggle())
  top.append(el('h2', 'adv-panel-title', T('adviceTitle')), tools)
  /* 「及以下」那个档位字母跟着开关走：算 SS 就是 SS 及以下，不算就是 S 及以下 */
  head.append(top, el('span', 'adv-panel-scope',
    T('adviceScope', { lv: adv.minLevel, cls: includeSS ? 'SS' : 'S' })))
  box.append(head)

  const sets = setsOf(adv)
  if (!sets.length) {
    box.append(el('p', 'adv-empty', T('adviceEmpty')))
    return box
  }

  const list = el('div', 'adv-list')
  /* 序号 = 当前排序下的名次（接口已按该排序截断，这里只是按序画） */
  sets.forEach((s, i) => list.append(setCard(s, i + 1)))
  box.append(list)
  return box
}

reg.renderAdvice = renderAdvice
