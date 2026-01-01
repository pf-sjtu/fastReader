import { parse, stringify } from 'yaml'
import type { ConfigState } from '../stores/configStore'

// 完整配置导出接口
export interface FullConfigExport {
  version: string
  exportTime: string
  config: {
    aiConfigManager: ConfigState['aiConfigManager']
    processingOptions: ConfigState['processingOptions']
    webdavConfig: ConfigState['webdavConfig']
    promptVersionConfig: ConfigState['promptVersionConfig']
    currentPromptVersion: ConfigState['currentPromptVersion']
    tokenUsage: ConfigState['tokenUsage']
  }
}

// 配置导出导入服务类
export class ConfigExportService {
  private static readonly CONFIG_VERSION = '1.0.0'

  /**
   * 导出配置为YAML格式
   * @param config 当前配置状态
   * @returns YAML格式的配置字符串
   */
  static exportConfig(config: ConfigState): string {
    // 过滤掉函数类型的属性，只序列化数据
    const filteredConfig = this.filterConfigData(config)
    
    const exportData: FullConfigExport = {
      version: this.CONFIG_VERSION,
      exportTime: new Date().toISOString(),
      config: {
        aiConfigManager: filteredConfig.aiConfigManager,
        processingOptions: filteredConfig.processingOptions,
        webdavConfig: filteredConfig.webdavConfig,
        promptVersionConfig: filteredConfig.promptVersionConfig,
        currentPromptVersion: filteredConfig.currentPromptVersion,
        tokenUsage: filteredConfig.tokenUsage
      }
    }

    try {
      return stringify(exportData)
    } catch (error) {
      throw new Error(`配置导出失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 过滤配置数据，移除函数类型的属性
   * @param config 原始配置
   * @returns 过滤后的配置数据
   */
  private static filterConfigData(config: ConfigState): any {
    const filtered: any = {}

    // 过滤aiConfigManager (简化版 - 使用 currentModelId)
    if (config.aiConfigManager) {
      filtered.aiConfigManager = {
        providers: config.aiConfigManager.providers.map((provider: any) => {
          const { addProvider, updateProvider, deleteProvider, duplicateProvider,
                  setCurrentModelId, getActiveProvider, getProviderByIndex,
                  createFromTemplate, getAvailableTemplates, ...providerData } = provider
          // 忽略解构的方法，只保留数据
          void addProvider; void updateProvider; void deleteProvider; void duplicateProvider;
          void setCurrentModelId; void getActiveProvider; void getProviderByIndex;
          void createFromTemplate; void getAvailableTemplates;
          return providerData
        }),
        currentModelId: config.aiConfigManager.currentModelId
      }
    }

    // 直接复制其他纯数据属性
    filtered.processingOptions = config.processingOptions
    filtered.webdavConfig = config.webdavConfig
    filtered.promptVersionConfig = config.promptVersionConfig
    filtered.currentPromptVersion = config.currentPromptVersion
    filtered.tokenUsage = config.tokenUsage

    return filtered
  }

  /**
   * 从YAML格式导入配置
   * @param yamlContent YAML格式的配置字符串
   * @returns 解析后的配置对象
   */
  static importConfig(yamlContent: string): FullConfigExport {
    try {
      const parsed = parse(yamlContent) as FullConfigExport
      
      // 验证基本结构
      if (!parsed.version || !parsed.exportTime || !parsed.config) {
        throw new Error('配置文件格式无效，缺少必需字段')
      }

      // 验证版本兼容性
      if (this.isVersionCompatible(parsed.version)) {
        return parsed
      } else {
        throw new Error(`配置文件版本 ${parsed.version} 与当前版本 ${this.CONFIG_VERSION} 不兼容`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('配置文件')) {
        throw error
      }
      throw new Error(`配置导入失败: ${error instanceof Error ? error.message : 'YAML格式错误'}`)
    }
  }

  /**
   * 验证配置文件版本兼容性
   * @param version 配置文件版本
   * @returns 是否兼容
   */
  private static isVersionCompatible(version: string): boolean {
    // 简单的版本兼容性检查
    // 目前只支持 1.0.0 版本
    return version === this.CONFIG_VERSION
  }

  /**
   * 验证导入配置的完整性
   * @param config 导入的配置
   * @returns 验证结果
   */
  static validateConfig(config: FullConfigExport): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    // 验证AI配置管理器 (简化版 - 验证 currentModelId)
    if (!config.config.aiConfigManager) {
      errors.push('缺少AI配置管理器')
    } else {
      if (!Array.isArray(config.config.aiConfigManager.providers)) {
        errors.push('AI服务商配置格式无效')
      }
      // 验证 currentModelId 是正整数
      if (typeof config.config.aiConfigManager.currentModelId !== 'number' ||
          config.config.aiConfigManager.currentModelId < 1 ||
          !Number.isInteger(config.config.aiConfigManager.currentModelId)) {
        errors.push('currentModelId必须是正整数')
      }
    }

    // 验证处理选项
    if (!config.config.processingOptions) {
      errors.push('缺少处理选项配置')
    } else {
      const requiredOptions = ['processingMode', 'bookType', 'outputLanguage']
      requiredOptions.forEach(option => {
        if (!(option in config.config.processingOptions)) {
          errors.push(`缺少必需的处理选项: ${option}`)
        }
      })
    }

    // 验证WebDAV配置
    if (!config.config.webdavConfig) {
      errors.push('缺少WebDAV配置')
    }

    // 验证提示词配置
    if (!config.config.promptVersionConfig) {
      errors.push('缺少提示词版本配置')
    }
    if (!config.config.currentPromptVersion) {
      errors.push('缺少当前提示词版本')
    }
    
    // 验证当前提示词版本在版本配置中存在
    if (config.config.promptVersionConfig && config.config.currentPromptVersion) {
      if (!config.config.promptVersionConfig[config.config.currentPromptVersion]) {
        errors.push(`当前提示词版本 ${config.config.currentPromptVersion} 在版本配置中不存在`)
      }
    }

    // 验证token使用量
    if (typeof config.config.tokenUsage !== 'number') {
      errors.push('token使用量格式无效')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * 生成配置文件名
   * @returns 带时间戳的配置文件名
   */
  static generateFileName(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return `ebook-to-mindmap-config-${timestamp}.yaml`
  }

  /**
   * 创建配置备份
   * @param config 当前配置
   * @returns 备份配置数据
   */
  static createBackup(config: ConfigState): FullConfigExport {
    return {
      version: this.CONFIG_VERSION,
      exportTime: new Date().toISOString(),
      config: {
        aiConfigManager: JSON.parse(JSON.stringify(config.aiConfigManager)),
        processingOptions: JSON.parse(JSON.stringify(config.processingOptions)),
        webdavConfig: JSON.parse(JSON.stringify(config.webdavConfig)),
        promptConfig: JSON.parse(JSON.stringify((config as any).promptConfig)),
        promptVersionConfig: JSON.parse(JSON.stringify((config as any).promptVersionConfig)),
        currentPromptVersion: (config as any).currentPromptVersion,
        tokenUsage: (config as any).tokenUsage
      } as any
    }
  }
}
