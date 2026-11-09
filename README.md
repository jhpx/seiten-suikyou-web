# seiten-suikyou-web · 星天水镜前端

原神角色养成评估器「星天水镜」的前端：纯静态站点，原生 ES 模块、零框架、零构建。
接口契约与部署形态见母仓库 [seiten-suikyou](https://github.com/jhpx/seiten-suikyou)（docs/API.md / docs/DEPLOY.md）。

## 目录

```text
web/
├── index.html            #   外壳（顶栏 / 视图容器 / 页脚），只引入 bootstrap.js
├── bootstrap.js          #   入口：引齐 feature 模块（副作用注册渲染器）+ 控制器 + 启动
├── core.js               #   基座：state / 取文案 T() / DOM 小工具 / 调后端 api / 视图切换与编排
├── env.js                #   可选部署配置（API_BASE 指定后端地址，缺省走同源 /api）
├── css/                  #   按模块拆分的样式（17 个文件，<link> 顺序 = 层叠顺序）
│   ├── base.css          #   设计令牌 / reset / 整页等比缩放外壳
│   ├── form.css          #   输入控件（输入框、下拉、focus）
│   ├── button.css        #   按钮全族（含返回 / 分享 / 进模拟）
│   ├── topbar.css        #   顶栏骨架
│   ├── region.css        #   区服在线状态胶囊（与 region.js 配对）
│   ├── layout.css        #   提示条 / 主容器 / 视图切换 / 账号头
│   ├── advice.css        #   刷取建议面板
│   ├── dialog.css        #   弹窗 / 下拉壳（与 dialog.js 配对）
│   ├── filter.css        #   筛选条 / 排序 / 弹窗与选项内容（壳见 dialog.css）
│   ├── char-card.css     #   角色卡片网格（武器 / 套装两态）
│   ├── page-states.css   #   明细页外壳 / 占位 / 加载蒙版 / 页脚
│   ├── sim.css           #   模拟比对页（含对装备卡的覆盖）
│   ├── rubric.css        #   评分规则下拉
│   ├── detail-base.css   #   明细页画布 / 立绘 / 属性表 / 命座
│   ├── score-card.css    #   圣遗物总分卡与评分区底色
│   ├── item-card.css     #   武器与 5 件圣遗物卡 / 档位色
│   └── damage.css        #   伤害计算表
├── assets/               #   图片素材（约 101MB，随子仓库提交，必须跟着前端发布）
└── features/             #   JS 模块：根 = 全站共用，子目录 = 页面专属
    ├── dialog.js         #   共用：弹窗 / 下拉壳 + 两个全局监听（入口副作用引入）
    ├── region.js         #   共用：顶栏区服在线状态（读一次 /api/health）
    ├── i18n.js           #   共用：loadMeta / 切语言 / 静态文案
    ├── history.js        #   共用：UID 历史（localStorage）
    ├── roster/           #   首页 5 个模块
    │   ├── roster.js         #   账号头 + 角色网格 + 卡片（武器 / 圣遗物两种视图）
    │   ├── filter.js         #   筛选条 = 排序｜视图切换｜漏斗多选面板
    │   ├── sort.js           #   多条件排序（只管排序，不过滤名单）
    │   ├── advice.js         #   圣遗物刷取建议面板
    │   └── filter-options.js #   筛选项候选计算 + 按条件过滤名单
    ├── sim/              #   模拟页 5 个模块（依赖单向：state → dialogs → cards → 编排）
    │   ├── sim.js            #   整页编排 renderSim + 入口 openSim
    │   ├── sim-state.js      #   目录 / 草稿 / 重算状态与读写
    │   ├── sim-cards.js      #   角色头 / 属性表 / 武器与圣遗物卡
    │   ├── sim-dialogs.js    #   两个「改」弹窗与表单工具
    │   └── sim-damage.js     #   左栏伤害与底部对比表
    └── detail/           #   明细页 5 个子模块
        ├── detail.js             #   编排：renderDetail + loadRubric + onShare
        ├── detail-card.js        #   卡片渲染（武器 / 圣遗物卡）
        ├── detail-damage.js      #   伤害表加载与渲染
        ├── detail-fit.js         #   页面适配（fitLongText / fitSelectText / fitDetailScale）
        └── detail-screenshot.js  #   截图下载（按需动态导入截图依赖）
```

页面目录里的模块回根取 `../../core.js`，取根上的共用模块写 `../dialog.js`。
`sim/` 的状态层用 `setRedraw()` 注入重绘回调，避免状态层反向 import 编排层形成环。

## 样式加载顺序

`index.html` 里 `<link>` 的先后顺序就是层叠顺序：后面的文件覆盖前面同特异性的规则。
新增或调整样式模块时，先看 `AGENTS.md` 的「样式模块与加载顺序」，再同步 `index.html` 与母仓库的顺序断言。
三个视图同页并存、17 个 `<link>` 一次性全部加载，所以 CSS 不按页面分目录；哪个页面用到哪些样式，查 `AGENTS.md` 的「视图 ↔ 样式模块映射」。

## 本地预览

没有构建步骤，任意静态服务器即可。要连后端就在母仓库根目录跑 `npm run server`（默认 `http://127.0.0.1:8787`），它直接把这个目录当静态根。

## 图片素材同步

`assets/` 来自上游 miao-plugin，**统一在母仓库同步**：`npm run sync`（唯一入口，三步 miao → i18n → assets）。
同步完，素材的变动在本仓库提交；母仓库里对应更新子模块指针。

## 上游与致谢

### miao-plugin

评分算法、角色数据，以及这里的 `assets/` 图片素材，全部来自
[yoimiya-kokomi/miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin) —— 一个 Yunzai-Bot 的角色面板 / 角色查询插件。

- 作者：Yoimiya（[@yoimiya-kokomi](https://github.com/yoimiya-kokomi)）
- 许可：[MIT License](https://github.com/yoimiya-kokomi/miao-plugin/blob/master/LICENSE)，Copyright (c) 2023 Yoimiya


### 数据来源

- **角色面板数据**：由 [Enka.Network](https://enka.network/) 提供，miao-plugin 已获 Enka 官方授权（见其 issue #63）。
- **多语言文案（i18n）**：角色 / 武器 / 套装 / 词条名来自 Enka 的 `store/gi/` 原样文件；圣遗物部件名来自
  [Dimbreath/AnimeGameData](https://gitlab.com/Dimbreath/AnimeGameData) 的 TextMap 提取件（Enka 不收录部件名）。
  这一路**与 miao-plugin 无关**，由母仓库的 `tools/sync_i18n.py` 直接同步。

上游还致谢了 MiniGG-Api（@MiniGrayGay）与 Snap.Hutao（DGP Studio 胡桃 API），一并致谢。

### 素材与非商业声明

上游声明其「图片与其他素材均来自于网络，仅供交流学习使用，如有侵权请联系，会立即删除」。
本项目同样**不用于任何盈利目的**；若权利人提出异议，会立即移除相关素材。

原神（Genshin Impact）及其角色、图标等素材版权归米哈游（miHoYo / HoYoverse）所有，本项目与米哈游无隶属关系。
