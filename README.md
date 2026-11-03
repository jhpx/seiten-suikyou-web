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
├── style.css             #   外壳样式
├── miao.css              #   评分卡样式（miao 的 profile-detail.css 移植版）
├── assets/               #   图片素材（约 101MB，随子仓库提交，必须跟着前端发布）
└── features/             #   业务模块（各自 import ../core.js，经 reg 注册渲染器）
    ├── roster.js         #   feature：账号头 + 角色网格 + 卡片（武器 / 圣遗物两种视图）
    ├── filter.js         #   feature：筛选条 = 排序｜视图切换｜漏斗多选面板
    ├── sort.js           #   feature：多条件排序（至多 3 字段的排序链）
    ├── advice.js         #   feature：圣遗物刷取建议面板
    ├── sim.js            #   feature：模拟比对页面
    ├── i18n.js           #   feature：loadMeta / 切语言 / 静态文案
    ├── history.js        #   feature：UID 历史（localStorage）
    └── detail/           #   明细页子模块（import ../../core.js）
        ├── detail.js             #   编排：renderDetail + loadRubric + onShare
        ├── detail-card.js        #   卡片渲染（武器 / 圣遗物卡）
        ├── detail-damage.js      #   伤害表加载与渲染
        ├── detail-fit.js         #   页面适配（fitLongText / fitSelectText / fitDetailScale）
        └── detail-screenshot.js  #   截图下载（按需动态导入截图依赖）
```

## 本地预览

没有构建步骤，任意静态服务器即可。要连后端就在母仓库根目录跑 `npm run server`（默认 `http://127.0.0.1:8787`），它直接把这个目录当静态根。

## 图片素材同步

`assets/` 来自上游 miao-plugin，**统一在母仓库同步**：`npm run sync`（唯一入口，三步 miao → i18n → assets）。
同步完，素材的变动在本仓库提交；母仓库里对应更新子模块指针。

## 上游与致谢

### miao-plugin

评分算法、角色数据、i18n 文案，以及这里的 `assets/` 图片素材，全部来自
[yoimiya-kokomi/miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin) —— 一个 Yunzai-Bot 的角色面板 / 角色查询插件。

- 作者：Yoimiya（[@yoimiya-kokomi](https://github.com/yoimiya-kokomi)）
- 许可：[MIT License](https://github.com/yoimiya-kokomi/miao-plugin/blob/master/LICENSE)，Copyright (c) 2023 Yoimiya


### 数据来源

角色面板数据由 [Enka.Network](https://enka.network/) 提供，miao-plugin 已获 Enka 官方授权（见其 issue #63）。
上游还致谢了 MiniGG-Api（@MiniGrayGay）与 Snap.Hutao（DGP Studio 胡桃 API），一并致谢。

### 素材与非商业声明

上游声明其「图片与其他素材均来自于网络，仅供交流学习使用，如有侵权请联系，会立即删除」。
本项目同样**不用于任何盈利目的**；若权利人提出异议，会立即移除相关素材。

原神（Genshin Impact）及其角色、图标等素材版权归米哈游（miHoYo / HoYoverse）所有，本项目与米哈游无隶属关系。
