/*
 * 通用弹窗 / 下拉面板壳（筛选、排序、模拟页共用）。
 *
 * 这一节原先整段放在 core.js 里，阶段 B 原样搬出来：函数名、参数、DOM 结构、
 * 事件绑定顺序一个都没改。core 只留「状态 + 工具 + 编排」，不再管界面壳子。
 *
 * 依赖方向：本模块 import ../core.js（只取 el / T），core 不 import 本模块。
 * 下面两个顶层监听靠入口 import './features/dialog.js' 在启动时装一次；
 * ES 模块是单例，被其它 feature 重复 import 也不会多装一遍。
 */

import { el, T } from '../core.js'

/* ───────────────────────── 下拉面板通用 ───────────────────────── */

/* 收面板的唯一入口：点面板外面、按 Esc、选了选项，都走这里 */
export function closeMenus () {
  for (const dd of document.querySelectorAll('.rf-dd.open')) dd.classList.remove('open')
}

/* ───────────────────────── 弹窗通用（筛选 / 排序共用） ─────────────────────────
 * 两处都是「点开一个大框、在里面勾完再确定」，壳子只写一份：
 * 遮罩 + 头（标题 + ×）+ 可滚内容区 + 底（可选清空 / 计数 / 取消 / 确定）。
 *
 * 三条规矩：
 * ① 同时只允许一个弹窗 —— 换 UID 重画、再点按钮，都先把旧的收掉（openDialog 开头做）。
 * ② Esc / 点遮罩 / 取消 = **丢弃**（什么都不写回）；确定才写回。
 * ③ 确定时**先关窗再回调**：回调里重画网格，开着窗重画会让窗后的内容和窗本身一起闪。 */

let openModal = null
let escHandler = null

export function closeModal () {
  if (!openModal) return
  openModal.remove()
  openModal = null
  if (escHandler) {
    removeEventListener('keydown', escHandler)
    escHandler = null
  }
}

/**
 * 开一个弹窗，返回 { body, count, close } —— 内容由调用方自己往 body 里塞。
 * onOk 在关窗之后调用；onClear 给了就在左下角出「清空」钮。
 */
export function openDialog ({ title, onOk, onClear }) {
  closeModal()

  const mask = el('div', 'rf-mask')
  const modal = el('div', 'rf-modal')
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')

  const head = el('div', 'rf-modal-head')
  head.append(el('span', 'rf-modal-title', title))
  const x = el('button', 'rf-modal-x')
  x.type = 'button'
  x.textContent = '×'
  x.addEventListener('click', () => closeModal())
  head.append(x)

  const body = el('div', 'rf-modal-body')

  const foot = el('div', 'rf-modal-foot')
  const count = el('span', 'rf-fpanel-count')
  let clear = null
  if (onClear) {
    clear = el('button', 'rf-fpanel-clear')
    clear.type = 'button'
    clear.textContent = T('filterClear')
    clear.addEventListener('click', onClear)
    foot.append(clear)
  }
  foot.append(count)
  const actions = el('div', 'rf-modal-actions')
  const cancel = el('button', 'rf-btn')
  cancel.type = 'button'
  cancel.textContent = T('filterCancel')
  cancel.addEventListener('click', () => closeModal())
  const ok = el('button', 'rf-btn primary')
  ok.type = 'button'
  ok.textContent = T('filterOk')
  ok.addEventListener('click', () => { closeModal(); onOk?.() })
  actions.append(cancel, ok)
  foot.append(actions)

  modal.append(head, body, foot)
  mask.append(modal)
  /* 点在遮罩上（而不是弹窗里）= 取消 */
  mask.addEventListener('click', e => { if (e.target === mask) closeModal() })
  document.body.append(mask)

  openModal = mask
  escHandler = (e) => { if (e.key === 'Escape') closeModal() }
  addEventListener('keydown', escHandler)
  ok.focus()
  return { modal, body, count, clear, close: closeModal }
}

/* 只在模块加载时装一次 —— 放进 renderFilterBar 会每重绘一次叠一个监听。
   closest 判「点在不在某个下拉里」：点按钮本身也算在里面，交给按钮自己的 toggle 处理。 */
addEventListener('click', e => { if (!e.target?.closest('.rf-dd')) closeMenus() })
addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus() })
