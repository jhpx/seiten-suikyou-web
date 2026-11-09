/*
 * 评定报告导出：把报告单排到一块离屏的「纸」上，栅格成 PNG 并下载。
 *
 * 和明细页的截图是同一套机制（通用层在 features/shot.js，库在 vendor/modern-screenshot.js），
 * 两处不同：
 *   明细页 —— 画布本来就在页面上，截的是已经排好版的 .pd-canvas；
 *   报告单 —— 没有页面了（首页按钮一点就出图），所以得先在视口外排一张出来再截。
 *
 * 离屏那块「纸」有三条讲究：
 *   ① 固定 600 宽 —— 和 .app 的内容带（--app-width 616 - 左右各 8）一样宽，
 *      报告单里的表格是按 600 写的固定栅格，换个宽就散了（宽度写在 css/report.css 的 .rp-offscreen）；
 *   ② 挂在 body 上、position: fixed —— .shell-in 的整页缩放（bootstrap.js 的 fitShell）不碰它，
 *      量到的 offsetWidth 就是设计宽，不受 scale 影响；
 *   ③ 挪到视口外（left:-9999px）而不是 visibility/opacity 隐藏 —— 那两个是**继承属性**，
 *      会被算进克隆节点的计算样式，截出来是一张白纸。
 *
 * 报告单里的图都是同源相对路径（web/assets/...），无跨域污染，库能直接内联；
 * 库自己会等图 decode 完再画，不用我们管。
 */

import { state, T, banner, reg } from '../../core.js'
import { showBusy, nodeToBlob, downloadBlob } from '../shot.js'
import { renderSheet } from './report.js'

/* 出图倍率：600 设计稿宽 × 1.25 = 750px。和明细页同一个取值：
   报告单里的字不比明细页小，750px 在手机上看得清，再高只是白占体积。 */
const SHOT_SCALE = 1.25

/* 导出当前账号的报告单并下载；返回 true 表示已触发下载。
   两种失败都在这里就地报给用户（提示条），调用方不用管返回值 ——
   首页那个按钮只管「点一下」，出错得让人看得见，不能只在 console 里留一行。 */
export async function exportReport () {
  const view = state.view
  /* 没角色就没得排 —— 首页那句「这个账号里没有可评分的角色」说的就是这件事，直接复用。 */
  if (!view?.avatars?.length) {
    banner(T('noScorable'), 'err')
    return false
  }

  /* 离屏的「纸」：固定 600 宽、挪到视口外。宽度写在 CSS 里，这里不重复这个数。 */
  const paper = document.createElement('div')
  paper.className = 'rp-offscreen'

  /* 蒙版先挂上：出图要克隆整张单子、内联十几张图，得等一会儿，
     没反馈用户只会以为按钮坏了。 */
  const hideBusy = showBusy()

  try {
    /* 让出一帧再干活：domToBlob 开头要把整张单子克隆一遍，那段是同步的；
       不先让浏览器画完这一帧，转圈会等到克隆结束才出现，等于没提示。 */
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    document.body.append(paper)
    const sheet = renderSheet(view)
    paper.append(sheet)

    const blob = await nodeToBlob(sheet, SHOT_SCALE)
    if (!blob) {
      banner(T('shareFail'), 'err')
      return false
    }

    const uid = state.uid ?? 'uid'
    downloadBlob(blob, `seiten-report-${uid}.png`)
    return true
  } catch (e) {
    console.error('[report] 导出失败：', e?.message)
    banner(T('shareFail'), 'err')
    return false
  } finally {
    paper.remove()
    hideBusy()
  }
}

/* 首页那个「导出报告」按钮的入口。走 reg 而不是让首页 import 本模块 ——
   和 advice / 模拟页一样，页面之间不直接互相 import。 */
reg.exportReport = exportReport
