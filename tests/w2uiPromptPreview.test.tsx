import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../src/i18n'
import { mount, click, findButton, stubDomForRadix, type Mounted } from './uiTestUtils'
import { buildPromptPreview } from '../src/components/project/promptPreview'
import { PromptEditor } from '../src/components/project/PromptEditor'
import { useConfigStore } from '../src/stores/configStore'
import { chapterVars } from '../src/services/ai/promptInputs'
import { usePromptStore } from '../src/stores/prompts'
import { LEGACY_V2_PROMPT_CONFIG } from '../src/services/prompts/templates'

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

describe('PromptEditor：改用 v2 提示词（v3 评测未完成时的回退出口）', () => {
  let m: Mounted | null = null
  afterEach(() => {
    m?.unmount()
    m = null
    document.body.innerHTML = ''
    usePromptStore.getState().resetAllPrompts()
  })

  it('确认后三类提示词整体换成 v2（无旁路标记）并覆盖已有自定义；「恢复默认」回到 v3；已是 v2 时按钮禁用', () => {
    stubDomForRadix()
    const store = () => usePromptStore.getState()
    store().resetAllPrompts() // 前一个用例设置过章节提示词
    store().setOverallSummaryPrompt('我的全书提示词')
    expect(store().promptConfig.chapterSummary.nonFiction).toContain('<!--juhua:meta-->')
    m = mount(<PromptEditor />)

    click(findButton(t('promptEditor.useV2')))
    const confirm = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === t('promptEditor.useV2'))!
    click(confirm)
    const cfg = store().promptConfig
    expect(cfg.chapterSummary.nonFiction).not.toContain('<!--juhua:meta-->')
    expect(cfg.chapterSummary.nonFiction).toBe(LEGACY_V2_PROMPT_CONFIG.chapterSummary.nonFiction)
    expect(cfg.overallSummary).toBe(LEGACY_V2_PROMPT_CONFIG.overallSummary) // 自定义被覆盖
    expect(findButton(t('promptEditor.useV2'))!.disabled).toBe(true)

    store().resetAllPrompts()
    expect(store().promptConfig.chapterSummary.nonFiction).toContain('<!--juhua:meta-->')
  })
})
