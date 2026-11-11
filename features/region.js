/*
 * 顶栏区服在线状态胶囊：进页面读一次 /api/region 的缓存，把每个区服铺成
 * 「状态图标 + 代号」。与 css/region.css 配对（样式见该文件）。
 *
 * 后端每 5 分钟同步一次 status.enka.network，缓存在 /api/region（数据源状态，
 * 与「后端是否存活」的 /api/health 分开）；前端不挂定时器、点刷新也不查。
 * 身份色里本来就有绿(cht)/红(china)/粉(bilibili)，跟状态色会撞，所以状态用两层编码：
 * 形状图标（✓ 在线 / ✕ 断线 / ○ 未知）+ 红绿胶囊底色，都在 CSS 里；文字只留区服代号。
 * 身份色由后端从状态页 <b style="color:#…"> 抄好随 r.color 发来，前端不再备一套。
 */

import { $, api } from '../core.js'

function appendGroupLabel (box, text) {
  const label = document.createElement('span')
  label.className = 'src-group-label'
  label.textContent = text
  box.append(label)
}

function appendRegion (box, r) {
  const el = document.createElement('span')
  const state = r.status === 'up' ? 'is-up' : r.status === 'down' ? 'is-down' : 'is-unknown'
  el.className = 'src-region ' + state
  el.style.setProperty('--c', r.color || 'var(--ink-3)')
  /* 图标是 CSS 伪元素，读屏软件读不到 —— 补一条不可见的标签，别让状态只剩颜色 */
  el.setAttribute('aria-label', `${r.name} ${r.status}`)
  const name = document.createElement('span')
  name.className = 'src-name'
  name.textContent = r.name
  el.append(name)
  box.append(el)
}

function renderRegions (regions, microggServers) {
  const box = $('src-regions')
  if (!box) return
  box.replaceChildren()
  /* 两组对称：Enka 官方区服在前，MicroGG 镜像节点自己的服在后 */
  if (regions?.length) {
    appendGroupLabel(box, 'enka')
    for (const r of regions) appendRegion(box, r)
  }
  if (microggServers?.length) {
    appendGroupLabel(box, 'microgg')
    for (const r of microggServers) appendRegion(box, r)
  }
}

/* 进页面读一次后端缓存；读不到就放一个纯图标的灰胶囊，不显示任何文字 */
export async function loadRegions () {
  try {
    const h = await api('region')
    renderRegions(h.regions, h.microggServers)
  } catch {
    const box = $('src-regions')
    if (!box) return
    const el = document.createElement('span')
    el.className = 'src-region is-unknown'
    el.setAttribute('aria-label', 'unknown')
    box.replaceChildren(el)
  }
}
