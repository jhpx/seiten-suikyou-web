/*
 * 界面多语言：拉取 / 切换 / 应用静态文案。
 * bootstrap 启动时直接调用 loadMeta / applyStaticUi / changeLocale，不走 core.reg。
 */

import { $, state, T, api, uidApiUrl, syncUrl, showLoading, renderAll, banner } from '../core.js'

/* 拉一次界面文字表 —— 语言解析的规则在后端，这里只负责拿回来 */
async function loadMeta (locale) {
  const meta = await api(`meta?locale=${encodeURIComponent(locale)}`)
  state.ui = meta.ui || {}
  state.weightOptions = meta.weightOptions || []
  return meta
}

async function changeLocale (locale) {
  state.locale = locale
  localStorage.setItem('st.locale', locale)
  try { await loadMeta(locale) } catch {}
  applyStaticUi()
  syncUrl()
  if (!state.uid) { renderAll(); return }
  showLoading(T('switching'))
  try {
    state.view = await api(uidApiUrl(state.uid))
    renderAll()
  } catch (e) {
    banner(e.message, 'err')
  }
}

function applyStaticUi () {
  document.title = `${T('title')} · ${T('subtitle')}`
  document.documentElement.lang = state.locale
  $('brandName').textContent = T('title')
  $('brandSub').textContent = `seiten-suikyou · ${T('subtitle')}`
  $('uidLabel').textContent = T('uidLabel')
  $('fetch').textContent = T('fetch')
  $('localeLabel').textContent = T('localeLabel')
  $('uid').placeholder = T('uidLabel')
}

export { loadMeta, changeLocale, applyStaticUi }
