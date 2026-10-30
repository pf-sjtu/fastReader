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


# CLI 当前支持的选项（不支持的值在启动校验时报错，而不是静默忽略）
SUPPORTED_MODES = ("summary",)
SUPPORTED_DETECTION_MODES = ("normal", "epub-toc")
SUPPORTED_PROVIDERS = ("gemini", "openai", "302.ai")
DEFAULT_CHAPTER_CONCURRENCY = 3  # 与前端 chapterConcurrency 默认值一致
DEFAULT_PROMPT_VERSION = "v2"    # 与前端 DEFAULT_PROMPT_VERSION（services/prompts/templates）一致


@dataclass
class WebDAVConfig:
    """WebDAV 配置"""
    serverUrl: str = ""
    username: str = ""
    password: str = ""
    syncPath: str = "/fastReader"
    missingEnvVars: list = field(default_factory=list)  # 引用了但未定义的环境变量


def _positive_int(value) -> Optional[int]:
    """元数据里的 token 数：正数才算有效（bool 不算）"""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        return None
    return int(value)


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
    missingEnvVars: list = field(default_factory=list)  # 引用了但未定义的环境变量
    # 单价（USD / 1M tokens）：2.0.0 配置里来自 models[].meta（models.dev），缺省则查内置表
    inputCost: Optional[float] = None
    outputCost: Optional[float] = None
    # 模型最大输出 / 上下文窗口（models[].meta.output / meta.context）：请求时输出上限自动给满
    maxOutputTokens: Optional[int] = None
    contextWindow: Optional[int] = None
    # 服务商 id（2.0.0 配置的 providers[].id）：与前端共用模型参数存档的键
    providerId: str = ""
    # 目录明确否定时为 False：不发 temperature / 不发思考强度参数（未知为 None，照常发送）
    supportsTemperature: Optional[bool] = None
    supportsReasoning: Optional[bool] = None


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
    missingEnvVars: list = field(default_factory=list)  # 单提供商模式下未定义的环境变量


@dataclass
class ProcessingConfig:
    """处理选项配置"""
    mode: str = "summary"
    bookType: str = "non-fiction"
    chapterDetectionMode: str = "normal"
    outputLanguage: str = "zh"
    epubTocDepth: int = 1  # 仅 chapterDetectionMode=epub-toc 时生效


@dataclass
class BatchConfig:
    """批量处理配置"""
    sourcePath: str = ""
    maxFiles: int = 0
    skipProcessed: bool = True
    # sequential（按名）/ random / smallest-first（小书先跑：便宜、快，早暴露问题）
    order: str = "sequential"
    # 只处理这些文件名（精确匹配 basename）；空 = 不过滤。用于试跑指定书目
    include: list = field(default_factory=list)
    concurrency: int = DEFAULT_CHAPTER_CONCURRENCY  # 章节级并发数
    maxRetries: int = 3
    retryDelays: list = field(default_factory=lambda: [60, 120, 240, 480])
    # 内容审核兜底：主模型被拦截时改用这些模型重跑（"providerId/modelId"）。
    # 国产服务商对政治/历史题材有内容审核（实测 MiniMax 422 new_sensitive），换境外/聚合服务商可解
    fallbackModels: list = field(default_factory=list)


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
    requestTimeout: float = 120.0  # AI 请求超时（秒）
    promptsDir: str = ""           # 共享 prompt YAML 目录覆盖（默认仓库内 src/services/prompts/config）


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
    currentVersion: str = DEFAULT_PROMPT_VERSION  # 当前使用的版本


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
                nested = raw_config['config']
                # 1.0.0 用 aiConfigManager，2.0.0 用 ai.providers
                if 'webdav' not in raw_config and (
                    'aiConfigManager' in nested or isinstance(nested.get('ai'), dict)
                ):
                    raw_config = nested

            # 解析各部分配置
            # 对于嵌套结构，解析方法内部会处理相应的子键
            webdav = self._parse_webdav(raw_config)
            ai = self._parse_ai(raw_config)
            processing = self._parse_processing(raw_config)
            batch = self._parse_batch(raw_config)
            output = self._parse_output(raw_config)
            advanced = self._parse_advanced(raw_config)
            prompts = self._parse_prompts(
                raw_config.get('promptVersionConfig', {}),
                raw_config.get('currentPromptVersion', DEFAULT_PROMPT_VERSION),
            )

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

    def _replace_env_vars(self, value: str, missing: Optional[list] = None) -> str:
        """替换环境变量引用 ${VAR_NAME}

        未定义的变量替换为空串并记入 missing（由 validate_config 报错并指出变量名），
        绝不把字面量 "${VAR}" 当作密钥发出去。
        """
        if not isinstance(value, str):
            return value

        # 匹配 ${VAR_NAME} 格式
        pattern = r'\$\{([^}]+)\}'

        def replace(match):
            var_name = match.group(1)
            if var_name in os.environ:
                return os.environ[var_name]
            if missing is not None and var_name not in missing:
                missing.append(var_name)
            return ""

        return re.sub(pattern, replace, value)

    def _parse_webdav(self, data: dict) -> WebDAVConfig:
        """解析 WebDAV 配置"""
        # 处理嵌套或不同命名的结构
        if 'webdavConfig' in data:
            data = data['webdavConfig']
        elif 'webdav' in data:
            data = data['webdav']

        missing: list = []
        return WebDAVConfig(
            serverUrl=self._replace_env_vars(data.get('serverUrl', data.get('server_url', '')), missing),
            username=self._replace_env_vars(data.get('username', ''), missing),
            password=self._replace_env_vars(data.get('password', ''), missing),
            syncPath=data.get('syncPath', data.get('sync_path', '/fastReader')),
            missingEnvVars=missing,
        )

    def _parse_ai_v2(self, ai: dict) -> AIConfig:
        """解析 2.0.0 结构：ai.providers[].models[] + ai.active

        每一「服务商」展开成多个 AIProviderConfig（CLI 的既有多提供商模型不变），
        并把 ai.active 指向的那个模型设为当前项。
        """
        providers: list = [AIProviderConfig]
        providers = []
        active_ids = ai.get('active') or {}
        active_provider = str(active_ids.get('providerId') or '')
        active_model = str(active_ids.get('modelId') or '')
        current_index = 0

        for provider in ai.get('providers') or []:
            if not isinstance(provider, dict):
                continue
            missing: list = []
            base_url = self._replace_env_vars(str(provider.get('baseUrl') or ''), missing)
            api_key = self._replace_env_vars(str(provider.get('apiKey') or ''), missing)
            protocol = str(provider.get('type') or 'openai')
            enabled_models = [
                m for m in (provider.get('models') or [])
                if isinstance(m, dict) and m.get('id') and m.get('enabled', True) is not False
            ]
            for model in enabled_models:
                model_id = str(model.get('id'))
                if (str(provider.get('id') or '') == active_provider
                        and model_id == active_model):
                    current_index = len(providers)
                meta = model.get('meta') if isinstance(model.get('meta'), dict) else {}
                providers.append(AIProviderConfig(
                    providerId=str(provider.get('id') or ''),
                    provider=protocol,
                    apiKey=api_key,
                    apiUrl=base_url,
                    model=model_id,
                    temperature=float(model.get('temperature', ai.get('defaultTemperature', 0.7)) or 0.7),
                    missingEnvVars=list(missing),
                    inputCost=meta.get('inputCost') if isinstance(meta.get('inputCost'), (int, float)) else None,
                    outputCost=meta.get('outputCost') if isinstance(meta.get('outputCost'), (int, float)) else None,
                    maxOutputTokens=_positive_int(meta.get('output')),
                    contextWindow=_positive_int(meta.get('context')),
                    supportsTemperature=False if meta.get('temperature') is False else None,
                    supportsReasoning=False if meta.get('reasoning') is False else None,
                ))

        if not providers:
            return AIConfig(providers=[], currentProviderIndex=0)

        return AIConfig(providers=providers, currentProviderIndex=min(current_index, len(providers) - 1))

    def _parse_ai(self, data: dict) -> AIConfig:
        """解析 AI 配置（支持 1.0.0 的扁平列表与 2.0.0 的服务商结构）"""
        ai_section = data.get('ai')
        if isinstance(ai_section, dict) and isinstance(ai_section.get('providers'), list):
            return self._parse_ai_v2(ai_section)

        # 处理嵌套或不同命名的结构
        if 'aiConfigManager' in data:
            data = data['aiConfigManager']
        elif 'ai' in data:
            # 如果 'ai' 键下直接就是提供商列表（多提供商模式）
            if isinstance(data['ai'], dict) and 'providers' in data['ai']:
                data = data['ai']
            # 否则可能是单提供商模式，继续向下执行

        # 检查是否有 providers 数组（多提供商模式）
        if 'providers' in data and isinstance(data['providers'], list):
            providers = []
            for p in data['providers']:
                missing: list = []
                providers.append(AIProviderConfig(
                    provider=p.get('provider', 'gemini'),
                    apiKey=self._replace_env_vars(p.get('apiKey', ''), missing),
                    apiUrl=self._replace_env_vars(p.get('apiUrl', ''), missing),
                    model=p.get('model', ''),
                    temperature=float(p.get('temperature', 0.7)),
                    proxyUrl=self._replace_env_vars(p.get('proxyUrl', ''), missing),
                    proxyEnabled=bool(p.get('proxyEnabled', False)),
                    customFields=p.get('customFields', {}),
                    missingEnvVars=missing,
                ))

            # currentModelId 是 1-based（Web UI 约定）需减 1；currentProviderIndex 本身就是 0-based
            if 'currentModelId' in data:
                index = int(data['currentModelId']) - 1
            else:
                index = int(data.get('currentProviderIndex', 0))
            return AIConfig(providers=providers, currentProviderIndex=index)

        # 处理单提供商模式下的 'ai' 键嵌套
        if 'ai' in data and isinstance(data['ai'], dict):
            data = data['ai']

        # 单提供商模式（兼容旧配置）
        missing = []
        return AIConfig(
            provider=data.get('provider', 'gemini'),
            apiKey=self._replace_env_vars(data.get('apiKey', ''), missing),
            model=data.get('model', ''),
            apiUrl=self._replace_env_vars(data.get('apiUrl', ''), missing),
            temperature=float(data.get('temperature', 0.7)),
            missingEnvVars=missing,
        )

    def _parse_processing(self, data: dict) -> ProcessingConfig:
        """解析处理选项配置"""
        # 处理嵌套或不同命名的结构
        if 'processingOptions' in data:
            data = data['processingOptions']
        elif 'processing' in data:
            data = data['processing']

        return ProcessingConfig(
            mode=data.get('processingMode', data.get('mode', 'summary')),
            bookType=data.get('bookType', data.get('book_type', 'non-fiction')),
            chapterDetectionMode=data.get('chapterDetectionMode', data.get('chapter_detection_mode', 'normal')),
            outputLanguage=data.get('outputLanguage', data.get('output_language', 'zh')),
            epubTocDepth=int(data.get('epubTocDepth', 1)),
        )

    def _parse_batch(self, data: dict) -> BatchConfig:
        """解析批量处理配置"""
        if 'batch' in data:
            data = data['batch']

        # 支持从环境变量覆盖配置
        return BatchConfig(
            # 环境变量: FASTREADER_SOURCE_PATH
            sourcePath=os.environ.get('FASTREADER_SOURCE_PATH', data.get('sourcePath', '')),
            # 环境变量: FASTREADER_MAX_FILES
            maxFiles=int(os.environ.get('FASTREADER_MAX_FILES', data.get('maxFiles', 0))),
            # 环境变量: FASTREADER_SKIP_PROCESSED
            skipProcessed=os.environ.get('FASTREADER_SKIP_PROCESSED', str(data.get('skipProcessed', True))).lower() in ('true', '1', 'yes'),
            # 环境变量: FASTREADER_ORDER
            order=os.environ.get('FASTREADER_ORDER', data.get('order', 'sequential')),
            include=[str(x) for x in (data.get('include') or [])],
            # 环境变量: FASTREADER_CONCURRENCY（章节级并发）
            concurrency=int(os.environ.get('FASTREADER_CONCURRENCY', data.get('concurrency', DEFAULT_CHAPTER_CONCURRENCY))),
            # 环境变量: FASTREADER_MAX_RETRIES
            maxRetries=int(os.environ.get('FASTREADER_MAX_RETRIES', data.get('maxRetries', 3))),
            fallbackModels=_parse_fallback_models(
                os.environ.get('FASTREADER_FALLBACK_MODELS', data.get('fallbackModels', []))),
            retryDelays=list(data.get('retryDelays', [60, 120, 240, 480]))
        )

    def _parse_output(self, data: dict) -> OutputConfig:
        """解析输出配置"""
        if 'output' in data:
            data = data['output']

        return OutputConfig(
            localDir=data.get('localDir', 'output/'),
            logDir=data.get('logDir', 'log/'),
            syncToWebDAV=bool(data.get('syncToWebDAV', True))
        )

    def _parse_advanced(self, data: dict) -> AdvancedConfig:
        """解析高级配置"""
        if 'advanced' in data:
            data = data['advanced']

        return AdvancedConfig(
            exchangeRate=float(data.get('exchangeRate', 7.0)),
            debug=bool(data.get('debug', False)),
            queuePrefetchCount=int(data.get('queuePrefetchCount', 10)),
            requestTimeout=float(data.get('requestTimeout', 120)),
            promptsDir=self._replace_env_vars(data.get('promptsDir', '')),
        )

    def _parse_prompts(self, data: dict, current_version: str = DEFAULT_PROMPT_VERSION) -> PromptConfig:
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


def _parse_fallback_models(value) -> list:
    """备用模型链：接受 "providerId/modelId" 列表，或环境变量里的逗号分隔串"""
    if isinstance(value, str):
        value = value.split(",")
    out = []
    for item in value or []:
        text = str(item).strip()
        if text and "/" in text and text not in out:
            out.append(text)
    return out


def resolve_fallback_providers(ai: AIConfig, specs: list) -> list:
    """把 "providerId/modelId" 解析成 providers 里的具体配置（找不到的跳过）"""
    resolved = []
    for spec in specs:
        provider_id, _, model_id = spec.partition("/")
        for provider in ai.providers:
            if getattr(provider, "providerId", "") == provider_id and provider.model == model_id:
                if provider not in resolved:
                    resolved.append(provider)
                break
    return resolved


def active_provider(ai: AIConfig):
    """当前实际使用的提供商配置（多提供商取 currentProviderIndex，单提供商返回 ai 本身）；越界返回 None"""
    if ai.providers:
        if 0 <= ai.currentProviderIndex < len(ai.providers):
            return ai.providers[ai.currentProviderIndex]
        return None
    return ai


def validate_config(config: Config) -> list:
    """验证配置有效性，返回错误列表（空列表表示通过）"""
    errors = []

    if not config.webdav.serverUrl:
        errors.append("WebDAV serverUrl 不能为空")

    if not config.webdav.username:
        errors.append("WebDAV username 不能为空")

    for var in config.webdav.missingEnvVars:
        errors.append(f"环境变量未定义: {var}（webdav 配置引用）")

    provider = active_provider(config.ai)
    if provider is None:
        errors.append(
            f"AI 提供商索引越界: currentProviderIndex={config.ai.currentProviderIndex}，"
            f"共 {len(config.ai.providers)} 个提供商（currentModelId 为 1-based）"
        )
    else:
        name = (provider.provider or "").lower()
        if name not in SUPPORTED_PROVIDERS:
            errors.append(f"CLI 暂不支持 AI 提供商: {provider.provider}（支持: {', '.join(SUPPORTED_PROVIDERS)}）")
        for var in provider.missingEnvVars:
            errors.append(f"环境变量未定义: {var}（AI 提供商 {provider.provider} 引用）")
        if not provider.apiKey:
            errors.append("AI apiKey 不能为空")
        if not provider.model:
            errors.append("AI model 不能为空")

    if not config.batch.sourcePath:
        errors.append("批量处理 sourcePath 不能为空")

    if config.batch.concurrency < 1:
        errors.append("batch.concurrency 必须 >= 1")

    if config.batch.maxRetries < 0:
        errors.append("batch.maxRetries 不能为负数")

    if config.processing.mode not in SUPPORTED_MODES:
        errors.append(
            f"CLI 暂不支持 {config.processing.mode} 模式（mindmap / combined-mindmap 请在 Web 端使用），"
            "请将 processing.mode 设为 summary"
        )

    if config.processing.chapterDetectionMode not in SUPPORTED_DETECTION_MODES:
        errors.append(
            f"CLI 暂不支持 chapterDetectionMode={config.processing.chapterDetectionMode}"
            f"（支持: {', '.join(SUPPORTED_DETECTION_MODES)}）"
        )

    # v1 已废弃：声明 v1 时 prompts.py 会告警并回退 v2，这里不报错，保证旧配置可跑
    version = config.prompts.currentVersion
    if version not in ("v1", "v2") and version not in config.prompts.versions:
        errors.append(f"未知的 Prompt 版本: {version}（仅支持 v2）")

    return errors
