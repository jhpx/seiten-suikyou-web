/*
 * 模拟比对页的共享状态：目录、草稿、右栏重算结果，以及围绕它们的读写。
 *
 * 原 sim.js 是 898 行单文件，所有函数都直接读写模块级的 sim 对象。拆开之后这份状态
 * 单独成层，渲染 / 弹窗 / 伤害三块都从这儿取，谁也不必互相 import（单向依赖，无环）。
 *
 * 唯一一处反向调用是 recompute 算完后要重画页面 —— 用 setRedraw 注入，由 sim.js 在
 * 加载时注册。这是为了避免「状态层 import 编排层、编排层又 import 状态层」的循环依赖。
 * 函数体、参数、判定口径全部照搬，没有改行为。
 */

import { state, api } from '../../core.js'

/* 模拟页本地状态：草稿 + 目录 + 右栏结果 */
export const sim = {
  avatarId: null,
  catalog: null,
  draft: { weapon: null, artifacts: [] },
  right: null,
  busy: false,
  /* 重算请求号：连着改两件时两份请求并行，算得慢的那份可能后回来，
     用 seq 拦掉过期结果，避免「改了看似没反应」。 */
  seq: 0,
  /* 左栏伤害只跟当前实装有关，进页面取一次即可（dmgBox 是底部对比表容器引用）。 */
  leftDamage: null,
  dmgBox: null
}

/* 目录在途请求：复用 openSim 发起的那次抓取，避免重复打接口；切角色时置空重拉。 */
let catalogReq = null

/* 重算之后的页面重画，由 sim.js 注册 */
let redraw = () => {}
export function setRedraw (fn) { redraw = fn }

/* ── 数据 ── */

/* 当前实装角色（账号视图里的 avatars[]） */
export function currentAvatar () {
  if (!state.view || sim.avatarId == null) return null
  return state.view.avatars.find(a => a.avatarId === sim.avatarId) || null
}

/* 等目录就绪。所有「改」弹窗都依赖 sim.catalog（武器 affixText、套装 positions 等）；
   目录没回来就开弹窗会让武器落进合成兜底项，简介空白。复用在途请求，失败退回 null。 */
export async function ensureCatalog () {
  if (sim.catalog) return sim.catalog
  if (!catalogReq) {
    catalogReq = api(`accounts/${state.uid}/characters/${sim.avatarId}/simulator?locale=${encodeURIComponent(state.locale)}`)
      .then(c => { sim.catalog = c })
  }
  try {
    await catalogReq
  } catch {
    catalogReq = null
    return null
  }
  return sim.catalog
}

/* 进页面时主动拉一次目录，并把在途请求记下来给 ensureCatalog 复用。 */
export function startCatalog () {
  catalogReq = api(`accounts/${state.uid}/characters/${sim.avatarId}/simulator?locale=${encodeURIComponent(state.locale)}`)
    .then(c => { sim.catalog = c })
  return catalogReq
}

/* 换角色时目录必须重拉（目录跟角色武器类型走）。 */
export function resetCatalog () {
  sim.catalog = null
  catalogReq = null
}

/* 按草稿重算右栏 */
export async function recompute () {
  const uid = state.uid
  if (!uid || sim.avatarId == null) return
  const seq = ++sim.seq
  sim.busy = true
  try {
    const res = await api(`accounts/${uid}/characters/${sim.avatarId}/simulator?locale=${encodeURIComponent(state.locale)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sim.draft)
    })
    if (seq !== sim.seq) return
    sim.right = res
  } catch (e) {
    if (seq !== sim.seq) return
    /* 失败不清空 sim.right：留着上次成功结果，否则整页静默退回原值，像「改了没反应」。 */
    console.error('[sim] 模拟失败:', e)
  } finally {
    if (seq === sim.seq) {
      sim.busy = false
      redraw()
    }
  }
}

/* ── 武器草稿 ── */

/* 草稿里的武器（没改过即当前实装那把）。 */
export function draftWeapon () {
  if (sim.draft.weapon) return sim.draft.weapon
  const w = currentAvatar()?.weapon
  if (!w || w.state === 'none') return { itemId: 0, level: 1, affix: 1 }
  return { itemId: w.itemId ?? 0, level: w.level ?? 1, affix: w.affix ?? 1 }
}

export function setDraftWeapon (w) {
  sim.draft.weapon = w
  recompute()
}

/* 还原武器：清掉草稿武器，右栏回到当前实装那把。 */
export function revertWeapon () {
  sim.draft.weapon = null
  recompute()
}

/* 武器是否被改过：比值不比「草稿里有没有」（原样点确定也会写草稿，不该算改动）。 */
export function isWeaponDirty () {
  const d = sim.draft.weapon
  if (!d) return false
  const w = currentAvatar()?.weapon
  if (!w || w.state === 'none') return true
  return d.itemId !== (w.itemId ?? 0) || d.level !== (w.level ?? 1) || d.affix !== (w.affix ?? 1)
}

/* ── 圣遗物草稿 ── */

/* 该部位当前草稿（没改过给默认值）。 */
export function draftOfPos (pos) {
  return (sim.draft.artifacts || []).find(a => a.pos === pos) || null
}

/* 未改过时的初值：取当前实装那件。 */
export function defaultDraftOf (a) {
  return {
    set: a.setNameZh || '',
    pos: a.pos,
    star: a.star || 5,
    /* 内核 0 基（levelRaw - 1），页面用 1 基，这里 +1。 */
    level: (a.level ?? 0) + 1,
    mainKey: mainKeyOf(a.main),
    subs: (a.subs || []).map(s => ({ key: s.key, value: parseNum(s.value) }))
  }
}

/* 主词条 key：内核口径 → 目录/下拉口径。
   ⚠️ 元素伤害杯在核心里是具体元素（cryo/pyro…），目录只给一项 dmg。不翻回来下拉一个都选不中，
   默认选第一项（攻击力），只改个副词条也会把冰伤悄悄换成大攻击（实测冰伤 46.6% → 0 → 46.6%）。 */
export function mainKeyOf (main) {
  const key = main?.key
  if (!key) return 'hpPlus'
  return key === currentAvatar()?.elem ? 'dmg' : key
}

/* 显示串（"10.9%" / "478"）→ 数字。 */
export function parseNum (text) {
  const n = Number(String(text).replace(/[%,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function setDraftArtifact (next) {
  const list = (sim.draft.artifacts || []).filter(a => a.pos !== next.pos)
  list.push(next)
  sim.draft.artifacts = list
  recompute()
}

/* 还原圣遗物：从草稿摘掉该部位，右栏回到当前实装。 */
export function revertArti (pos) {
  sim.draft.artifacts = (sim.draft.artifacts || []).filter(a => a.pos !== pos)
  recompute()
}

/* 该部位当前实装件（用作旧值/旧图标基准）；找不到或空件返回 null。 */
export function originalArti (pos) {
  return (currentAvatar()?.artifacts || []).find(x => x.pos === pos) || null
}

/* 圣遗物是否被改过：必须跟左栏原始视图比，不能跟右栏 a 比（a 已是改后结果，永远相等）。 */
export function isArtiDirty (pos) {
  const d = draftOfPos(pos)
  if (!d) return false
  const equipped = originalArti(pos)
  if (!equipped || equipped.empty) return true          // 原本空着，现在填了 = 改动
  const o = defaultDraftOf(equipped)
  /* 星级也算改动：它改主词条数值档位和满级上限（4★ 最高 +16）。 */
  if (d.set !== o.set || d.star !== o.star || d.level !== o.level || d.mainKey !== o.mainKey) return true
  if ((d.subs || []).length !== o.subs.length) return true
  return (d.subs || []).some((s, i) => s.key !== o.subs[i].key || s.value !== o.subs[i].value)
}
