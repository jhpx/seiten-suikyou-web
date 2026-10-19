# seiten-suikyou-web · 星天水镜前端

原神角色养成评估器「星天水镜」的前端：纯静态站点，原生 ES 模块、零框架、零构建。
接口契约与部署形态见母仓库 [seiten-suikyou](https://github.com/jhpx/seiten-suikyou)（docs/API.md / docs/DEPLOY.md）。

## 目录

| 路径 | 干什么 |
| --- | --- |
| `index.html` | 入口 |
| `env.js` | **可选**的部署配置：`API_BASE` 指后端地址；没有这个文件时自动走同源 `/api` |
| `bootstrap.js` | 引齐各 feature 模块（加载时把渲染器注册进 core.reg） |
| `core.js` | 基座：全局 state / 取文案 T() / DOM 小工具 / 调后端 api / 视图切换与编排 |
| `roster.js` `filter.js` `sort.js` `detail.js` `history.js` `i18n.js` | 各管一摊的 feature 模块 |
| `miao.css` `style.css` | 样式 |
| `assets/` | 约 101MB 图片素材（角色立绘 / 套装图标 / UI 小图），**必须跟着前端一起发布** |

## 本地预览

没有构建步骤，任意静态服务器即可：

```bash
python -m http.server 8080        # 或者 npx serve
```

打开 http://127.0.0.1:8080/ 。页面要拉到数据，得指到后端：

- **同源**（本地推荐）：直接跑母仓库的 `npm run server`，访问 http://127.0.0.1:8787/ —— 页面、接口、图片全从根路径取，无需任何配置（`env.js` 删掉也照样跑，请求自动落到同源 `/api`）；
- **跨域**：把 `env.js` 里的 `API_BASE` 改成接口根地址（含 `/api` 这一段，如 `'https://gs.example.com/api'`，末尾不带 `/`），并确认后端放了对应 `--cors-origin`，否则浏览器拦掉请求。

> `core.js` 是**先试着加载** `env.js` 再定接口地址的：文件在就用它，不在（404）就用同源 `/api`。
> 所以想临时切回本地后端，不用改代码 —— 把 `env.js` 挪走刷新即可。

图片不用配：全是相对路径，浏览器按页面所在目录解析，Pages 那种 `/<仓库名>/` 子路径也自动落对位置。

## 发布到静态托管（GitHub Pages / 对象存储 / nginx）

前端零构建、没有打包编译，直接把本仓库整仓推上去即可：

- 跨域托管才需要 `env.js`：把里面的 `API_BASE` 改成你的接口根地址（**含 /api 这一段**，如 `'https://gs.example.com/api'`，末尾别带 `/`）。**同域名反代 `/api` 的话不用建这个文件**，页面自动走同源；
- `assets/` 约 101MB 图片素材**必须跟着一起发布**；
- 跨域：后端要加 `--cors-origin=<前端地址>`，否则浏览器拦掉请求。

## 图片素材同步

`assets/` 来自上游 miao-plugin，**统一在母仓库同步**：`npm run sync`（唯一入口，三步 miao → i18n → assets）。
同步完，素材的变动在本仓库提交；母仓库里对应更新子模块指针。

## 和母仓库的关系

母仓库 [seiten-suikyou](https://github.com/jhpx/seiten-suikyou) 以 git submodule 挂载本仓库：
clone 母仓库要带 `--recursive`（或 clone 后跑 `git submodule update --init`），否则本地起服务时页面 404。
