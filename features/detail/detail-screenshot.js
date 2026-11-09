/*
 * 明细页截图分享：把 .pd-canvas 整张配装卡（含伤害表）栅格成 PNG 并直接下载。
 * 卡片内图片全是同源相对路径（web/assets/...，后端 serveStatic 提供），无跨域污染，modern-screenshot 直接内联。
 * 截图库用本地 vendored 的 web/vendor/modern-screenshot.js（单文件 ESM、零 CDN 依赖）。
 *
 * 栅格化和下载这两步在 features/shot.js（全站共用），这里只留明细页特有的部分：
 * 等伤害表定型、量画布尺寸、起文件名。
 */

import { state } from '../../core.js'
import { showBusy, nodeToBlob, downloadBlob } from '../shot.js'

/* 出图倍率：600px 设计稿 × 1.25 = 750px 宽。
 *
 * 实测（600×1782 画布，同机两轮取最快）：
 *   scale 2    → 1321ms / 3200KB
 *   scale 1.5  → 1092ms / 2025KB
 *   scale 1.25 →  957ms / 1458KB   ← 当前
 *   scale 1    →  812ms / 1007KB
 * 再往下收益就很小了：那 800ms 打底的是克隆 DOM（约 550ms）和把几十张图内联进 SVG，
 * 跟分辨率无关。同尺寸改用 JPEG 只能再省 100ms 出头，小字还会出色边，不值。
 * 卡里最小的字是 9px 词条，1.25 倍后 11.25px 仍然清楚；手机上看这张图只有 380pt 宽，
 * 750px 够用，1200px 全是白等。 */
const SHOT_SCALE = 1.25

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
  const canvas = document.querySelector('#view-detail .pd-canvas')
  if (!canvas) return false

  /* 蒙版先挂上：光 waitDamage 最长就能等 4s，这段没有任何反馈足够让人以为按钮坏了 */
  const hideBusy = showBusy()
  /* 让出一帧再干活：domToBlob 开头要把整张卡克隆一遍，那段是同步的；
     不先让浏览器画完这一帧，转圈会等到克隆结束才出现，等于没提示。 */
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

  /* 画布自己若也被缩过（fitDetailScale 在窄外壳下会写 scale），克隆出来会带着 transform
     缩一次、留白一圈，临时置空。transform 不改布局盒，不影响下面量到的宽高。 */
  const prevTransform = canvas.style.transform
  const prevOrigin = canvas.style.transformOrigin

  try {
    await waitDamage()

    canvas.style.transform = 'none'
    canvas.style.transformOrigin = 'top left'

    const blob = await nodeToBlob(canvas, SHOT_SCALE)
    if (!blob) return false

    const av = state.view?.avatars?.find(a => a.avatarId === state.selectedAvatarId)
    const name = av?.name || 'card'
    const uid = av?.uid ?? 'uid'
    downloadBlob(blob, `genshin-${uid}-${name}.png`)
    return true
  } finally {
    canvas.style.transform = prevTransform
    canvas.style.transformOrigin = prevOrigin
    hideBusy()
  }
}
