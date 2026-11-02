import { describe, it, expect } from 'vitest'
import {
  STATUS_TONES,
  hintToneClass,
  isStatusTone,
  needsAlertRole,
  statusToneClass,
  toneOf,
} from '../src/utils/statusTone'

describe('状态色调映射：语义 → 外观只有一张表', () => {
  it('业务状态名映射到语义色调；认不出来的按中性处理（不猜颜色）', () => {
    expect(toneOf('completed')).toBe('success')
    expect(toneOf('failed')).toBe('danger')
    expect(toneOf('error')).toBe('danger')
    expect(toneOf('pending')).toBe('neutral')
    expect(toneOf('queued')).toBe('neutral')
    expect(toneOf('processing')).toBe('processing')
    expect(toneOf('skipped')).toBe('neutral')
    expect(toneOf('missing')).toBe('warning')
    expect(toneOf('未知的业务状态')).toBe('neutral')
    expect(toneOf(undefined)).toBe('neutral')
    expect(toneOf(null)).toBe('neutral')
  })

  it('直接给语义色调时原样保留（大小写不敏感）', () => {
    expect(toneOf('warning')).toBe('warning')
    expect(toneOf('DANGER')).toBe('danger')
    expect(isStatusTone('warning')).toBe(true)
    expect(isStatusTone('nope')).toBe(false)
    expect([...STATUS_TONES]).toContain('processing')
  })

  it('淡底用 --*-muted token，不再是任意透明度的叠色', () => {
    for (const tone of STATUS_TONES) {
      const chip = statusToneClass(tone, 'chip')
      const surface = statusToneClass(tone, 'surface')
      // 中性没有 -muted 变体（用 muted）；其余四种语义色各有 -muted
      if (tone === 'neutral') {
        expect(chip).toContain('bg-muted')
      } else {
        expect(chip, `${tone} 的淡底应当是 -muted token`).toMatch(/bg-(primary|success|warning|info|destructive)-muted/)
        expect(surface).toMatch(/bg-(primary|success|warning|info|destructive)-muted/)
      }
      // 绝不能再出现 bg-xxx/10 这种透明度叠色
      expect(chip).not.toMatch(/bg-[a-z]+\/\d+/)
      expect(surface).not.toMatch(/bg-[a-z]+\/\d+/)
    }
  })

  it('描边只有一档（/40），不再 30/40/50/60 混用', () => {
    for (const tone of STATUS_TONES) {
      const cls = hintToneClass(tone)
      const borders = cls.match(/border-[a-z]+(?:\/\d+)?/g) ?? []
      for (const b of borders) {
        if (b === 'border-border') continue
        expect(b, `${tone} 的描边应当只有 /40 一档`).toMatch(/\/40$/)
      }
    }
  })

  it('危险色才用 alert role；中性旁注不加 role', () => {
    expect(needsAlertRole('danger')).toBe(true)
    for (const tone of STATUS_TONES) {
      if (tone !== 'danger') expect(needsAlertRole(tone)).toBe(false)
    }
  })
})
