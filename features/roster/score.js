/*
 * 首页的评分口径切换：喵喵评分（默认）/ YSIN 评分。
 *
 * 两套评分互不换算、也不共用评级与档位色：
 *   喵喵 = 左下角「评分数字」+ 右下角「评级字母」（原先的样子）；
 *   YSIN = 左下角「词条分」+ 右下角「数据分」，没有适用流派的角色两边都画破折号。
 *
 * 按钮摆在「武器 / 圣遗物」那颗**旁边** —— 两者是同一类东西：点一下就换状态的状态钮，
 * 而右边的排序 / 筛选是「点开弹窗去选」的操作钮。两种控件不混在一处。
 *
 * YSIN 分数是**按需拉**的：切到 YSIN 才去要一次（一次请求拿全账号的角色，不按角色一个个要），
 * 拿回来的按「uid + 数据时间」缓存 —— 同一份数据只算一次，刷新过数据自然换一份新的。
 * 排序面板按 YSIN 分数排时也会来要一份（见 sort.js），所以这份缓存不只服务于显示。
 *
 * 卡片那边只认本模块给的数：roster.js 画卡片时问 ysinScoreOf(avatarId)；
 * 分数到位后由本模块回调 reg.paintRosterScores() 重画（只改那两个角的字，不重建卡片）。
 */

import { state, T, el, api, reg, banner } from '../../core.js'

/* 两种口径。文案直接用明细页那两个板块名（miaoSection / ysinSection），
   不另开一份词条表 —— 同一个名字在两处就该长一个样。 */
const MODES = [
  { key: 'miao', labelKey: 'miaoSection' },
  { key: 'ysin', labelKey: 'ysinSection' }
]

/* 缓存：key = 「uid + 数据时间」，value = avatarId → 分数。
   null = 这个角色没有适用流派（两边都该画破折号）；没这个键 = 还没拉到。 */
const cache = new Map()

/* 拉取失败的那几份数据：留着是为了把「读不到」和「还在读」分开 ——
   失败的画破折号（配合提示条），还在读的画省略号。失败不写进缓存，下次切换还会重试。 */
const failed = new Set()

/* 同一份数据只发一次请求：并发调用共用同一个 promise */
const inflight = new Map()

/* 缓存键带数据时间：刷新过之后 fetchedAt 变了，key 自然换新，旧的那份不会被误用 */
const cacheKey = () => `${state.uid}@${state.view?.fetchedAt || ''}`

/**
 * 某个角色的 YSIN 分数。
 *   undefined = 还没拉到（画成「…」）
 *   null      = 没有适用流派 / 读不到（画成「—」）
 *   { subScore, gearScore } = 分数本身（全精度，格式化交给显示层）
 */
export function ysinScoreOf (avatarId) {
  const key = cacheKey()
  const map = cache.get(key)
  if (!map) return failed.has(key) ? null : undefined
  const hit = map.get(avatarId)
  return hit === undefined ? null : hit
}

/* 取一份全账号的 YSIN 分数；同一份数据只发一次请求 */
async function loadScores () {
  const key = cacheKey()
  const hit = cache.get(key)
  if (hit) return hit
  const running = inflight.get(key)
  if (running) return running
  const uid = state.uid
  if (!uid) return null

  const task = (async () => {
    const res = await api(`accounts/${encodeURIComponent(uid)}/ysin`)
    const map = new Map()
    for (const s of res?.scores || []) {
      map.set(s.avatarId, s.subScore == null ? null : { subScore: s.subScore, gearScore: s.gearScore })
    }
    cache.set(key, map)
    failed.delete(key)
    return map
  })()
  inflight.set(key, task)
  try {
    return await task
  } catch (e) {
    /* 失败记在这份数据的键上：换账号后不会把上一份的失败算到新账上 */
    failed.add(key)
    throw e
  } finally {
    inflight.delete(key)
  }
}

/* 当前这份数据的 YSIN 分数到了没有 —— 排序面板要靠它判断「要不要先去拉一份」 */
export function scoresReady () {
  return cache.has(cacheKey())
}

/*
 * 保证当前这份数据有 YSIN 分数 —— 切口径、换账号重画首页、选了 YSIN 分数排序时都走这里。
 * 同一份数据只发一次请求（缓存命中直接返回）；失败只提示一次，不把页面卡在「读取中」。
 *
 * 不管当前是哪种口径都拉：排序面板在喵喵口径下也能按 YSIN 分数排，
 * 那时候同样需要这份数（见 sort.js）。
 */
export async function ensureScores () {
  try {
    await loadScores()
  } catch (e) {
    console.error('[ysin] 首页 YSIN 分数读取失败：', e)
    banner(T('ysinFail'), 'err')
  }
  reg.paintRosterScores?.()
}

/* 评分口径那颗按钮：文案永远是**当前**的那种口径，点一下换下一个（与「武器 / 圣遗物」同一套做法） */
export function scoreSwitch () {
  const btn = el('button', 'rf-switch-btn rf-score-btn')
  btn.type = 'button'
  const label = el('span', 'rf-switch-text', T(MODES[0].labelKey))
  btn.append(label)

  const paint = () => {
    const i = Math.max(0, MODES.findIndex(m => m.key === state.scoreMode))
    const mode = MODES[i]
    label.textContent = T(mode.labelKey)
    btn.dataset.mode = mode.key
  }

  btn.addEventListener('click', () => {
    const i = Math.max(0, MODES.findIndex(m => m.key === state.scoreMode))
    state.scoreMode = MODES[(i + 1) % MODES.length].key
    paint()
    /* 切回喵喵评分：数据已经在那儿了，直接重画两个角 */
    if (state.scoreMode !== 'ysin') {
      reg.paintRosterScores?.()
      return
    }
    /* 切到 YSIN：分数要算一会儿，先把两个角画成「…」等一等 */
    reg.paintRosterScores?.()
    void ensureScores()
  })

  paint()
  return btn
}
