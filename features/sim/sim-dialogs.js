/*
 * 模拟比对页的两个「改」弹窗：改武器（型号 / 等级 / 精炼）与改圣遗物（套装 / 星级 / 等级 / 主副词条）。
 * 它们共用通用弹窗壳 ../dialog.js，内容由本文件自己填；表单小工具也只服务这两个弹窗，一并放这儿。
 *
 * 从原 sim.js 原样搬出，只把共享状态与草稿读写改成从 sim-state.js 引入。
 */

import { T, el } from '../../core.js'
import { openDialog } from '../dialog.js'
import {
  sim, currentAvatar, ensureCatalog,
  draftWeapon, setDraftWeapon,
  draftOfPos, defaultDraftOf, setDraftArtifact
} from './sim-state.js'

/* 点「改」武器：先等目录，确保弹窗里自带武器带 affixText（否则简介空白）。 */
export async function openWeapon () {
  await ensureCatalog()
  openWeaponDialog()
}

/* 改武器：型号 / 等级 / 精炼（草稿存 1 基等级，与 profile.weapon.level 同口径）。 */
function openWeaponDialog () {
  const draft = draftWeapon()
  const equipped = currentAvatar()?.weapon
  const dlg = openDialog({
    title: T('simWeaponTitle'),
    onOk: () => {
      setDraftWeapon({
        itemId: Number(wSel.value),
        level: Number(lvSel.value),
        affix: Number(afSel.value)
      })
    }
  })

  const body = dlg.body
  /* 多一栏简介，放宽弹窗（窄屏仍整屏宽）。 */
  body.parentElement?.classList.add('sim-wwide')

  const wrap = el('div', 'sim-wbody')
  const form = el('div', 'sim-wform')

  /* 型号：目录后端已按角色武器类型滤过（迪奥娜只有弓），三星到五星一律标★。 */
  const list = [...(sim.catalog?.weapons || [])]
  /* 当前武器不在目录里（miao 不认识）时补一项，否则下拉落到第一项、看着像没选中。 */
  if (draft.itemId && !list.some(w => w.itemId === draft.itemId)) {
    list.unshift({ itemId: draft.itemId, name: equipped?.name || T('noWeapon'), star: equipped?.star || 0, affixText: '', affixVals: [], main: null, sub: null })
  }
  const wSel = el('select', 'sim-select')
  for (const w of list) {
    const o = el('option', '', w.star ? `${w.name} ${w.star}★` : w.name)
    o.value = String(w.itemId)
    if (w.itemId === draft.itemId) o.selected = true
    wSel.append(o)
  }
  form.append(field(T('simWeaponType'), wSel))

  /* 等级档位由选中武器给（main.values 的键就是档位），别写死 [1,20,…,90]（低星会选到升不到的档）。
     值即 1 基等级，别 -1（那是圣遗物口径）。 */
  const lvSel = el('select', 'sim-select')
  const drawLevels = (initial) => {
    const picked = list.find(x => String(x.itemId) === wSel.value)
    const lvs = Object.keys(picked?.main?.values || {}).map(Number).sort((a, b) => a - b)
    /* 无档位数据（miao 不认识的新武器）退回常规档位。 */
    if (!lvs.length) lvs.push(1, 20, 40, 60, 70, 80, 90)
    const max = lvs[lvs.length - 1]
    let keep = initial ? (draft.level || 1) : (Number(lvSel.value) || draft.level || 1)
    /* 初次打开按真实等级显示（可能是 50/55 这种非档位值），不补会落到第一项像被重置。 */
    if (initial && keep <= max && !lvs.includes(keep)) {
      lvs.push(keep)
      lvs.sort((a, b) => a - b)
    }
    /* 换武器后档位表变了，keep 不在新表里就收敛到不超过它的最大档（否则 select 赋不存在值变空串）。 */
    if (!lvs.includes(keep)) {
      const under = lvs.filter(lv => lv <= keep)
      keep = under.length ? under[under.length - 1] : lvs[0]
    }
    lvSel.innerHTML = ''
    for (const lv of lvs) {
      const o = el('option', '', `Lv.${lv}`)
      o.value = String(lv)
      lvSel.append(o)
    }
    lvSel.value = String(keep)
  }
  drawLevels(true)
  form.append(field(T('simLevel'), lvSel))

  const afSel = el('select', 'sim-select')
  for (const a of [1, 2, 3, 4, 5]) {
    const o = el('option', '', `${T('refine')}${a}`)
    o.value = String(a)
    if (a === draft.affix) o.selected = true
    afSel.append(o)
  }
  form.append(field(T('refine'), afSel))

  /* 右侧：主/副属性 + 简介，随两个下拉走（等级改属性、精炼改简介里的数值）。 */
  const info = el('div', 'sim-winfo')
  const stats = el('div', 'sim-wstats')
  const desc = el('div', 'sim-wdesc-body')
  const drawInfo = () => {
    const picked = list.find(x => String(x.itemId) === wSel.value)
    const lv = lvSel.value
    stats.innerHTML = ''
    /* 值按选中等级档取，没有就空着（不编数）。 */
    if (picked?.main) stats.append(weaponInfoRow(picked.main.label, picked.main.values?.[lv] || ''))
    if (picked?.sub) stats.append(weaponInfoRow(picked.sub.label, picked.sub.values?.[lv] || ''))

    /* 简介模板 $[0] $[1] 换成当前精炼档数值并高亮（标出跟着精炼变的那几个数）。
       1★/2★ 无精炼效果，整段为空 → 占位。 */
    desc.innerHTML = ''
    if (!picked?.affixText) {
      desc.append(document.createTextNode(T('noData')))
      return
    }
    for (const [i, part] of picked.affixText.split(/\$\[(\d+)\]/).entries()) {
      if (i % 2 === 0) {
        if (part) desc.append(document.createTextNode(part))
      } else {
        const v = (picked.affixVals?.[Number(part)] || [])[Number(afSel.value) - 1]
        if (v) desc.append(el('span', 'sim-whl', v))
      }
    }
  }
  wSel.addEventListener('change', () => { drawLevels(false); drawInfo() })
  lvSel.addEventListener('change', drawInfo)
  afSel.addEventListener('change', drawInfo)

  info.append(stats, desc)
  wrap.append(form, info)
  body.append(wrap)
  drawInfo()
}

/* 改武器弹窗右侧信息栏的一行（主/副属性单值，无旧值可比，别与武器卡对比行混用）。 */
function weaponInfoRow (label, value) {
  const row = el('div', 'sim-wstat')
  row.append(el('span', 'sim-wstat-k', label), el('span', 'sim-wstat-v', value))
  return row
}

/* 点「改」圣遗物：先等目录，确保弹窗里套装/主词条候选齐全。 */
export async function openArti (a) {
  await ensureCatalog()
  openArtiDialog(a)
}

/* 改一件圣遗物：套装（带星级）/ 等级 / 主词条 / 副词条。 */
function openArtiDialog (a) {
  const draft = draftOfPos(a.pos) || defaultDraftOf(a)
  const dlg = openDialog({
    title: `${T('simEdit')} · ${a.posName}`,
    onOk: () => {
      const next = {
        set: setSel.value,
        pos: a.pos,
        star: starOf(),
        level: Number(lvSel.value),
        mainKey: mainSel ? mainSel.value : fixedMainKey,
        subs: subs.map((s) => ({
          key: s.keySel.value,
          value: Number(s.valInput.value)
        }))
      }
      setDraftArtifact(next)
    }
  })

  const body = dlg.body

  /* 套装：只列有这个部位的（「祭雷之人的花」后端认不出会整件跳过、值被染模拟色却没变）。
     !x.positions 是给前端比后端新时的兜底（web 可能先发，老接口无此字段就不过滤）。 */
  const setOpts = (sim.catalog?.sets || []).filter(x => !x.positions || x.positions.includes(a.pos))
  const setSel = el('select', 'sim-select')
  for (const s of setOpts) {
    const o = el('option', '', s.star ? `${s.name} ${s.star}★` : s.name)
    o.value = s.key
    if (s.key === draft.set) o.selected = true
    setSel.append(o)
  }
  body.append(field(T('simSet'), setSel))

  /* 星级由套装决定（4★ 满级 +16，5★ 能 +20）。取 min(原星级, 套装最高)：5★ 套装里穿 4★ 件
     直接按套装最高会悄悄升星、主词条变一截。 */
  const starOf = () => Math.min(draft.star || 5, setOpts.find(s => s.key === setSel.value)?.star || 5)

  /* 等级：草稿存 enka 原始 1 基（1..21），玩家读「+N」（0..20），标签显示 lv-1。
     上限跟星级走（4★ 只 +16），档位表从目录拿。 */
  const lvSel = el('select', 'sim-select')
  const drawLevels = () => {
    const keep = Number(lvSel.value) || draft.level || 1
    const max = (sim.catalog?.starLevels || []).find(x => x.star === starOf())?.maxLevel ?? 21
    lvSel.innerHTML = ''
    for (let lv = 1; lv <= max; lv += 4) {
      const o = el('option', '', `+${lv - 1}`)
      o.value = String(lv)
      lvSel.append(o)
    }
    lvSel.value = String(Math.min(keep, max))
  }
  setSel.addEventListener('change', drawLevels)
  drawLevels()
  body.append(field(T('simLevel'), lvSel))

  /* 主词条：花/羽固定（后端只给一项），写只读文字；沙/杯/冠才给下拉。 */
  const mainOpts = (sim.catalog?.mains || []).find(m => m.pos === a.pos)?.options || []
  const fixedMainKey = mainOpts[0]?.key || draft.mainKey
  let mainSel = null
  if (mainOpts.length > 1) {
    mainSel = el('select', 'sim-select')
    for (const m of mainOpts) {
      const o = el('option', '', m.name)
      o.value = m.key
      if (m.key === draft.mainKey) o.selected = true
      mainSel.append(o)
    }
    body.append(field(T('simMainStat'), mainSel))
  } else {
    /* 单项用当前装备主词条 label（后端中文名）。别用 mainOpts[0].name —— 花/羽候选的 name 就是 key 本身。 */
    body.append(field(T('simMainStat'), el('span', 'sim-rofn', a.main?.label || fixedMainKey)))
  }

  /* 副词条：类型下拉 + 数值输入，类型候选标出大小。 */
  const subsBox = el('div', 'sim-subs')
  const subs = (draft.subs || []).map(s => ({
    keySel: keySelect(s.key),
    valInput: numberInput(s.value)
  }))
  const drawSubs = () => {
    subsBox.innerHTML = ''
    for (const s of subs) {
      const row = el('div', 'sim-subrow')
      const del = el('button', 'sim-subdel', '×')
      del.type = 'button'
      del.addEventListener('click', () => {
        const i = subs.indexOf(s)
        if (i >= 0) subs.splice(i, 1)
        drawSubs()
      })
      row.append(s.keySel, s.valInput, del)
      subsBox.append(row)
    }
    /* 最多 4 条副词条，满了就不画「加一条」（比点了没反应的灰按钮清楚）。 */
    if (subs.length < 4) {
      const add = el('button', 'sim-submore', '+ ' + T('simAddStat'))
      add.type = 'button'
      add.addEventListener('click', () => {
        const first = (sim.catalog?.subs || [])[0]
        if (!first || subs.length >= 4) return
        subs.push({ keySel: keySelect(first.key), valInput: numberInput(0) })
        drawSubs()
      })
      subsBox.append(add)
    }
  }
  drawSubs()
  body.append(fieldGroup(T('simSubStats'), subsBox))
}

/* 副词条类型下拉（标出大小词条）。 */
function keySelect (cur) {
  const sel = el('select', 'sim-select sim-subkey')
  for (const opt of sim.catalog?.subs || []) {
    const o = el('option', '', opt.name)
    o.value = opt.key
    if (opt.key === cur) o.selected = true
    sel.append(o)
  }
  return sel
}

/* 数值输入框。 */
function numberInput (value) {
  const inp = el('input', 'sim-input')
  inp.type = 'number'
  inp.step = '0.1'
  inp.value = String(value)
  return inp
}

function field (label, control) {
  const d = el('label', 'sim-field')
  d.append(el('span', '', label), control)
  return d
}

/*
 * 成组字段（副词条那一摞）：**不能用 <label> 包**。
 * label 的激活行为会把「框里任何一次落在非控件上的点击」转给它的标注控件，而标注控件是
 * 框内第一个可标注元素 —— 这里是**第一条副词条的下拉框**。于是点行尾 × 时只要擦到边缘
 * （或者点行间缝隙 / 标签文字），手机就会把这次点击当成点了那个下拉，原生选择器直接弹出来，
 * 选完就把第一条副词条改掉了（桌面端只表现为下拉闪一下，不容易察觉）。
 * 组字段没有「唯一对应的那个控件」，所以用 <div>：外观一致，但没有 label 的转发语义。
 */
function fieldGroup (label, node) {
  const d = el('div', 'sim-field')
  d.append(el('span', '', label), node)
  return d
}
