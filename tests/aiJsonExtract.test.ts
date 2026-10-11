import { describe, it, expect } from 'vitest'
import { AIService } from '../src/services/ai/aiService'
import type { AIProviderConfig } from '../src/stores/types'

const cfg = { id: 1, name: 't', provider: 'openai', apiKey: 'k', apiUrl: 'https://x.example/v1', model: 'm', customFields: {} } as unknown as AIProviderConfig

function svcReturning(raw: string) {
  const s = new AIService(cfg)
  ;(s as unknown as { generateContent: () => Promise<string> }).generateContent = async () => raw
  return s
}

const MAP = '{"nodeData":{"id":"1","topic":"根","children":[{"id":"2","topic":"子"}]}}'

describe('模型输出中的 JSON 提取', () => {
  it('纯 JSON / 代码围栏照常解析', async () => {
    expect((await svcReturning(MAP).generateChapterMindMap('t', 'c'))?.nodeData.topic).toBe('根')
    expect((await svcReturning('```json\n' + MAP + '\n```').generateChapterMindMap('t', 'c'))?.nodeData.topic).toBe('根')
  })

  it('JSON 后追加含花括号的说明文字时，回退为括号配平仍能解析', async () => {
    const raw = MAP + '\n\n说明：节点格式为 {id, topic}，如需调整请告知。'
    expect((await svcReturning(raw).generateChapterMindMap('t', 'c'))?.nodeData.topic).toBe('根')
  })

  it('字符串内的花括号不影响配平', async () => {
    const raw = '结果如下 {"nodeData":{"id":"1","topic":"含 } 的 { 标题","children":[]}} 完毕 {x}'
    expect((await svcReturning(raw).generateChapterMindMap('t', 'c'))?.nodeData.topic).toBe('含 } 的 { 标题')
  })

  it('完全无 JSON 或被截断返回 null', async () => {
    expect(await svcReturning('抱歉，无法生成').generateChapterMindMap('t', 'c')).toBeNull()
    expect(await svcReturning('{"nodeData":{"id":"1","topic":"断').generateChapterMindMap('t', 'c')).toBeNull()
  })
})

describe('请求去重：失败不产生未处理的 rejection', () => {
  it('doGenerateContent 失败时只向调用方抛错，且 pending 记录被清理', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      const s = new AIService(cfg)
      ;(s as unknown as { doGenerateContent: () => Promise<string> }).doGenerateContent = async () => {
        throw new Error('boom')
      }
      await expect((s as unknown as { generateContent: (p: string) => Promise<string> }).generateContent('p')).rejects.toThrow('boom')
      await new Promise((r) => setTimeout(r, 20)) // 让 unhandledRejection 有机会触发
      expect(unhandled).toEqual([])
      expect((s as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.size).toBe(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
