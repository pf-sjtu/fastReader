import { describe, it, expect } from 'vitest'
import {
  forceLayoutOptions,
  layoutNodeLabel,
  wrapLabelByUnits,
  nodeSize,
  nodeLabelMaxWidth,
} from '@/charts/plugins/person-graph/toCytoscape'

describe('forceLayoutOptions', () => {
  it('力越大斥力与边长越大', () => {
    const low = forceLayoutOptions(10)
    const high = forceLayoutOptions(90)
    expect(high.nodeRepulsion()).toBeGreaterThan(low.nodeRepulsion())
    expect(high.idealEdgeLength()).toBeGreaterThan(low.idealEdgeLength())
  })
})

describe('layoutNodeLabel', () => {
  it('长中文名：球径足够且 textMaxWidth 小于直径', () => {
    const L = layoutNodeLabel('比尔·盖兹（特雷）', 10)
    expect(L.size).toBeGreaterThanOrEqual(56)
    expect(L.textMaxWidth).toBeLessThan(L.size * 0.75)
    expect(L.displayLabel.includes('\n') || L.displayLabel.length <= 6).toBe(true)
  })

  it('短名不必超大', () => {
    const L = layoutNodeLabel('盖兹', 5)
    expect(L.size).toBeLessThan(90)
    expect(L.fontSize).toBeGreaterThanOrEqual(10)
  })

  it('极长名限制在 3 行内', () => {
    const L = layoutNodeLabel('这是一个非常非常非常长的实体名称用于测试换行', 5)
    expect(L.displayLabel.split('\n').length).toBeLessThanOrEqual(3)
    expect(L.size).toBeLessThanOrEqual(128)
  })
})

describe('wrapLabelByUnits', () => {
  it('按单位换行', () => {
    const lines = wrapLabelByUnits('保罗·艾伦', 2.5)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe('保罗·艾伦')
  })
})

describe('legacy helpers', () => {
  it('nodeSize / maxWidth 关系', () => {
    expect(nodeLabelMaxWidth(5)).toBeLessThan(nodeSize(5))
  })
})
