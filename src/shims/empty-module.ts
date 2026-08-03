/**
 * 浏览器构建占位：避免把 Node 专用依赖打进主包
 */
export class HttpsProxyAgent {
  constructor(_url?: string) {}
  destroy() {}
}

export default {}
