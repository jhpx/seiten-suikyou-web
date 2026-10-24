/*
 * 前端入口（type="module"）。职责：把各 feature 模块引到一起（它们的副作用是往 core.reg
 * 注册渲染器），再定义「控制器」loadUid/fetchUid/boot，绑定顶栏事件，启动。
 *
 * 结构：首页（账号头 + 筛选条 + 角色网格）→ 点击卡片 → 角色明细页。
 * 后端负责「算什么、叫什么」，前端只负责「长什么样」。
 */

/* 引 side-effect：这些模块在加载时把自己的渲染器写进 core.reg */
import './roster.js'
import './advice.js'
import './filter.js'
import './sort.js'
import './detail.js'
import './sim.js'
import { loadMeta, applyStaticUi, changeLocale } from './i18n.js'
import { persistUid, renderUidHistory } from './history.js'
import { $, state, T, el, api, uidApiUrl, banner, showLoading, applyView, renderAll, showView, reg, isValidUid } from './core.js'

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
    banner(e?.code === 'bad_uid' ? T('badUid') : T('fetchFail', { msg: e.message }), 'err')
    if (state.uid) await loadUid(state.uid, { keepSelection: true })
  } finally {
    state.busy = false
    btn.disabled = false
    btn.textContent = T('fetch')
  }
}

async function boot () {
  const params = new URLSearchParams(location.search)
  state.locale = params.get('locale') || localStorage.getItem('st.locale') || 'chs'
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
