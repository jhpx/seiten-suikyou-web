/*
 * 前端入口（type="module"）。职责：把各 feature 模块引到一起（它们的副作用是往 core.reg
 * 注册渲染器），再定义「控制器」loadUid/fetchUid/boot，绑定顶栏事件，启动。
 *
 * 结构：首页（账号头 + 筛选条 + 角色网格）→ 点击卡片 → 角色明细页。
 * 后端负责「算什么、叫什么」，前端只负责「长什么样」。
 */

/* 引 side-effect：这些模块在加载时把自己的渲染器写进 core.reg；
   dialog.js 则是在加载时装上「点外面收面板 / Esc 收面板」两个全局监听。 */
import './features/dialog.js'
import './features/roster/roster.js'
import './features/roster/advice.js'
import './features/roster/filter.js'
import './features/roster/sort.js'
import './features/detail/detail.js'
import './features/sim/sim.js'
import { loadMeta, applyStaticUi, changeLocale } from './features/i18n.js'
import { persistUid, renderUidHistory } from './features/history.js'
import { loadRegions } from './features/region.js'
import { $, state, T, el, api, uidApiUrl, banner, showLoading, applyView, renderAll, showView, reg, isValidUid, detectLocale } from './core.js'

/* ── 整页缩放：全站只维护 600 一套版式 ──
 *
 * 屏幕比 --app-width（616 = 600 内容 + 2×8 内边距）窄，就把整页等比缩小，版式一个像素都不改。
 * 所以 css/ 里一条 @media 都没有 —— 任何设备上看到的都是同一张 600 宽的版面，只是倍率不同。
 *
 * ⚠️ transform 不改布局盒：缩小后内容的「布局高度」还是原尺寸，页面底部会多出一段空白，
 *    得自己把 .shell 的高度补成「内容高 × 倍率」。内容一变高（图片加载完、切视图）就重量一次，
 *    所以挂 ResizeObserver；只在窗口尺寸变化时量是不够的。
 * ⚠️ 倍率写进 CSS 变量 --shell-s：.shell-in 的 min-height 要用它算
 *    「缩完之后正好一屏」（100vh 是真实视口，除以倍率才换算得回去），否则页脚会浮在屏幕中间。
 */
const SHELL_W = 616   // 和 css/base.css 的 --app-width 是同一个数，改一边记得改另一边

function fitShell () {
  const shell = $('shell')
  const inner = $('shellIn')
  if (!shell || !inner) return
  /* 用 clientWidth 不用 innerWidth：后者把滚动条也算进去，桌面窄窗口下会差 15px 出横向滚动 */
  const s = Math.min(1, document.documentElement.clientWidth / SHELL_W)
  document.documentElement.style.setProperty('--shell-s', String(s))
  inner.style.transform = s < 1 ? `scale(${s})` : ''
  shell.style.height = s < 1 ? `${inner.offsetHeight * s}px` : ''
}

fitShell()
addEventListener('resize', fitShell)
new ResizeObserver(fitShell).observe($('shellIn'))

/* 输入框里的 UID：空 / 非 9–10 位纯数字都先拦下，给本地化提示，不往后端发。 */
function readUid () {
  const raw = $('uid').value.trim()
  if (!raw) { banner(T('needUid'), 'err'); return null }
  if (!isValidUid(raw)) { banner(T('badUid'), 'err'); return null }
  return Number(raw)
}

async function loadUid (uid, { keepSelection = false } = {}) {
  if (!keepSelection) state.selectedAvatarId = null
  showLoading(T('reading'))
  try {
    const view = await api(uidApiUrl(uid))
    persistUid(uid)
    applyView(view)
  } catch (e) {
    state.view = null
    renderAll()
    banner(e?.code === 'bad_uid' ? T('badUid') : e.message, 'err')
  }
}

async function fetchUid (uid) {
  if (state.busy) return
  state.busy = true
  const btn = $('fetch')
  btn.disabled = true
  btn.textContent = T('fetching')
  showLoading(T('fetchingLong'))
  try {
    /* 刷新 = 让后端拿这个 uid 去打一次 enka。uid 在路径里、locale 在 query 里，
       没有请求体，所以也不用带 Content-Type。 */
    const data = await api(
      `accounts/${encodeURIComponent(uid)}/refresh?locale=${encodeURIComponent(state.locale)}`,
      { method: 'POST' }
    )
    state.selectedAvatarId = null
    persistUid(uid)
    applyView(data)
    banner(T('fetchDone', { n: data.count }), 'ok')
  } catch (e) {
    /* 原始错误（含 microgg/enka 各自原因、超时 ms 等）只进控制台给排查用，别原样甩给用户 ——
       用户看到的是下方统一的友好提示。 */
    console.error('[fetch] 刷新失败：', e?.message)
    banner(e?.code === 'bad_uid' ? T('badUid') : T('fetchFail'), 'err')
    if (state.uid) await loadUid(state.uid, { keepSelection: true })
  } finally {
    state.busy = false
    btn.disabled = false
    btn.textContent = T('fetch')
  }
}

async function boot () {
  const params = new URLSearchParams(location.search)
  state.locale = params.get('locale') || localStorage.getItem('st.locale') || detectLocale()
  renderUidHistory()

  try {
    const meta = await loadMeta(state.locale)
    const sel = $('locale')
    sel.innerHTML = ''
    for (const l of meta.locales) {
      const o = el('option', '', l.label)
      o.value = l.code
      sel.append(o)
    }
    state.locale = meta.locales.some(l => l.code === state.locale) ? state.locale : meta.defaultLocale
    sel.value = state.locale
    applyStaticUi()
    if (!meta.i18nReady) banner(T('i18nMissing'))
  } catch (e) {
    banner(T('metaFail', { msg: e.message }), 'err')
  }

  const wantedRaw = params.get('uid') || localStorage.getItem('st.uid') || ''
  const wantedChar = Number(params.get('char') || 0)
  if (!isValidUid(wantedRaw)) { renderAll(); return }

  $('uid').value = wantedRaw
  await loadUid(Number(wantedRaw))
  if (wantedChar) {
    state.selectedAvatarId = wantedChar
    reg.renderDetail?.()
    showView('detail')
  }
}

$('query').addEventListener('submit', (e) => {
  e.preventDefault()
  const uid = readUid()
  if (uid != null) loadUid(uid)
})
$('fetch').addEventListener('click', () => {
  const uid = readUid()
  if (uid != null) fetchUid(uid)
})
$('locale').addEventListener('change', (e) => changeLocale(e.target.value))

boot()

/* 进页面读一次即可，不挂前端定时器；指示灯随后端 5 分钟一次的同步自然变化 */
void loadRegions()
