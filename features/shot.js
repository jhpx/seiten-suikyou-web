/*
 * shot —— 全站共用的「把一个 DOM 节点栅格成图片并下载」那一层
 *
 * 明细页的配装卡、评定报告的报告单，两处要的都是同一件事：调 modern-screenshot
 * 把一个节点画成 PNG，再交给浏览器下载。原先两边各写一份（showBusy / loadLib /
 * 触发下载三段），改一处就得记得改另一处 —— 现在收到这里，各页面只留自己
 * 特有的部分（等伤害表定型、等图片加载完）。
 *
 * 依赖方向：shot.js → core.js（只用 el）+ vendor/modern-screenshot.js。
 * 它不认识任何页面，所以谁都能用。
 *
 * ⚠️ 文件名**必须是 .js，不能是 .mjs**：线上前端托管在 GitHub Pages，它对 .mjs 回的
 *   Content-Type 是 `application/octet-stream`，而浏览器对模块脚本的 MIME 是硬校验 ——
 *   动态 import 直接抛 "Expected a JavaScript module script"。本地 serveStatic 会给
 *   `text/javascript`，所以「127 能下、线上域名不能下」。改名即可，别再换回 .mjs。
 */

import { el } from '../core.js'

let lib = null
/* 动态 import 才加载截图库（约 37KB），只取一次缓存住 */
async function loadLib () {
  if (!lib) lib = await import('../vendor/modern-screenshot.js')
  return lib
}

/*
 * 出图期间盖一层「只转圈、不写字」的蒙版 —— 出图要等几秒，不给反馈用户只会以为按钮坏了。
 *   · 挂在 body 上（和弹窗一样在 .shell 外）：不参与整页缩放，也不会被截进图里；
 *   · 顺手挡住点击：生成途中切页面、再点一次分享，下载都会落空；
 *   · 淡入延迟 120ms 写在 css/page-states.css 的 .shot-mask 上：桌面端常常 100ms 就完事，
 *     一闪而过的黑影比没有更糟。
 */
export function showBusy () {
  const mask = el('div', 'shot-mask')
  mask.append(el('div', 'shot-spin'))
  document.body.append(mask)
  return () => mask.remove()
}

/*
 * 把节点栅格成 PNG Blob。
 *
 * ⚠️ 出图尺寸必须**显式传**，不能让库自己去量 —— 理由和明细页那张一样：
 *   手机上是 .shell-in 的整页 scale()（见 bootstrap.js 的 fitShell）在缩放，
 *   getBoundingClientRect() 量到的是缩放后的尺寸，库会照那个建画布，于是只截到左上角一块。
 *   offsetWidth/offsetHeight 是布局尺寸，不受祖先 transform 影响。
 *
 * options 原样透传给 domToBlob（例如 onCloneNode），页面特有的修正不用改这一层。
 */
export async function nodeToBlob (node, scale = 1, options = {}) {
  const { domToBlob } = await loadLib()
  return domToBlob(node, { width: node.offsetWidth, height: node.offsetHeight, scale, ...options })
}

/* Blob → 浏览器下载。文件名里的非法字符（\ / : * ? " < > |）先换成下划线。 */
export function downloadBlob (blob, filename) {
  const name = filename.replace(/[\\/:*?"<>|]/g, '_')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = name
  link.href = url
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)  // 下载已同步触发，1s 后回收
}
