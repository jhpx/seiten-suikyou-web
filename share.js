/*
 * 明细页截图分享：把 .pd-canvas 整张配装卡（含伤害表）栅格成 PNG 并直接下载。
 * 卡片内图片全是同源相对路径（web/assets/...，后端 serveStatic 提供），无跨域污染，modern-screenshot 直接内联。
 * 截图库用本地 vendored 的 web/vendor/modern-screenshot.mjs（单文件 ESM、零 CDN 依赖）。
 */

import { state } from './core.js'

let lib = null
/* 动态 import 才加载截图库（约 37KB），只取一次缓存住 */
async function loadLib () {
  if (!lib) lib = await import('./vendor/modern-screenshot.mjs')
  return lib
}

/* 等伤害表定型再截（最多 4s），避免截到「伤害计算中…」；超时也不阻塞 */
async function waitDamage (timeout = 4000) {
  const wrap = document.querySelector('#view-detail .dmg-wrap')
  if (!wrap) return
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (wrap.querySelector('.dmg-cont') || wrap.querySelector('.dmg-status')) return
    await new Promise(r => setTimeout(r, 200))
  }
}

/* 截整张明细卡并下载；返回 true 表示已触发下载 */
export async function downloadDetailCard () {
  const frame = document.querySelector('#view-detail .pd-frame')
  const canvas = document.querySelector('#view-detail .pd-canvas')
  if (!canvas) return false

  await waitDamage()

  /* 小屏 .pd-frame 被 zoom 缩到 <1 会糊，截时归 1 拿满分辨率，截完复原 */
  const prevZoom = frame ? frame.style.zoom : ''
  if (frame) frame.style.zoom = '1'
  try {
    const { domToBlob } = await loadLib()
    const blob = await domToBlob(canvas, { scale: 2 })   // 600px → 1200px
    if (!blob) return false

    const av = state.view?.avatars?.find(a => a.avatarId === state.selectedAvatarId)
    const name = (av?.name || 'card').replace(/[\\/:*?"<>|]/g, '_')  // 清掉文件名非法字符
    const uid = av?.uid ?? 'uid'
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = `genshin-${uid}-${name}.png`
    link.href = url
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)  // 下载已同步触发，1s 后回收
    return true
  } finally {
    if (frame) frame.style.zoom = prevZoom
  }
}
