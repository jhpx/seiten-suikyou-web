/*
 * 明细页的页面适配：把固定 600px 设计稿按真实环境兜底排版。
 * 三个函数各自独立，互不牵连；只依赖 core 的 DOM helper。
 */

/*
 * 长文案防重叠（明细页统一入口）。原则两条：
 *   ① 不做文案裁剪 —— 改短一种语言，另一种又对不上；
 *   ② 同组同类文字字号必须一致 —— 只缩装不下的那条，会出现「两行小字 + 一行大字」混排。
 * 所以判据都是「组里有一个装不下 → 整组降一档」，降完再单独判谁还要折行。
 *
 * 五个组（各自独立降档）：
 *   ① 属性面板        .char-attr            容器加 .compact → 13px；装不下的那条再 .two-line
 *   ② 评分表顶三词条   .arti-attr li         逐格加 .compact（整张表一起缩）
 *   ③ 武器主副属性     .weapon-attr div      两条一起 .stacked（名字一行 / 数值一行）
 *   ④ 圣遗物词条名     .artis ul.detail      每张卡的表加 .compact → 10.5px；装不下的行再 .tight
 *   ⑤ 卡片名          .artis                容器加 .compact → 13px；装不下的那条再 .two-line
 *
 * 为什么不用「字符数」判断：一个英文单词可能比六个汉字还宽，按字符数中英两边都会判错。
 *
 * ⚠️ 顺序：先打 .compact（改字号）→ 再量是否还要折行。字号变了判据也得跟着变。
 * ⚠️ 推到下一帧：renderDetail 是「先渲染、再 showView」，渲染那一刻 .view-detail 还没
 *   active（display:none），量出来全是 0。推到下一帧视图已显示；若仍隐藏（首页切语言顺带重画）
 *   就跳过 —— 点进明细页时 renderDetail 会重画一遍再量。
 */
function fitLongText () {
  requestAnimationFrame(() => {
    const cut = n => !!n.clientWidth && n.scrollWidth > n.clientWidth + 1

    /* ① 属性面板：整块统一降档，再标谁要折行 */
    const panel = document.querySelector('.char-attr')
    const titles = [...document.querySelectorAll('.char-attr li .title')]
    if (panel && titles.length) {
      panel.classList.remove('compact')
      if (titles.some(cut)) panel.classList.add('compact')
      for (const t of titles) t.classList.toggle('two-line', cut(t))
    }

    /* ② 评分表顶三词条：整张表统一降档（类名打在 li 上，角标和数值才好跟着缩）。
       统计格（有效/无效词条数）也一起降 —— 同组字号必须一致，否则「词条 10px、汇总 14px」
       看起来像排版出错；它们的角标留白/折行由 miao.css 的 .compact.stat-cell 覆盖修正。 */
    const cells = [...document.querySelectorAll('.arti-attr li, .arti-stat-row li')]
    for (const li of cells) li.classList.remove('compact')
    const scoreOver = cells.some(li => {
      const t = li.querySelector('.title')
      return t && cut(t)
    })
    if (scoreOver) for (const li of cells) li.classList.add('compact')

    /* ③ 武器主副属性：这行写死 26px，文字折行会把行撑破 → 改成上下两行小字。
       判据看高度（宽度永远等于 50%，折行不会撑宽，只会撑高）。
       ⚠️ 两条一起改：只改一条的话同一行里左边 10px 右边 14px。 */
    const wcells = [...document.querySelectorAll('.weapon-attr div')]
    if (wcells.length) {
      for (const d of wcells) d.classList.remove('stacked')
      const stackOver = wcells.some(d => d.clientHeight && d.scrollHeight > d.clientHeight + 1)
      if (stackOver) for (const d of wcells) d.classList.add('stacked')
    }

    /* ④ 圣遗物词条名：整卡 185px，词条名列只有 61/80px（跟了命中圈号的行只剩 61）。
       每张卡的表各自降档（一张卡内部必须一致），装不下的行再 .tight 折行。 */
    for (const ul of document.querySelectorAll('.artis ul.detail')) {
      const rows = [...ul.querySelectorAll('li')].filter(li => li.querySelector('.label'))
      if (!rows.length) continue
      ul.classList.remove('compact')
      const labOf = li => li.querySelector('.label')
      if (rows.some(li => cut(labOf(li)))) ul.classList.add('compact')
      for (const li of rows) li.classList.toggle('tight', cut(labOf(li)))
    }

    /* ⑤ 卡片名（武器 / 圣遗物）：名字列 160px（武器 170px），英文全名一行要 180~220px。
       整组（一屏卡片）统一降档，短名字也跟着变 13px，才不会六张卡里三种字号。 */
    const artis = document.querySelector('.artis')
    const names = [...document.querySelectorAll('.artis .head strong')]
    if (artis && names.length) {
      artis.classList.remove('compact')
      for (const s of names) {
        s.classList.remove('two-line')
        s.closest('.item.weapon')?.classList.remove('name-2l')
      }
      if (names.some(cut)) artis.classList.add('compact')
      for (const s of names) {
        if (!cut(s)) continue
        s.classList.add('two-line')
        /* 武器卡多一行名字要多吃一条属性条（26px）的高度，CSS 里按这个类加底部留白 */
        s.closest('.item.weapon')?.classList.add('name-2l')
      }
    }
  })
}

/* 把下拉的选中文字压进可用宽度。
 * 细条 .arti-class-title 只有 185px，左边还要放「评分规则」标签，留给下拉的只有 100~130px；
 * 各语言里中文最短、日文最长，差十来个像素就会被原生 select 从半个字切开（原生 select 不打省略号）。
 * 这里按 canvas 量出来的实际宽度逐档降字号（11 → 9.5）。极长的名字降到 9.5px 还放不下就让它切。 */
let measureCtx = null
function fitSelectText (sel) {
  const cs = getComputedStyle(sel)
  const avail = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  const text = sel.options[sel.selectedIndex]?.text || ''
  if (avail <= 0 || !text) return
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  for (const size of [11, 10.5, 10, 9.5]) {
    measureCtx.font = `${size}px ${cs.fontFamily}`
    if (measureCtx.measureText(text).width <= avail) {
      sel.style.fontSize = `${size}px`
      return
    }
  }
  sel.style.fontSize = '9.5px'
}

/* 把固定 600px 设计稿的 .pd-canvas 等比缩到外壳宽（.pd-frame = .app 内容区）。
 * 用 transform:scale 而不是 zoom：zoom 在被截图/长截图引擎渲染时常被忽略，导致 600px 画布撑出
 * 视口、手机上只截到左侧一半；transform 的布局盒由外壳（width:100% + overflow:hidden + 这里设的
 * 高度）兜住，任何截图都能截全。只缩一次（画布本身就是 600px 设计稿），避免双缩。 */
function fitDetailScale () {
  const frame = document.querySelector('.pd-frame')
  const canvas = document.querySelector('.pd-canvas')
  if (!frame || !canvas) return
  if (!frame.clientWidth || !canvas.offsetHeight) return
  const s = Math.min(1, frame.clientWidth / 600)
  canvas.style.transformOrigin = 'top left'
  canvas.style.transform = s === 1 ? '' : `scale(${s})`
  /* transform 不改布局盒：外壳高度得手动跟上，否则画布缩放后下方内容会叠上来 */
  frame.style.height = Math.round(canvas.offsetHeight * s) + 'px'
}
window.addEventListener('resize', fitDetailScale)
/* 字体（Number 等）异步落位可能改高度，落位后再算一次 */
window.addEventListener('load', fitDetailScale)

export { fitLongText, fitSelectText, fitDetailScale }
