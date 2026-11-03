/*
 * 明细页的武器 / 圣遗物卡片。纯渲染：接管 core 的 DOM helper，不碰页面状态、不发请求。
 */
import { el, setBg, T, weaponFallback, rankOf, weightClass, hitMark } from '../../core.js'

/*
 * 武器卡：图标（右上溢出）+ 名字 + 精N Lv.N + 属性条 + 描述。
 *
 * 「名字 / 精N Lv.N」两行是上限，别再往里加行：.head 高 90px，底部 26px 被属性条
 * （absolute bottom:0）占掉，剩下 64px 刚好装下这两行。曾加过一行星级，结果等级行被顶到 64px
 * 以下，整行压进属性条里和「攻击 +608.10」叠在一起。参考图里武器名下面直接就是「精1 Lv.90」。
 */
function renderWeaponCard (w) {
  const item = el('div', 'item weapon')
  item.append(setBg(el('div', 'img'), w.icon))

  const head = el('div', 'head')
  /* 优先用后端本地化的全名（w.name）；sName 是 miao 的中文缩写名，只在 name 拿不到时兜底 */
  head.append(el('strong', '', w.name || w.sName || weaponFallback(w)))
  const wInfo = el('span', 'info')
  wInfo.append(el('span', 'affix affix-' + (w.affix ?? 1), `${T('refine')}${w.affix ?? 1}`))
  wInfo.append(document.createTextNode(` Lv.${w.level ?? '?'}`))
  head.append(wInfo)

  /* 主副属性贴在 head 底部（miao 里 .weapon-attr 是 .head 的子元素、absolute bottom:0，
     挂到整张卡上会掉到卡片底部去） */
  const wa = el('div', 'weapon-attr')
  /* w.attrs 是数组、名字由后端按 locale 给（statLabel），前端不再有那张硬编码中文表 */
  for (const a of w.attrs || []) {
    const d = el('div')
    d.append(el('span', '', a.label))
    /* 武器主副属性不带 +（游戏里就是「基础攻击力 608」「攻击力 49.6%」） */
    d.append(document.createTextNode(' ' + a.value))
    wa.append(d)
  }
  head.append(wa)
  item.append(head)

  /* miao 的描述里带 <nobr> 高亮标签，这里只取纯文本（顺手避免注入） */
  const dc = el('div', 'weapon-desc-cont')
  dc.append(el('div', 'weapon-desc', String(w.desc || '').replace(/<[^>]*>/g, '')))
  item.append(dc)
  return item
}

/*
 * 一件圣遗物：条目结构照抄 miao 的 .item.arti（右上图标 / 头 / 词条表）。
 *
 * 词条名外面多包了一层 .label（miao 没有），为的是让过长的标签被省略号收在自己格里：
 * 表格列宽按「所有行里最宽的单元格」算，英文标签最长 18 字会把整张表撑到 222px（卡只有 185），
 * 于是每一行的数值都右移到隔壁卡片上。详见 miao.css 的 .label 规则。
 */
function renderArtiCard (a, cw = {}) {
  if (a.empty) {
    const c = el('div', 'item arti empty')
    const icon = el('div', 'arti-icon')
    const head = el('div', 'head')
    head.append(el('strong', '', a.posName))
    c.append(icon, head, el('div', 'arti-empty', T('notEquipped')))
    return c
  }

  const rank = rankOf(a.markClass)
  const c = el('div', 'item arti arti-class-' + rank)

  /* 图标：miao 的套装图标（斜切淡出） */
  const icon = el('div', 'arti-icon')
  icon.append(setBg(el('div', 'img'), a.icon))
  icon.append(el('span', '', '+' + (a.level ?? 0)))
  c.append(icon)

  const head = el('div', 'head')
  head.append(el('strong', '', a.name))
  const mk = el('span', 'mark mark-' + rank)
  mk.append(el('span', '', a.mark + '分'))
  mk.append(document.createTextNode(' - ' + a.markClass))
  head.append(mk)
  c.append(head)

  const ul = el('ul', 'detail attr')
  if (a.main) {
    const li = el('li', 'arti-main')
    const mt = el('span', 'title')
    mt.append(el('span', 'label', a.main.label))
    /* 主词条不带 +；只有副词条带（游戏里就是这么分的） */
    li.append(mt, el('span', 'val', a.main.value))
    ul.append(li)
  }
  for (const s of a.subs) {
    const li = el('li', weightClass(Number(cw[s.key] ?? 0)))
    const lab = el('span', 'title')
    /* eff = 词条有效率；up-num = 强化命中了几次，实心圆+镂空数字（见 hitMark 与 CSS） */
    if (s.eff && s.eff !== '-') lab.append(el('i', 'eff', s.eff))
    /* 命中次数 = upNum - 1：upNum 含初始那一次，初始不算强化命中，所以滚两回是 1 次、滚三回是 2 次。
       上限 5（五星共 5 次强化）。0 次命中的不画 —— 和游戏一样留空，也省掉一排没信息的 ⓪。 */
    const hit = Math.min(5, (s.upNum || 0) - 1)
    if (hit > 0) {
      const um = el('i', 'up-num')
      um.append(hitMark(hit))   /* append 返回 undefined，不能连在 el(...) 后面往 lab 里塞 */
      lab.append(um)
    }
    lab.append(el('span', 'label', s.label))
    li.append(lab, el('span', 'val', '+' + s.value))
    ul.append(li)
  }
  c.append(ul)
  return c
}

export { renderWeaponCard, renderArtiCard }
