// cytoscape-fcose 未自带类型声明：其默认导出是 cytoscape 扩展注册函数
declare module 'cytoscape-fcose' {
  import type { Ext } from 'cytoscape'
  const fcose: Ext
  export default fcose
}
