/*
 * 部署配置（可选）：API_BASE 是接口根地址（含 /api 这一段，别再写进各条接口路径）。
 * 存不存在都行 —— core.js 会先试着加载这个文件：
 *   文件在  → 用这里的 API_BASE；
 *   文件不在 → 自动退回同源 '/api'（页面和接口同一个域名时，比如本机 npm run server）。
 * 所以同源部署根本不需要这个文件，直接删掉也行；前后端分开托管时才写「带 /api 的完整地址」，
 * 并让后端加 --cors-origin=<前端地址> 放行跨域。
 * 没有构建步骤：浏览器运行时直接 import，改完保存刷新即生效。 */
export const API_BASE = 'https://seiten-suikyou.donneryst.com/api'
