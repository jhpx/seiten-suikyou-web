/*
 * 部署配置：API_BASE 是接口根地址（含 /api 这一段，别再写进各条接口路径）。
 * 同源部署（npm run server 既给页面又给接口）默认 '/api'，一般不用改；
 * 前后端分开托管时填「带 /api 的完整地址」，并让后端加 --cors-origin=<前端地址> 放行跨域。
 * 没有构建步骤：浏览器运行时直接 import，改完保存刷新即生效。 */
export const API_BASE = 'https://seiten-suikyou.donneryst.com/api'
