"""
配置加载器
负责从 YAML 文件加载配置，支持环境变量替换
"""

import os
import re
import yaml
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class WebDAVConfig:
    """WebDAV 配置"""
    serverUrl: str = ""
    username: str = ""
    password: str = ""
    syncPath: str = "/fastReader"


@dataclass
class AIProviderConfig:
    """单个 AI 提供商配置"""
    provider: str = "gemini"
    apiKey: str = ""
    apiUrl: str = ""
    model: str = ""
    temperature: float = 0.7
    proxyUrl: str = ""
    proxyEnabled: bool = False
    customFields: dict = field(default_factory=dict)


@dataclass
class AIConfig:
    """AI 服务配置（支持多提供商）"""
    providers: list = field(default_factory=list)  # 支持多提供商
    currentProviderIndex: int = 0  # 当前使用的提供商索引 (0-based，与 Python 列表索引一致)
    provider: str = "gemini"  # 兼容旧版：单个提供商
    apiKey: str = ""
    model: str = ""
    apiUrl: str = ""
    temperature: float = 0.7


@dataclass
class ProcessingConfig:
    """处理选项配置"""
    mode: str = "summary"
    bookType: str = "non-fiction"
    chapterDetectionMode: str = "normal"
    outputLanguage: str = "zh"


@dataclass
class BatchConfig:
    """批量处理配置"""
    sourcePath: str = ""
    maxFiles: int = 0
    skipProcessed: bool = True
    order: str = "sequential"
    concurrency: int = 1
    maxRetries: int = 3
    retryDelays: list = field(default_factory=lambda: [60, 120, 240, 480])


@dataclass
class OutputConfig:
    """输出配置"""
    localDir: str = "output/"
    logDir: str = "log/"
    syncToWebDAV: bool = True


@dataclass
class AdvancedConfig:
    """高级配置"""
    exchangeRate: float = 7.0
    debug: bool = False
    queuePrefetchCount: int = 10


@dataclass
class PromptVersionConfig:
    """单版本 Prompt 配置"""
    chapterSummary_fiction: str = ""
    chapterSummary_nonFiction: str = ""
    mindmap_chapter: str = ""
    mindmap_arrow: str = ""
    mindmap_combined: str = ""
    connectionAnalysis: str = ""
    overallSummary: str = ""


@dataclass
class PromptConfig:
    """Prompt 配置"""
    versions: dict = field(default_factory=dict)  # {"v1": PromptVersionConfig, "v2": ...}
    currentVersion: str = "v2"  # 当前使用的版本


@dataclass
class Config:
    """完整配置"""
    webdav: WebDAVConfig
    ai: AIConfig
    processing: ProcessingConfig
    batch: BatchConfig
    output: OutputConfig
    advanced: AdvancedConfig
    prompts: PromptConfig = field(default_factory=PromptConfig)  # 可选的 Prompt 配置


class ConfigLoader:
    """配置加载器"""

    def __init__(self, config_path: str):
        self.config_path = Path(config_path)

    def load(self) -> Optional[Config]:
        """加载配置"""
        try:
            # 读取 YAML 文件
            with open(self.config_path, 'r', encoding='utf-8') as f:
                raw_config = yaml.safe_load(f)

            if raw_config is None:
                print("! 配置文件为空")
                return None

            # 处理嵌套 config 结构（如ebook-to-mindmap-config-v2.yaml）
            # 如果存在 'config' 键且不包含预期的顶级键，则使用嵌套结构
            if 'config' in raw_config and isinstance(raw_config['config'], dict):
                if 'webdav' not in raw_config and 'aiConfigManager' in raw_config['config']:
                    raw_config = raw_config['config']

            # 解析各部分配置
            # 对于嵌套结构，解析方法内部会处理相应的子键
            webdav = self._parse_webdav(raw_config)
            ai = self._parse_ai(raw_config)
            processing = self._parse_processing(raw_config)
            batch = self._parse_batch(raw_config)
            output = self._parse_output(raw_config)
            advanced = self._parse_advanced(raw_config)
            prompts = self._parse_prompts(raw_config.get('promptVersionConfig', {}), raw_config.get('currentPromptVersion', 'v2'))

            return Config(
                webdav=webdav,
                ai=ai,
                processing=processing,
                batch=batch,
                output=output,
                advanced=advanced,
                prompts=prompts
            )

        except FileNotFoundError:
            print(f"❌ 配置文件不存在: {self.config_path}")
            return None
        except yaml.YAMLError as e:
            print(f"❌ YAML 解析错误: {e}")
            return None
        except Exception as e:
            print(f"❌ 配置加载失败: {e}")
            return None

    def _replace_env_vars(self, value: str) -> str:
        """替换环境变量引用 ${VAR_NAME}"""
        if not isinstance(value, str):
            return value

        # 匹配 ${VAR_NAME} 格式
        pattern = r'\$\{([^}]+)\}'

        def replace(match):
            var_name = match.group(1)
            return os.environ.get(var_name, match.group(0))

        return re.sub(pattern, replace, value)

    def _parse_webdav(self, data: dict) -> WebDAVConfig:
        """解析 WebDAV 配置"""
        # 处理 webdavConfig 结构（如ebook-to-mindmap-config-v2.yaml）
        if 'webdavConfig' in data:
            data = data['webdavConfig']

        return WebDAVConfig(
            serverUrl=self._replace_env_vars(data.get('serverUrl', data.get('server_url', ''))),
            username=self._replace_env_vars(data.get('username', '')),
            password=self._replace_env_vars(data.get('password', '')),
            syncPath=data.get('syncPath', data.get('sync_path', '/fastReader'))
        )

    def _parse_ai(self, data: dict) -> AIConfig:
        """解析 AI 配置（支持多提供商）"""
        # 处理 aiConfigManager 结构（如ebook-to-mindmap-config-v2.yaml）
        if 'aiConfigManager' in data:
            data = data['aiConfigManager']

        # 检查是否有 providers 数组（多提供商模式）
        if 'providers' in data and isinstance(data['providers'], list):
            providers = []
            for p in data['providers']:
                providers.append(AIProviderConfig(
                    provider=p.get('provider', 'gemini'),
                    apiKey=self._replace_env_vars(p.get('apiKey', '')),
                    apiUrl=self._replace_env_vars(p.get('apiUrl', '')),
                    model=p.get('model', ''),
                    temperature=float(p.get('temperature', 0.7)),
                    proxyUrl=self._replace_env_vars(p.get('proxyUrl', '')),
                    proxyEnabled=bool(p.get('proxyEnabled', False)),
                    customFields=p.get('customFields', {})
                ))

            return AIConfig(
                providers=providers,
                # currentModelId 是 1-based (Web UI 约定)，转换为 0-based (Python 约定)
                currentProviderIndex=max(0, int(data.get('currentModelId', 1)) - 1)
            )

        # 单提供商模式（兼容旧配置）
        return AIConfig(
            provider=data.get('provider', 'gemini'),
            apiKey=self._replace_env_vars(data.get('apiKey', '')),
            model=data.get('model', ''),
            apiUrl=self._replace_env_vars(data.get('apiUrl', '')),
            temperature=float(data.get('temperature', 0.7))
        )

    def _parse_processing(self, data: dict) -> ProcessingConfig:
        """解析处理选项配置"""
        # 处理 processingOptions 结构（如ebook-to-mindmap-config-v2.yaml）
        if 'processingOptions' in data:
            data = data['processingOptions']

        return ProcessingConfig(
            mode=data.get('processingMode', data.get('mode', 'summary')),
            bookType=data.get('bookType', data.get('book_type', 'non-fiction')),
            chapterDetectionMode=data.get('chapterDetectionMode', data.get('chapter_detection_mode', 'normal')),
            outputLanguage=data.get('outputLanguage', data.get('output_language', 'zh'))
        )

    def _parse_batch(self, data: dict) -> BatchConfig:
        """解析批量处理配置"""
        return BatchConfig(
            sourcePath=data.get('sourcePath', ''),
            maxFiles=int(data.get('maxFiles', 0)),
            skipProcessed=bool(data.get('skipProcessed', True)),
            order=data.get('order', 'sequential'),
            concurrency=int(data.get('concurrency', 1)),
            maxRetries=int(data.get('maxRetries', 3)),
            retryDelays=list(data.get('retryDelays', [60, 120, 240, 480]))
        )

    def _parse_output(self, data: dict) -> OutputConfig:
        """解析输出配置"""
        return OutputConfig(
            localDir=data.get('localDir', 'output/'),
            logDir=data.get('logDir', 'log/'),
            syncToWebDAV=bool(data.get('syncToWebDAV', True))
        )

    def _parse_advanced(self, data: dict) -> AdvancedConfig:
        """解析高级配置"""
        return AdvancedConfig(
            exchangeRate=float(data.get('exchangeRate', 7.0)),
            debug=bool(data.get('debug', False)),
            queuePrefetchCount=int(data.get('queuePrefetchCount', 10))
        )

    def _parse_prompts(self, data: dict, current_version: str = 'v2') -> PromptConfig:
        """解析 Prompt 配置（支持多版本）"""
        versions = {}

        for version_name, version_data in data.items():
            if not isinstance(version_data, dict):
                continue

            versions[version_name] = PromptVersionConfig(
                chapterSummary_fiction=version_data.get('chapterSummary', {}).get('fiction', ''),
                chapterSummary_nonFiction=version_data.get('chapterSummary', {}).get('nonFiction', ''),
                mindmap_chapter=version_data.get('mindmap', {}).get('chapter', ''),
                mindmap_arrow=version_data.get('mindmap', {}).get('arrow', ''),
                mindmap_combined=version_data.get('mindmap', {}).get('combined', ''),
                connectionAnalysis=version_data.get('connectionAnalysis', ''),
                overallSummary=version_data.get('overallSummary', '')
            )

        return PromptConfig(
            versions=versions,
            currentVersion=current_version
        )


def validate_config(config: Config) -> list:
    """验证配置有效性"""
    errors = []

    if not config.webdav.serverUrl:
        errors.append("WebDAV serverUrl 不能为空")

    if not config.webdav.username:
        errors.append("WebDAV username 不能为空")

    if not config.ai.apiKey:
        errors.append("AI apiKey 不能为空")

    if not config.ai.model:
        errors.append("AI model 不能为空")

    if not config.batch.sourcePath:
        errors.append("批量处理 sourcePath 不能为空")

    return errors
