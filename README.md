# seiten-suikyou-web · 星天水镜前端

原神角色养成评估器「星天水镜」的前端：纯静态站点，原生 ES 模块、零框架、零构建。
接口契约与部署形态见母仓库 [seiten-suikyou](https://github.com/jhpx/seiten-suikyou)（docs/API.md / docs/DEPLOY.md）。

## 目录

| 路径 | 干什么 |
| --- | --- |
| `index.html` | 入口 |
| `env.js` | 部署配置：`API_BASE` 在这里配后端地址（只有前后端分开托管才用得上） |
| `bootstrap.js` | 引齐各 feature 模块（加载时把渲染器注册进 core.reg） |
| `core.js` | 基座：全局 state / 取文案 T() / DOM 小工具 / 调后端 api / 视图切换与编排 |
| `roster.js` `filter.js` `sort.js` `detail.js` `history.js` `i18n.js` | 各管一摊的 feature 模块 |
| `miao.css` `style.css` | 样式 |
| `assets/` | 约 101MB 图片素材（角色立绘 / 套装图标 / UI 小图），**必须跟着前端一起发布** |
| `tools/export_pages.py` | 导出可静态托管的目录（见下） |

## 本地预览

没有构建步骤，任意静态服务器即可：

```bash
python -m http.server 8080        # 或者 npx serve
```

打开 http://127.0.0.1:8080/ 。页面要拉到数据，得指到后端：

- **同源**（本地推荐）：直接跑母仓库的 `npm run server`，访问 http://127.0.0.1:8787/ —— 页面、接口、图片全从根路径取，无需任何配置；
- **跨域**：把 `env.js` 里 `export const API_BASE = ''` 填上后端地址（如 `'https://gs.example.com'`，末尾不带 `/`），并确认后端放了对应 `--cors-origin`，否则浏览器拦掉请求。

图片不用配：全是相对路径，浏览器按页面所在目录解析，Pages 那种 `/<仓库名>/` 子路径也自动落对位置。

## 发布到静态托管（GitHub Pages / 对象存储 / nginx）

```bash
python tools/export_pages.py --out dist/pages --api-base https://<你的后端地址>
```

导出 = 复制文件 + 把后端地址写进 `env.js` 的 `API_BASE`（零构建，没有打包编译）。
把 `dist/pages/` 整个推上去即可；`--no-assets` 跳过 101MB 素材，仅改样式图快用，正式发布别加。

## 图片素材同步

`assets/` 来自上游 miao-plugin，**统一在母仓库同步**：`npm run sync`（唯一入口，三步 miao → i18n → assets）。
同步完，素材的变动在本仓库提交；母仓库里对应更新子模块指针。

## 和母仓库的关系

母仓库 [seiten-suikyou](https://github.com/jhpx/seiten-suikyou) 以 git submodule 挂载本仓库：
clone 母仓库要带 `--recursive`（或 clone 后跑 `git submodule update --init`），否则本地起服务时页面 404。
