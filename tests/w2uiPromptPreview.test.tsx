import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../src/i18n'
import { mount, click, findButton, stubDomForRadix, type Mounted } from './uiTestUtils'
import { buildPromptPreview } from '../src/components/project/promptPreview'
import { PromptEditor } from '../src/components/project/PromptEditor'
import { useConfigStore } from '../src/stores/configStore'
import { chapterVars } from '../src/services/ai/promptInputs'

const CONTENT_LABEL = chapterVars('', '')[1].label

const t = (k: string) => i18n.t(k)

describe('buildPromptPreview：与真实请求同一渲染语义', () => {
  it('同一占位符出现多次全部替换', () => {
    const out = buildPromptPreview('chapterSummary', '《{{title}}》……{{title}}\n{{content}}', { title: 'T', content: 'C' })
    expect(out).toBe('《T》……T\nC')
  })

  it('模板未引用的变量按「标签: 值」追加（与 promptInputs 的标签一致）', () => {
    const out = buildPromptPreview('chapterSummary', '只引用 {{title}}', { title: 'T', content: 'C' })
    expect(out).toBe(`只引用 T\n\n${CONTENT_LABEL}:\nC`)
  })

  it('各标签页使用对应变量：关联分析 / 全书总结 / 整书导图', () => {
    expect(buildPromptPreview('connectionAnalysis', '{{chapterSummaries}}', { chapterSummaries: 'S' })).toBe('S')
    expect(
      buildPromptPreview('overallSummary', '{{bookTitle}}|{{chapterInfo}}|{{connections}}', {
        bookTitle: 'B',
        chapterInfo: 'I',
        connections: 'X',
      })
    ).toBe('B|I|X')
    expect(buildPromptPreview('mindmap', '{{bookTitle}}/{{chapterSummaries}}', { bookTitle: 'B', chapterSummaries: 'S' }, true)).toBe('B/S')
    expect(buildPromptPreview('mindmap', '{{title}}', { title: 'T', content: 'C' })).toBe(`T\n\n${CONTENT_LABEL}:\nC`)
  })
})

describe('PromptEditor 预览模式', () => {
  let m: Mounted | null = null
  afterEach(() => {
    m?.unmount()
    m = null
    document.body.innerHTML = ''
  })

  it('预览替换所有占位符，编辑模式显示原模板', () => {
    stubDomForRadix()
    const s = useConfigStore.getState()
    s.setBookType('non-fiction')
    s.setChapterSummaryPrompt('non-fiction', '{{title}} / {{title}} / {{content}}')
    m = mount(<PromptEditor />)
    const textarea = () => document.querySelector('textarea')!
    expect(textarea().value).toBe('{{title}} / {{title}} / {{content}}')
    click(findButton(t('promptEditor.previewMode')))
    const title = t('promptEditor.preview.title')
    expect(textarea().value).toBe(`${title} / ${title} / ${t('promptEditor.preview.content')}`)
    expect(textarea().disabled).toBe(true)
  })
})
