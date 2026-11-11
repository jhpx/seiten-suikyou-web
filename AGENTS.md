# AGENTS.md —— 前端（`web/`）

本文件规定前端子仓库的开发约束，与母仓库根目录的 `AGENTS.md` 配合使用。通用规则以母仓库为准；本文件只补充前端特有的架构、交互、样式和验证要求。

`web/` 是独立 Git 子仓库 `seiten-suikyou-web`。修改前端时，应在该目录内检查和管理前端仓库的 Git 状态；母仓库只记录子仓库指针。

## 项目形态

前端是纯静态站点，使用原生 JavaScript ES 模块，不使用前端框架或构建步骤。浏览器直接加载模块，修改后通常刷新页面即可验证。

| 路径 | 职责 |
|---|---|
| `index.html` | 页面外壳：顶栏、视图容器、页脚；只引入 `bootstrap.js` |
| `bootstrap.js` | 引入 feature 模块、注册渲染器、初始化控制器并启动应用 |
| `core.js` | 共享状态、`T()` 文案读取、DOM 辅助函数、UID 校验与区服推断、后端 API、视图切换和跨模块编排（留在根，全站依赖它） |
| `env.js` | 可选部署配置；`API_BASE` 指定后端地址，缺省时使用同源 `/api` |
| `features/dialog.js` | **全站共用**：筛选 / 排序 / 模拟页共用的弹窗与下拉壳；顶层装两个全局监听（入口副作用引入） |
| `features/shot.js` | **全站共用**：「DOM 节点 → PNG → 浏览器下载」那一层（`showBusy` / `nodeToBlob` / `downloadBlob`）；按需动态导入 `vendor/modern-screenshot.js` |
| `features/region.js` | **全站共用**：顶栏区服在线状态胶囊，进页面读一次 `/api/health`（样式见 `css/region.css`） |
| `features/i18n.js` | **全站共用**：加载元数据、切换语言和静态文案 |
| `features/history.js` | **全站共用**：UID 历史记录，使用 `localStorage` |
| `features/roster/roster.js` | 首页：账号信息、角色网格和角色卡片 |
| `features/roster/filter.js` | 首页：筛选入口、视图切换和多选面板 |
| `features/roster/score.js` | 首页：评分口径切换（喵喵 / YSIN）与 YSIN 分数的按需拉取 |
| `features/roster/sort.js` | 首页：多条件排序（含 YSIN 的词条分 / 数据分，只管排序不过滤名单） |
| `features/roster/advice.js` | 首页：圣遗物刷取建议面板 |
| `features/roster/filter-options.js` | 首页：筛选项候选计算（元素 / 等级 / 套装 / 星级）+ 按条件过滤名单 |
| `features/sim/sim.js` | 模拟页：整页编排 `renderSim` + 入口 `openSim` + `reg.openSim` 注册 |
| `features/sim/sim-state.js` | 模拟页：目录 / 草稿 / 重算状态与读写（不含 DOM） |
| `features/sim/sim-cards.js` | 模拟页：角色头、属性表、武器与圣遗物卡、通用小部件 |
| `features/sim/sim-dialogs.js` | 模拟页：两个「改」弹窗与表单工具 |
| `features/sim/sim-damage.js` | 模拟页：左栏伤害、底部对比表与 Buff 列表（含相对当前配装的新增 / 失效 / 数值变化） |
| `features/detail/detail.js` | 明细页：角色详情画布和缩放（编排 renderDetail / loadRubric / onShare） |
| `features/detail/detail-card.js` | 明细页：武器 / 圣遗物卡片渲染 |
| `features/detail/detail-damage.js` | 明细页：伤害表加载与渲染 |
| `features/detail/detail-ysin.js` | 明细页：YSIN 独立评分板块加载与渲染（含流派切换零请求重画） |
| `features/detail/detail-fit.js` | 明细页：页面适配（fitLongText / fitSelectText / fitDetailScale） |
| `features/detail/detail-screenshot.js` | 明细页：截图下载；量画布尺寸、等 YSIN 评分与伤害表两块定型后调 `features/shot.js` 出图 |
| `features/report/report.js` | 报告单：渲染一张 `.rp-sheet`（纯渲染，不碰下载） |
| `features/report/report-shot.js` | 报告单导出：排到视口外一块固定 600 宽的「纸」上 → 出图 → 下载；注册 `reg.exportReport` |
| `css/` | 按组件 / 功能模块拆分的样式文件；`index.html` 的 `<link>` 顺序就是层叠顺序 |
| `assets/` | 从上游同步的图片素材，随前端发布 |

`features/` 根目录放全站共用模块，页面各占一个子目录 `roster/` / `detail/` / `sim/` / `report/`。
根模块写 `import '../core.js'`；页面子目录里的模块回根要写 `import '../../core.js'`，
取根上的共用模块写 `../dialog.js` 这种一层路径。`bootstrap.js` 负责副作用引入每个页面模块。

`sim/` 内部依赖保持单向，别反过来 import：
`core.js` → `sim-state.js` → { `sim-dialogs.js` → `sim-cards.js` } / `sim-damage.js` → `sim.js`（编排）。
`recompute()` 算完要重画页面，用 `setRedraw()` 把回调注进状态层，避免状态层反向 import 编排层形成环。

开始修改前，以实际文件和当前实现为准核对上表；文件职责可能随项目演进调整，不要仅为匹配本表而重命名或移动文件。

## 架构与依赖方向

- `core.js` 不直接导入 feature 模块。由入口引入 feature，并将渲染器注册到 `core.reg`；core 通过注册表回调渲染器，以避免 core 与 feature 形成循环依赖。
- feature 之间的导入应保持克制。若确实需要复用功能，优先考虑无副作用的共享辅助函数；确有明确依赖时可以导入其他 feature，但要避免循环依赖和隐式初始化顺序。
- 模块顶层的注册代码属于启动流程的一部分。新增注册逻辑时，确保入口会加载对应模块，并检查模块加载顺序。`features/dialog.js` 的全局监听同理，由 `bootstrap.js` 显式副作用引入。
- `features/roster/filter-options.js` 只依赖 `core.js`：`filter.js` 从它取筛选项候选、`roster.js` 从它取 `filteredAvatars()`，模块之间不必互相 import。候选计算和按条件过滤都属于这一层，别再往 `core.js` 或 `sort.js` 塞。
- 后端负责提供业务数据、评分结果和本地化文本；前端负责呈现与交互。不要在前端复制后端已有的业务规则或硬编码由后端提供的游戏数据和本地化词条。

## 样式模块与加载顺序

样式放在 `css/`，按组件和功能模块拆分；每个文件头写明职责、原文件来源和加载序号。
`index.html` 里 `<link>` 的**先后顺序就是层叠顺序**（后面的文件覆盖前面同特异性的规则），不要随意调整。
新增或拆分样式文件时，同步更新 `index.html` 与 `test/server.ts` 里的顺序断言，
并用 `tools/probe.ts` 对比计算样式、`tools/shot.ts` 对比截图，确认显示效果不变。

顺序分组（完整清单见 `index.html`）：基础层 `base` → 通用组件 `form` / `button` / `topbar` / `region` / `layout`
→ 首页模块 `advice` / `dialog`（弹窗 / 下拉壳）/ `filter` / `char-card` → 页面状态 `page-states` → 模拟页 `sim` → 报告单 `report`
→ 评分规则 `rubric` → 明细页评分卡 `detail-base` / `score-card` / `item-card` / `ysin` / `damage`（前四个里除 `ysin` 外是原 `miao.css` 的移植部分，`ysin` 是新增的独立评分区）。
`ysin.css` 必须排在 `damage.css` 之前：`test/server.ts` 钉住了 `damage.css` 是最后一个。

两处容易改错的层叠依赖：

- `score-card.css` 末尾的「评分区底色」是整张评分卡所有 `background` 的唯一出处，上面的布局规则不写底色；改深浅只动这一节。
- `sim.css` 对 `item-card.css` 的装备卡覆盖靠 `#view-sim` 前缀提高特异性，不要改成不带前缀的通用选择器。
- CSS 文件比页面多一层目录，里面的图片路径要写 `url("../assets/...")`；JS 里 `setBg()` 写的行内样式仍相对 `index.html`，不用改。

### 视图 ↔ 样式模块映射

`index.html` 里两个 `<div class="view">` 同页并存，19 个 `<link>` 一次性全部加载，
**没有「按页面加载样式」这回事**。改某个页面时按这张表找样式，别按目录猜：

| 视图 / 区域 | 参与渲染的 CSS 模块 |
|---|---|
| 全站外壳（顶栏、按钮、表单、提示条、页脚、加载态） | `base` `form` `button` `topbar` `layout` `page-states` |
| 首页 `#view-roster` | 全站外壳 + `advice` `filter` `char-card` |
| 明细页 `#view-detail` | 全站外壳 + `rubric` `detail-base` `score-card` `item-card` `ysin` `damage` |
| 模拟页 `#view-sim` | 全站外壳 + `dialog`（弹窗壳 / 下拉）+ `item-card`（装备卡底）+ `sim` |
| 报告单（无视图，离屏渲染后出图） | `report`（`.rp-sheet` 本体 + `.rp-offscreen` 那块离屏的纸） |

两处跨页复用容易漏：

- `dialog.css` 的 `.rf-mask` / `.rf-modal` / `.rf-btn` / `.rf-dd` / `.rf-menu` 被模拟页的两个「改」弹窗复用（`.rf-opt` 选项仍是 `filter.css` 的内容），**它不是首页专属**。
- `item-card.css` 的 `.item.weapon` / `.item.arti` 被模拟页复用，`sim.css` 里 50 处 `#view-sim` 前缀规则覆盖它。

JS 按页面分目录、CSS 按层叠层平铺，是刻意的不对称：CSS 全量加载且加载顺序是全局契约，
挪进页面目录既不会缩小作用域，还会让人顺手重排 `<link>`。跨页归属靠上表记录，不靠物理位置。

## 样式与浏览器扩展兼容

部分广告拦截扩展会依据 CSS 选择器隐藏特定名称的元素。新增类名时，避免使用容易触发广告过滤规则的独立词段或常见模式，例如 `ad`、`ads`、`advert`、`advertisement`、`adv`，以及这些词段组成的类名或 CSS 自定义属性名。

不要把规则扩大成禁止所有包含字母 `ad` 的名称；这会误伤 `header` 等正常命名。遇到元素被隐藏时，应检查实际扩展规则和浏览器开发者工具，不要仅凭类名猜测原因。

## 交互约定

- 新增交互控件时，优先使用语义正确的原生 HTML 元素
- 不新增仅依赖鼠标 hover 才能获得的关键信息。触屏设备没有稳定的 hover 行为；重要说明应直接可见，或使用能通过触摸和键盘操作的明确交互。
- 不使用 `title` 属性作为唯一的信息提示方式。若确有补充说明需求，应根据内容选择可见文本、可访问的说明区域或适合触屏的交互，而不是默认增加悬浮提示。
- 不做键盘可达性和焦点样式。本项目面向手机触屏，可点的整块区域用普通元素加点击事件即可。
- 尽量使用纯图标按钮不配任何文字说明，图标本身就是表意控件。

## JavaScript 风格

本项目使用浏览器原生 JavaScript，不使用 TypeScript 类型标注，也没有前端构建步骤。除非任务明确要求改变项目形态，否则沿用以下风格：

- 使用单引号；字符串内容本身需要双引号的情况除外。
- 不写语句结束分号，注意避免自动分号插入造成的歧义。
- 使用 2 个空格缩进，不使用 Tab。
- 优先使用 `const`，需要重新赋值时使用 `let`，不使用 `var`。
- 合理使用可选链 `?.`、空值合并 `??` 等现代 JavaScript 语法；考虑项目支持的浏览器环境。
- 短小、表达式式的工具函数可以使用箭头函数；包含多步逻辑的函数优先使用 `function` 声明。不要为了遵守形式而拆分逻辑或降低可读性。
- 文件末尾保留一个换行。

## DOM 与安全

- 创建 DOM 节点时优先使用 `core.js` 提供的 `el()`、`setBg()` 等辅助函数；若辅助函数不能清晰表达需求，可以使用原生 DOM API，不必为了形式强行封装。
- 将接口返回值、用户数据和其他外部数据作为文本处理，优先使用 `textContent`，不要将其拼接进 `innerHTML`。
- `innerHTML` 仅在确有必要时用于清空容器或写入完全固定、无外部数据的 SVG/HTML 片段。清空容器也可以使用 `replaceChildren()`。
- 新增 DOM 操作时，检查数据是否可能来自接口、URL、存储或用户输入；不要假定这些数据天然可信。

## 国际化（i18n）

- 不要在模块顶层常量初始化时调用 `T()`。应用初始化时 `state.ui` 可能尚未加载，过早调用可能把未翻译的键保存为常量。需要延迟解析的文案保存键值，并在渲染时调用 `T()`。
- 静态 UI 文案以母仓库后端 `src/common/ui.ts` 和 `/api/meta` 返回的数据为准。新增或修改文案时，先检查后端文案表和接口契约；需要修改后端时，遵循母仓库的开发规则。
- 角色、部位、属性、套装等业务名称应使用后端提供的本地化数据，不要在前端另建一份重复词条表。
- 图标缺失就让它空着 —— 不准硬编码，但可以用后端已有的名字字段（`posName` 等）补位。

## 调试与验证

样式或布局问题应先在目标浏览器和目标视口复现，再结合 DOM 测量与截图判断，不要仅凭代码推断视觉结果。

在母仓库根目录运行以下工具：

```bash
node tools/probe.ts <url> <表达式文件> [截图png]
node tools/shot.ts <url> <png> [宽,高]
```

- `probe.ts` 用于测量 DOM 并与预期结果进行逐字节比较。只有在存在合适的表达式和基线时，才能把 diff 作为有效验收依据。
- `shot.ts` 用于查看实际布局。截图应覆盖受影响的页面和视口。
- 项目使用 `cqw` 等容器查询单位时，手机布局需要切换视口验证，例如设置 `PROBE_WIN=390,844`。
- 如果某台设备表现异常而另一台正常，可以使用无痕窗口作为排查手段。无痕模式恢复正常说明问题可能与扩展、缓存、站点数据或浏览器配置有关，但不能据此直接断定代码没有问题；仍应根据开发者工具和复现结果确认原因。
- 若工具无法运行或没有可比较的基线，应说明限制，并使用可行的替代验证方式。

## 禁止事项与架构边界

- 不擅自引入前端框架、打包器、`package.json` 或 `node_modules`。当前零构建形态是项目约定；如果任务确实需要改变它，先说明收益、代价和部署影响，征得用户同意。
- 不硬编码由后端 locale 提供的游戏名称、部位、属性、套装名等业务文本。
- 不在模块顶层常量中调用 `T()`。
- 不让 `core.js` 直接导入 feature 模块。
- 不使用 `title` 属性作为提示信息的唯一来源。
- 不对 `assets/` 中的同步素材做手工修改。素材由母仓库的同步流程生成；确需修改时，先确认上游来源和同步方式，再通过 `npm run sync` 更新。
- 不在前端子仓库中加入后端代码。
- 不执行内容哈希改名，除非任务明确要求并已评估静态资源引用、缓存和部署影响。

## 发布

前端是纯静态站点，可部署到静态文件服务器或 GitHub Pages。后端独立运行；跨域配置见母仓库 `docs/DEPLOY.md`。发布前确认 `assets/` 与前端代码一同部署，并核对 `env.js`、API 地址和实际部署子路径。
