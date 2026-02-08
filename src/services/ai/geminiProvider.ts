/**
 * Gemini AI Provider 实现
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import type { GenerateContentRequest, GenerateContentResponse } from './types'
import { BaseAIProvider } from './baseProvider'
import { isBrowser, getHttpsProxyAgent } from './utils'

export class GeminiProvider extends BaseAIProvider {
  readonly type = 'gemini' as const
  readonly name = 'Gemini'
  readonly supportsSystemPrompt = false
  readonly supportsStreaming = false

  private genAI: GoogleGenerativeAI
  private generativeModel: any

  constructor(config: any, options?: any) {
    super(config, options)
    this.genAI = new GoogleGenerativeAI(this.config.apiKey)
    this.generativeModel = this.genAI.getGenerativeModel({
      model: this.model
    })
  }

  protected getDefaultModel(): string {
    return 'gemini-1.5-flash'
  }

  protected async doGenerateContent(
    request: GenerateContentRequest
  ): Promise<GenerateContentResponse> {
    const { prompt, systemPrompt, temperature } = request

    // Gemini 不支持系统提示，合并到用户提示中
    const finalPrompt = systemPrompt ? `${prompt}\n\n**${systemPrompt}**` : prompt

    // 如果启用代理且不在浏览器环境，使用代理请求
    if (this.config.proxyEnabled && this.config.proxyUrl && !isBrowser) {
      return this.generateWithProxy(finalPrompt, temperature)
    }

    // 标准 Gemini API 调用
    const result = await this.generativeModel.generateContent(finalPrompt, {
      generationConfig: {
        temperature: temperature ?? this.temperature
      }
    })

    const response = await result.response

    // 统计 token 使用量
    try {
      const usage = result.response?.usageMetadata
      if (usage?.totalTokenCount) {
        this.recordTokenUsage(usage.totalTokenCount)
      }
    } catch {
      // 忽略统计错误
    }

    return {
      content: response.text(),
      tokenCount: result.response?.usageMetadata?.totalTokenCount
    }
  }

  /**
   * 使用代理请求 Gemini API
   */
  private async generateWithProxy(
    prompt: string,
    temperature?: number
  ): Promise<GenerateContentResponse> {
    const HttpsProxyAgent = await getHttpsProxyAgent()
    if (!HttpsProxyAgent) {
      console.warn('代理模块不可用，使用直接连接')
      return this.doGenerateContent({ prompt, temperature })
    }

    const https = require('https')
    const { URL } = require('url')

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.config.apiKey}`
    const parsedUrl = new URL(url)

    const agent = new HttpsProxyAgent(this.config.proxyUrl!)

    const postData = JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: temperature ?? this.temperature
      }
    })

    const requestOptions: any = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'ebook-to-mindmap/1.0'
      },
      agent: agent,
      timeout: 30000
    }

    return new Promise((resolve, reject) => {
      const req = https.request(requestOptions, (res: any) => {
        const chunks: Buffer[] = []

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        res.on('end', () => {
          const body = Buffer.concat(chunks).toString()

          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(body)
              const content = response.candidates?.[0]?.content?.parts?.[0]?.text || ''

              // 统计 token 使用量
              const tokenCount = response.usageMetadata?.totalTokenCount
              if (tokenCount) {
                this.recordTokenUsage(tokenCount)
              }

              resolve({
                content,
                tokenCount,
                finishReason: response.candidates?.[0]?.finishReason
              })
            } catch (parseError) {
              reject(new Error('Gemini API 响应解析失败'))
            }
          } else {
            const error = new Error(
              `Gemini API 请求失败: ${res.statusCode} ${res.statusMessage}`
            ) as any
            error.status = res.statusCode
            error.body = body
            reject(error)
          }
        })

        res.on('error', (error: Error) => {
          reject(error)
        })
      })

      req.on('error', (error: Error) => {
        reject(new Error(`代理连接失败: ${error.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('代理请求超时'))
      })

      req.write(postData)
      req.end()
    })
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // 使用简单的测试提示
      const response = await this.generateContent({
        prompt: 'Say "OK"',
        temperature: 0.1
      })

      return {
        success: response.content.length > 0
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
