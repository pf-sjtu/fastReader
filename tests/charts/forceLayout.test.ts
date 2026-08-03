import { describe, it, expect } from 'vitest'
import { forceLayoutOptions, nodeSize, nodeLabelMaxWidth } from '@/charts/plugins/person-graph/toCytoscape'

describe('forceLayoutOptions', () => {
  it('力越大斥力与边长越大', () => {
    const low = forceLayoutOptions(10)
    const high = forceLayoutOptions(90)
    expect(high.nodeRepulsion()).toBeGreaterThan(low.nodeRepulsion())
    expect(high.idealEdgeLength()).toBeGreaterThan(low.idealEdgeLength())
  })

  it('节点尺寸足够容纳球内文字', () => {
    expect(nodeSize(5)).toBeGreaterThanOrEqual(48)
    expect(nodeLabelMaxWidth(5)).toBeLessThan(nodeSize(5))
  })
})
