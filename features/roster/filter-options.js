/*
 * 首页筛选：从当前名单里算出「这一组有哪些值可以点」，以及「选了之后留谁」。
 *
 * 这一节原先整段放在 core.js 里，注释写的是「放在 core 避免 filter↔sort 互相 import 成环」——
 * 阶段 B 原样搬进独立模块：它只 import core.js（state / RANK_ORDER），
 * filter.js 和 sort.js 都从这儿取，谁也不必 import 谁，环自然不存在。
 * 现在把原本长在 sort.js 的 filteredAvatars 也并进来：算候选和按候选过滤是同一件事的两半，
 * sort.js 只管排序，名实相符。函数名、参数、返回值、过滤口径一律没动。
 */

import { state, RANK_ORDER } from '../../core.js'

/* 筛选项的排列顺序：游戏内图鉴的元素顺序（火水风雷草冰岩），不按数据出现顺序排。
   旅行者的 elem 是 multi，不在七元素里 —— 他不会有自己的筛选项，
   但「不限」时照常出现在网格里。 */
export const ELEM_ORDER = ['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo']

export function rosterElems (view) {
  const have = new Set(view.avatars.map(a => a.elem))
  return ELEM_ORDER.filter(e => have.has(e))
}

/* 等级只列名单里真有人拿到过的档位 —— 摆一排点了也是空的档位没有意义 */
export function rosterRanks (view) {
  return RANK_ORDER.filter(r => view.avatars.some(a => a.score.markClass === r))
}

/* 圣遗物套装：名单里**穿满 2 件**的套装。
 * 为什么要卡 2 件：单件不激活套装效果，算不上「穿这套」。放进筛选项就是个假选项 ——
 * 点下去一个人也筛不出来（筛选那边同样只认 2 件，见本文件末尾的 filteredAvatars）。
 * 身份用权威的 setId（后端按每件圣遗物的 itemId 推出的 enka 套装 id，跨角色/跨刷新都稳定），
 * 不能用 miao 的显示名去重 —— 同一套物理圣遗物 miao 可能吐两个不同的显示名，会把一个套裂成两组。
 * name 是本地化显示名、icon 是花部位图，都随某只带这套的角色借来（URL/文案一律后端给）。
 * 排序按 setId 升序：这就是图鉴编号，跨语言/跨刷新顺序都一样；
 * 缺 setId 的（理论上不该有）排到最后，同 id 再按显示名兜底。 */
export function rosterSets (view) {
  const map = new Map()
  for (const a of view.avatars) {
    for (const s of a.sets || []) {
      if ((s.count || 0) < 2) continue
      const key = String(s.setId ?? s.nameZh)
      const id = s.setId == null ? Infinity : Number(s.setId)
      if (!map.has(key)) map.set(key, { id, name: s.name, icon: s.icon })
    }
  }
  return [...map.entries()]
    .sort((x, y) => (x[1].id - y[1].id) || x[1].name.localeCompare(y[1].name))
    .map(([setId, v]) => ({ setId, name: v.name, icon: v.icon }))
}

/* 稀有度（角色星级）：只列名单里真有人是这档的（4★ / 5★）。
 * 值用字符串，和 elem/rank 同口径 —— chip 的 dataset.val 是字符串，
 * 数组里若放数字会和它比不相等（Array.includes 是严格相等），点不亮也筛不准。
 * 排降序：5★ 在前、4★ 在后。 */
export function rosterStars (view) {
  return [...new Set(view.avatars.map(a => String(a.star || 5)))].sort((a, b) => b - a)
}

/* 换了 UID 之后，旧条件可能在这份名单里根本不存在 —— 那时 chips 全不激活、
   网格却是空的，看着像 bug。不成立的值就地剔除，整组空了就是「不限」。
   多选版：把每个维度里不在候选中的值过滤掉（原来单值版是直接清空整键）。 */
export function dropStaleFilter (key, values) {
  state.filter[key] = state.filter[key].filter(v => values.includes(v))
}

/* 按当前筛选条件过滤名单。原先长在 sort.js，但它跟排序无关，搬到候选计算旁边更顺。
   多选：维度内 OR（选了火+水 → 火或水都留）、维度间 AND（元素和等级同时成立）。
   每个维度空数组 = 不限。 */
export function filteredAvatars (view) {
  const f = state.filter
  return view.avatars
    .filter(a => !f.elem.length || f.elem.includes(a.elem))
    .filter(a => !f.rank.length || f.rank.includes(a.score.markClass))
    /* 权重筛选：这一项权重不为 0 就算命中 —— 表里给 0 的，就是这个角色不吃这条属性 */
    .filter(a => !f.weight.length || f.weight.some(w => (a.charWeight?.[w] || 0) !== 0))
    /* 稀有度（角色星级）：选了 4★ 就只留 4★；同时选 4★+5★ 等于这两个都放进来（维度内 OR） */
    .filter(a => !f.star.length || f.star.includes(String(a.star || 5)))
    /* 圣遗物套装：身上**穿满 2 件**该套装才算命中（维度内 OR）。
       单件不激活套装效果，一件也当「穿了这套」会筛出一堆沾边的角色。
       身份用权威 setId（缺了退回 nameZh），同一个套不会裂成两组 */
    .filter(a => !f.set.length || (a.sets || []).some(s => s.count >= 2 && f.set.includes(String(s.setId ?? s.nameZh))))
}
