/*
 * 前端共享基座（core）—— 原生 ES 模块，无框架、无构建。
 *
 * 和后端的分工：后端负责「算什么、叫什么」，前端只负责「长什么样」——
 * 所以这里一个词条名都不写死，部位名/词条名/套装名全是后端按 locale 给好的文本。
 *
 * 本文件只放：全局状态 state、取文案 T()、DOM 小工具（el/setBg/rankOf…）、
 * 后端调用 api、视图切换（showView/backToRoster）、几个「跨模块编排函数」
 * （refreshRosterGrid/renderAll/openDetail/applyView）。编排函数通过 reg 注册表
 * 调用各 feature 模块注册进来的渲染器 —— 这样 core 不依赖任何 feature，零循环依赖。
 *
 * 原先挂在这里的两块界面逻辑已按职责搬走，代码原样、只是换了住处：
 *   弹窗 / 下拉壳与顶层监听 → features/dialog.js
 *   首页筛选的候选计算     → features/roster/filter-options.js
 * core 现在不碰任何 DOM 界面壳，也不管「这一组筛选项有哪些值」。
 */

/* 接口根地址从哪儿来：**有 env.js 就用它的，没有就同源 /api**。
 *
 * 为什么是动态 import 而不是文件顶上一句 `import { API_BASE } from './env.js'`：
 * 静态 import 一个不存在的文件，浏览器会直接判整个 core.js 加载失败（404 打断模块图，页面全白），
 * 连"退回默认值"的机会都没有。动态 import 失败是可以 catch 的，所以能做成可选配置。
 *
 * 为什么在顶层 await：下面 core 里所有拼地址的地方（还有别的模块）都直接用 API，
 * 地址得在模块求值期间就定死。代价是首屏等一个 env.js 的请求 —— 本地就几百字节。 */
let API_BASE = ''
try {
  ({ API_BASE } = await import('./env.js'))
} catch (e) {
  /* 文件不存在时浏览器抛的是 TypeError（Failed to fetch dynamically imported module），静默退回同源即可；
     其它错误（env.js 里语法写错、导出名不对）是真配错了，别悄悄吞掉，留一条提示方便排查。 */
  if (!(e instanceof TypeError)) console.warn('[env.js] 加载出错，已退回同源 /api：', e)
}

/* API_BASE 是接口根地址，这里规整成「末尾带一个 /」；各接口路径用不带头斜杠的相对形式，
   例如 API + 'accounts/123' → 'https://x.com/api/accounts/123'。 */
export const API = (API_BASE || '/api').replace(/\/+$/, '') + '/'

export const $ = (id) => document.getElementById(id)

/* 原神 UID 合法校验：9 位（首位 1–9）或 10 位（仅 18 开头）。规则与后端 src/common/util.ts 保持一致。 */
export const UID_RE = /^(?:[1-9]\d{8}|18\d{8})$/
export const isValidUid = (v) => UID_RE.test(String(v ?? '').trim())

/*
 * UID 首位就是区服。口径抄后端 src/common/util.ts 的注释（那边已用 Enka 响应的 region
 * 字段实测核对：1/2→CN、6→NA、7→EU、8→ASIA、9→TW；5 开头是国服渠道服）。
 * 10 位的 18 开头是亚服 4.4 之后的新号段，和 9 位的 8 同为亚服。
 *
 * 返回的是顶栏区服胶囊用的那套代号（china / usa / euro / asia / cht / bilibili）：
 * 它是专有代号，五语言界面都照原样显示，不用再翻译一遍。认不出来返回 null，
 * 报告单上宁可留个「—」，也别猜一个区服写上去。
 */
const UID_REGION = { 1: 'china', 2: 'china', 5: 'bilibili', 6: 'usa', 7: 'euro', 8: 'asia', 9: 'cht' }
export function regionOfUid (uid) {
  const s = String(uid ?? '')
  if (s.startsWith('18')) return 'asia'
  return UID_REGION[s[0]] ?? null
}

/* 根据浏览器语言推断默认 locale：只在「URL 没带 ?locale=、localStorage 也没存过」时才用。
 * 别名表跟后端 src/common/names.ts 的 ALIASES 对齐（zh-cn→chs、zh-tw/zh-hk→cht、jp→ja、kr→ko）。
 * 认不出的语言退回 chs，后面 bootstrap 还会用 /api/meta 的 locales 再校验一遍。 */
export function detectLocale () {
  const nav = (navigator.language || navigator.languages?.[0] || '').toLowerCase()
  if (!nav) return 'chs'
  const ALIASES = {
    zh: 'chs', 'zh-cn': 'chs', 'zh-hans': 'chs', cn: 'chs',
    'zh-tw': 'cht', 'zh-hk': 'cht', 'zh-hant': 'cht', tw: 'cht',
    jp: 'ja', kr: 'ko'
  }
  if (ALIASES[nav]) return ALIASES[nav]
  const main = nav.split('-')[0]
  if (main === 'zh') return 'chs'                 // 没带地区的 zh 默认按简体
  if (['chs', 'cht', 'en', 'ja', 'ko'].includes(main)) return main
  return 'chs'
}

/* 页面自己所在的目录（末尾带 /）。切语言、进明细页改写地址栏时用它拼 ——
   写根绝对路径（/?uid=…）在 Pages 那种 /<repo>/ 子路径部署下会被打回域名根，刷新即 404。 */
export const PAGE_BASE = new URL('.', document.baseURI).href

export const RANK_ORDER = ['MAX', 'ACE', 'SSS', 'SS', 'S', 'A', 'B', 'C', 'D']

/* 武器副属性在卡片上的短名，照抄 miao 模板里的 titleMap（profile-detail.html:233） */
export const state = {
  locale: 'chs',
  uid: null,
  view: null,
  /* 刚查过、但库里没有数据的 uid。首页据此把占位文案从「还没查过」换成「点刷新抓取」；
     查到数据或换成别的错误时清空。 */
  missingUid: null,
  selectedAvatarId: null,
  busy: false,
  ui: {},
  /* 首页「按属性权重筛选」的选项（{ key, label }），随语言从 /api/meta 拿 —— 前端不写死词条名 */
  weightOptions: [],
  /* 首页筛选：elem / rank / weight 各是一个数组 —— 每个维度都能多选
     （维度内 OR、维度间 AND：选了火+水又选 SSS，出的是「火或水里的 SSS」）。
     空数组 = 不限。
     空数组 = 不限。不持久化 —— 筛选是「在这份名单里找人」的临时动作。 */
  filter: { elem: [], rank: [], weight: [], set: [], star: [] },
  /* 首页卡片显示模式：weapon = 武器块（默认）/ artis = 圣遗物套装块 */
  rosterMode: 'weapon',
  /* 首页排序：key = level(角色等级) / mark(评价等级) / time(数据时间)；dir = asc|desc。
     默认按评价等级降序，和改之前「网格按评分从高到低」的表现一致。 */
  sort: [{ key: 'mark', dir: 'desc' }]
}

export const T = (key, vars) => {
  let s = state.ui[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ''))
  return s
}

/*
 * 把文案里的 <strong> 段渲染成高亮（两个评分板块内容末尾的免责句都带这个标记，颜色跟全页暖金）。
 * 只认这一种标签、且手工拼节点 —— 不走 innerHTML，省得给文案开注入的口子。
 */
export function richText (parent, text) {
  let last = 0
  for (const m of text.matchAll(/<strong>([\s\S]*?)<\/strong>/g)) {
    if (m.index > last) parent.append(document.createTextNode(text.slice(last, m.index)))
    parent.append(el('strong', '', m[1]))
    last = m.index + m[0].length
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)))
  return parent
}

/* ───────────────────────── 后端调用 ───────────────────────── */

/* 接口路径统一在这里拼上 API（末尾带 / 的根地址）；带协议 / // 的绝对网址不补前缀。 */
const isAbsoluteUrl = (p) => /^(https?:)?\/\//.test(p)

export async function api (path, opts) {
  const res = await fetch(isAbsoluteUrl(path) ? path : API + path, opts)
  let body = null
  try { body = await res.json() } catch {}
  if (!res.ok || (body && body.ok === false)) {
    const err = new Error(body?.error?.message || `HTTP ${res.status}`)
    if (body?.error?.code) err.code = body.error.code
    throw err
  }
  return body.data
}

/* 按当前语言取某个账号的接口地址（locale 一律跟 state.locale 走）。
   返回不带头斜杠的相对路径，前缀由 api() 统一拼 —— 别在这里写 /api，那段在 API_BASE 里。 */
export function uidApiUrl (uid) {
  return `accounts/${uid}?locale=${encodeURIComponent(state.locale)}`
}

/* ───────────────────────── 提示条 ───────────────────────── */

let bannerTimer = null
export function banner (text, kind = '') {
  const el = $('banner')
  if (!text) { el.hidden = true; return }
  el.textContent = text
  el.className = 'banner' + (kind ? ' ' + kind : '')
  el.hidden = false
  clearTimeout(bannerTimer)
  if (kind !== 'err') bannerTimer = setTimeout(() => { el.hidden = true }, 4000)
}

/* ───────────────────────── 渲染工具 ───────────────────────── */

export function el (tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

/* 给元素铺一张背景图（没有图就不铺，让 CSS 的占位露出来） */
export function setBg (node, url) {
  if (url) node.style.backgroundImage = `url("${url}")`
  return node
}

export function rankOf (cls) {
  return RANK_ORDER.includes(cls) ? cls : 'D'
}

/*
 * 名字拿不到时用什么词，看后端给的 weapon.state：
 *   'none'    角色真没装备武器        → 「无武器」
 *   'unknown' 装备了但元数据不认识这把 → 「未知武器」
 * 只负责兜底，名字本身仍由调用点给（首页用全名、明细页 sName 优先，两处优先级不一样）。
 * 别写成 `name || T('noWeapon')` —— 那把「装备了但不认识」也报成没武器。
 */
export function weaponFallback (w) {
  return T(w?.state === 'unknown' ? 'unknownWeapon' : 'noWeapon')
}

/* 词条按权重分三档，和 miao 卡片里「有效/无效词条」的高亮规则一致 */
export function weightClass (w) {
  return w > 79.9 ? 'great' : (w > 0 ? 'useful' : 'nouse')
}

/*
 * 强化命中圈号：实心圆 + 镂空数字，1~5。
 * 为什么只能用 SVG mask 抠：CSS 的 mask 只能拿渐变/图片/路径当蒙版，**没法拿字形当蒙版**；
 * 而想硬做镂空只剩「拿不透明色填数字」一条路，可词条行的底是半透明黑，
 * 填任何固定色都能看出一块色斑。SVG 的 mask 抠出来的是真 alpha，行底下是什么就露什么。
 * 圆用 currentColor：跟着词条的三档配色（great/useful/nouse）走，CSS 不用再为它配一遍色。
 * url(#id) 是全文档查的，同页几十个圈号不能重名 —— 所以用自增序号。
 */
let hitMaskSeq = 0
export function hitMark (n) {
  const NS = 'http://www.w3.org/2000/svg'
  const mk = (tag) => document.createElementNS(NS, tag)
  const attr = (node, kv) => { for (const [k, v] of Object.entries(kv)) node.setAttribute(k, v); return node }

  const mask = mk('mask')
  mask.id = 'up-hit-' + (++hitMaskSeq)
  /* 蒙版按亮度取：白整块留着（＝圆），黑的地方抠掉（＝数字） */
  mask.append(attr(mk('rect'), { width: 14, height: 14, fill: '#fff' }))
  /* x=7 / y=10.6 是截图像素量出来的，不是估的；换字体要重量 */
  const digit = attr(mk('text'), { x: 7, y: 10.6, 'text-anchor': 'middle', fill: '#000' })
  digit.textContent = String(n)
  mask.append(digit)

  const defs = mk('defs')
  defs.append(mask)
  const disc = attr(mk('circle'), { cx: 7, cy: 7, r: 7, fill: 'currentColor', mask: `url(#${mask.id})` })
  const svg = attr(mk('svg'), { viewBox: '0 0 14 14' })
  svg.append(defs, disc)
  return svg
}

/* 图片加载失败时隐藏自己，让 CSS 占位露出来 */
export function imgError (img) { img.style.display = 'none' }

/* ───────────────────────── 视图切换 ───────────────────────── */

export function showView (name) {
  const onDetail = name === 'detail'
  const onSim = name === 'sim'
  $('view-roster').classList.toggle('active', name === 'roster')
  $('view-detail').classList.toggle('active', onDetail)
  $('view-sim').classList.toggle('active', onSim)
  /* 明细页把整条顶栏收掉（CSS 侧：body.on-detail .top { display:none }）。
     UID 框 / 刷新 / 语言在这儿一个都用不上，留着只是把 600px 画布往下顶，
     还把页面上唯一的退出入口「← 返回」压成次要信息。切回首页再放出来 ——
     语言切换只在首页做，明细页不带这一排。
     ⚠️ 模拟页也收顶栏：它是明细页的下一步，同样用不上那一排。
     ⚠️ 评定报告没有视图：首页按钮一点直接出图下载（见 features/report/report-shot.js）。 */
  document.body.classList.toggle('on-detail', onDetail || onSim)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

export function backToRoster () {
  state.selectedAvatarId = null
  showView('roster')
}

/* ───────────────────────── URL / 加载态 ───────────────────────── */

export function syncUrl () {
  const q = new URLSearchParams()
  if (state.uid) q.set('uid', state.uid)
  if (state.locale) q.set('locale', state.locale)
  if (state.selectedAvatarId && $('view-detail').classList.contains('active')) q.set('char', state.selectedAvatarId)
  history.replaceState(null, '', q.toString() ? `${PAGE_BASE}?${q}` : PAGE_BASE)
}

export function showLoading (text) {
  const box = $('view-roster')
  box.innerHTML = ''
  const wrap = el('div', 'loading')
  wrap.append(el('div', 'spin'), el('div', '', text ?? T('loading')))
  box.append(wrap)
}

/* ───────────────────────── 注册表 + 编排函数 ─────────────────────────
 * feature 模块在加载时把自己的渲染器写进 reg；编排函数只在运行时读 reg，
 * 因此 core 在求值期不触碰任何 feature（零循环依赖）。 */

export const reg = {}

/* 只重画网格那一块（筛选/排序点了之后），不重建筛选栏 —— 重建会把下拉选中态和展开态冲掉 */
export function refreshRosterGrid () {
  const slot = document.querySelector('#view-roster .rf-grid')
  if (slot) reg.renderRosterGrid?.(slot)
}

/* 切「武器 / 圣遗物」视图：名单和排序都没变，只换卡片下半块（见 roster.js 的 swapRosterFoot），
   立绘不重建，避免整页卡片图重新加载。 */
export function swapRosterFoot () {
  const slot = document.querySelector('#view-roster .rf-grid')
  if (slot) reg.swapRosterFoot?.(slot)
}

export function renderAll () {
  reg.renderRoster?.()
  reg.renderDetail?.()
}

export function openDetail (avatarId) {
  state.selectedAvatarId = avatarId
  reg.renderDetail?.()
  showView('detail')
}

/* 新数据到手后统一走这里：记地址、换账号时清掉「排序/筛选」这份临时状态、重画、回首页 */
export function applyView (view) {
  /* ⚠️ uid 在 `view.account.uid` 里，**账号视图顶层没有 uid**（每个 avatar 也各带一份）。
     早先这里写的是 `view.uid`，于是 state.uid 一直是 undefined —— 两个后果：
       ① `switched` 永远是 false，换账号时排序/筛选不重置（本该有的那个修复等于没生效）；
       ② 模拟比对页拿 state.uid 拼接口，拼出 `accounts/undefined/.../simulator` 全部 404，
          装备目录拿不到、改完也不重算（页面只显示「伤害计算中…」，右栏永远是账号原值）。
     取 account.uid 就好，别再用 view.uid。 */
  const uid = view.account?.uid ?? null
  /* 换了账号（上一份的 uid 跟这次不同）→ 排序和筛选是「在这份名单里找人」的临时状态，
     不能从上一个账号泄漏过来，否则会出现「不同账号排序不一样」的假象。同账号刷新不动它。 */
  const switched = state.uid != null && state.uid !== uid
  state.view = view
  state.uid = uid
  if (switched) {
    state.sort = [{ key: 'mark', dir: 'desc' }]
    state.filter = { elem: [], rank: [], weight: [], set: [], star: [] }
  }
  syncUrl()
  renderAll()
  showView('roster')
}
