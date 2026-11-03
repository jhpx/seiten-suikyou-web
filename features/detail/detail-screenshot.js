/*
 * 明细页截图分享：把 .pd-canvas 整张配装卡（含伤害表）栅格成 PNG 并直接下载。
 * 卡片内图片全是同源相对路径（web/assets/...，后端 serveStatic 提供），无跨域污染，modern-screenshot 直接内联。
 * 截图库用本地 vendored 的 web/vendor/modern-screenshot.js（单文件 ESM、零 CDN 依赖）。
 *
 * ⚠️ 文件名**必须是 .js，不能是 .mjs**：线上前端托管在 GitHub Pages，它对 .mjs 回的
 *   Content-Type 是 `application/octet-stream`，而浏览器对模块脚本的 MIME 是硬校验 ——
 *   动态 import 直接抛 "Expected a JavaScript module script"。本地 serveStatic 会给
 *   `text/javascript`，所以「127 能下、线上域名不能下」。改名即可，别再换回 .mjs。
 */

import { el, state } from '../../core.js'

let lib = null
/* 动态 import 才加载截图库（约 37KB），只取一次缓存住 */
async function loadLib () {
  if (!lib) lib = await import('../../vendor/modern-screenshot.js')
  return lib
}

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

/* 生成期间盖一层「只转圈、不写字」的蒙版 —— 出图要等几秒，不给反馈用户只会以为按钮坏了。
 *   · 挂在 body 上（和弹窗一样在 .shell 外）：不参与整页缩放，也不会被截进图里；
 *   · 顺手挡住点击：生成途中切页面、再点一次分享，下载都会落空；
 *   · 淡入延迟 120ms 写在 style.css 的 .shot-mask 上：桌面端常常 100ms 就完事，
 *     一闪而过的黑影比没有更糟。 */
function showBusy () {
  const mask = el('div', 'shot-mask')
  mask.append(el('div', 'shot-spin'))
  document.body.append(mask)
  return () => mask.remove()
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

    /* 出图尺寸必须**显式传**，不能让库自己去量。
     *
     * modern-screenshot 没收到 width/height 时会用 getBoundingClientRect() 量节点，
     * 而手机上是 .shell-in 的整页 scale()（见 bootstrap.js 的 fitShell）在缩放：
     * 390 宽屏上 rect 只有 600 × 0.633 ≈ 380 宽、1128 高。库按这个尺寸建画布、
     * 再把整张 600px 设计稿塞进去，于是只截到卡片左上角 63% —— 就是「只有半边」。
     * 之前那版「截之前临时撤掉整页缩放」治不了根：撤 transform 会改变 .shell 高度，
     * 触发 ResizeObserver → fitShell 立刻又把 scale 写回去，等 domToBlob 真读尺寸时
     * 往往已经复原了（实测过的就是这个竞态）。
     *
     * offsetWidth/offsetHeight 是布局尺寸，不受祖先 transform 影响，恒等于 600 × 实际高度。
     */
    const width = canvas.offsetWidth
    const height = canvas.offsetHeight

    canvas.style.transform = 'none'
    canvas.style.transformOrigin = 'top left'

    const { domToBlob } = await loadLib()
    const blob = await domToBlob(canvas, { width, height, scale: SHOT_SCALE })   // 600 → 750px
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
    canvas.style.transform = prevTransform
    canvas.style.transformOrigin = prevOrigin
    hideBusy()
  }
}
