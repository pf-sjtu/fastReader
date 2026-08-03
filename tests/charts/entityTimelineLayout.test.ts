import { describe, it, expect } from 'vitest'
import { layoutEntityTimeline } from '@/charts/plugins/entity-timeline/layout'

describe('layoutEntityTimeline', () => {
  it('纵轴 order、横轴实体列', () => {
    const layout = layoutEntityTimeline({
      entities: [
        { id: 'a', name: '甲' },
        { id: 'b', name: '乙' },
      ],
      events: [
        {
          id: 'e1',
          label: '事件1',
          timeLabel: '早期',
          order: 1,
          entityIds: ['a'],
        },
        {
          id: 'e2',
          label: '事件2',
          timeLabel: '后期',
          order: 2,
          entityIds: ['a', 'b'],
        },
      ],
    })

    expect(layout.timeRows).toHaveLength(2)
    expect(layout.timeRows[0].timeLabel).toBe('早期')
    expect(layout.entities).toHaveLength(2)
    // e2 两个实体 → 两个色块
    expect(layout.items.filter((i) => i.event.id === 'e2')).toHaveLength(2)
    // 第二行 y 更大
    const y1 = layout.items.find((i) => i.event.id === 'e1')!.y
    const y2 = layout.items.find((i) => i.event.id === 'e2')!.y
    expect(y2).toBeGreaterThan(y1)
    // b 列 x 大于 a
    const xa = layout.items.find((i) => i.entityId === 'a' && i.event.id === 'e2')!.x
    const xb = layout.items.find((i) => i.entityId === 'b' && i.event.id === 'e2')!.x
    expect(xb).toBeGreaterThan(xa)
  })

  it('长标签换行并抬高行高，不截断省略', () => {
    const layout = layoutEntityTimeline(
      {
        entities: [{ id: 'a', name: '比尔·盖兹' }],
        events: [
          {
            id: 'e1',
            label: 'Altair BASIC 完成并创立 Micro-Soft 公司',
            timeLabel: '1975年2-3月/第十三章',
            order: 1,
            entityIds: ['a'],
          },
        ],
      },
      { colWidth: 100, labelWidth: 80, headerHeight: 40, pad: 8, fontSize: 11, lineHeight: 15, minRowHeight: 40 }
    )
    const item = layout.items[0]
    expect(item.labelLines.length).toBeGreaterThan(1)
    expect(item.labelLines.join('')).toContain('Altair BASIC')
    expect(item.labelLines.join('')).not.toContain('…')
    expect(layout.timeRows[0].height).toBeGreaterThan(40)
    expect(layout.timeRows[0].labelLines.join('')).toContain('1975')
  })
})
