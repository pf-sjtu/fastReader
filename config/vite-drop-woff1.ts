import type { Plugin } from 'vite'

/**
 * @fontsource 的每个 @font-face 同时引用 woff2 与 woff（旧浏览器兜底）。
 * 本站只面向支持 woff2 的现代浏览器，不去掉 woff 的话 Vite 会把每个分片打两份进产物（体积翻倍、部署上传变慢）。
 */
export function stripWoff1(css: string): string {
  return css.replace(/,\s*url\([^)]*\.woff\)\s*format\((['"])woff\1\)/g, '')
}

export function dropWoff1(): Plugin {
  return {
    name: 'drop-woff1',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]@fontsource[\\/].*\.css(\?|$)/.test(id)) return null
      return { code: stripWoff1(code), map: null }
    },
  }
}
