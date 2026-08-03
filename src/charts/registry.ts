import type { ChartPlugin } from './types'
import { PersonGraphChart } from './plugins/person-graph/PersonGraphChart'
import { EntityTimelineChart } from './plugins/entity-timeline/EntityTimelineChart'

/**
 * 图表插件注册表。
 * 新增类型：在此 push 一项 + 扩 BookCharts/schema/prompt。
 */
export const CHART_PLUGINS: ChartPlugin[] = [
  {
    id: 'person-graph',
    titleKey: 'results.charts.personGraph',
    order: 10,
    hasData: (c) => (c.personGraph?.nodes?.length ?? 0) > 0,
    Component: PersonGraphChart,
  },
  {
    id: 'entity-timeline',
    titleKey: 'results.charts.timeline',
    order: 20,
    hasData: (c) =>
      (c.entityTimeline?.events?.length ?? 0) > 0 ||
      (c.entityTimeline?.entities?.length ?? 0) > 0,
    Component: EntityTimelineChart,
  },
]

export function getSortedPlugins(): ChartPlugin[] {
  return [...CHART_PLUGINS].sort((a, b) => a.order - b.order)
}
