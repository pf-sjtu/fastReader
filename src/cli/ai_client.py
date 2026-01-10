"""
AI 客户端
负责与 AI API 交互，处理章节内容
"""

from typing import Optional
from dataclasses import dataclass
import json
import time

from .models import ChapterInfo
from .logger import Logger


@dataclass
class AIResponse:
    """AI 响应"""
    success: bool
    content: str
    input_tokens: int = 0
    output_tokens: int = 0
    error: Optional[str] = None


class PromptTemplates:
    """Prompt 模板管理器 - 支持从配置获取，缺省时使用默认值"""

    DEFAULT_PROMPTS = {
        'v1': {
            'chapterSummary_fiction': """请为以下章节内容生成一个详细总结：

章节标题：{{title}}

章节内容：
{{content}}

请用自然流畅的语言总结本章内容，包括主要情节发展、重要人物表现、关键观点或转折，以及本章在整个故事中的作用和意义。

注意：如果内容是致谢、目录、前言、序言等无实质故事内容的页面，请直接回复"无需总结"。

重要：请保持原文的段落结构和换行，不要删除或合并段落。""",
            'chapterSummary_nonFiction': """请为以下社科类书籍章节内容生成一个详细总结：

章节标题：{{title}}

章节内容：
{{content}}

请用自然流畅的语言总结本章内容，包括：
- 主要观点，以及支持这个观点的案例或研究发现
- 关键概念
- 保留几句有洞见的观点原文
- 给出指导实际生活的建议或应用（必须与此章节内容强关联）

重要：请保持原文的段落结构和换行，不要删除或合并段落。""",
            'connectionAnalysis': """请帮我分析这本书各章节之间的关系，并总结全书的核心内容：

{{chapterSummaries}}

请从以下几个方面来分析：

## 1. 章节之间的联系
- 各章节是如何一步步展开论述的？
- 哪些重要观点在不同章节中反复出现？
- 前面的章节为后面的内容做了哪些铺垫？

## 2. 全书的核心主题
- 这本书最想告诉读者什么？
- 作者的主要观点是什么？
- 有哪些值得特别关注的重要概念？

## 3. 实用价值
- 这本书对现实生活有什么指导意义？
- 读者可以从中学到什么实用的知识或方法？
- 哪些观点可能会改变我们的思考方式？

## 4. 简明总结
- 用几句话概括这本书的精华
- 推荐给什么样的人阅读
- 阅读这本书的最大收获是什么

请用通俗易懂的语言来分析，让普通读者也能轻松理解书籍的价值和意义。""",
            'overallSummary': """书籍章节结构：
{{chapterInfo}}

章节关联分析：
{{connections}}

以上是《{{bookTitle}}》这本书的重点内容，请生成一个全面的总结报告，帮助读者快速掌握全书精髓。""",
        },
        'v2': {
            'chapterSummary_fiction': """请为以下章节内容生成一个详细总结：

## 要求
- 重要：请保持原文的段落结构和换行，不要删除或合并段落。
- 语言：请用自然流畅的语言总结本章内容
- 核心要点：包括主要情节发展、重要人物表现、关键观点或转折，以及本章在整个故事中的作用和意义。
- 精简：如果内容是致谢、目录、前言、序言等无实质故事内容的页面，请直接回复"无需总结"。

## 你需要处理的章节信息

### 章节标题：{{title}}

### 章节内容：
{{content}}""",
            'chapterSummary_nonFiction': """# 角色
你是一位顶尖的社科领域学者与书评家，具备卓越的文本解构、逻辑提炼和批判性思维能力。

# 核心任务
为输入的书籍章节生成一份兼具深度、结构与信息密度的专业级总结与分析。

# 工作流程

## 第一步：初步扫描
- 检查输入内容是否为致谢、目录、版权、参考文献、注释等非实质性内容
- 如果是，直接输出"无需总结"，并终止任务

## 第二步：深度解构与逻辑区块划分
在不输出此部分的前提下，完成以下内心工作：
- 识别3-7个主要论点的序列
- 分析各区块之间的因果、递进或对比关系

## 第三步：分块撰写
严格按照原文顺序逐个处理每个逻辑区块，信息密度至上：
- 优先保留：关键数据、时间节点、人物名字、事件转折、核心案例、具体数字
- 删除：定义式的展开、解释性的冗余语句、一般性的背景陈述

## 第四步：整合升华
- 全章脉络总结与结构评析（100-200字）
- 核心评价、延伸思考、启发性问题（3个递进问题）

## 绝对禁令
- 禁止任何形式的"模型人格"输出
- 禁止使用Markdown标题和分割线
- 禁止重述与冗余

## 输入格式
章节标题：{{title}}
章节内容：
{{content}}""",
            'connectionAnalysis': """任务：分析以下各章节之间的关系，并总结全书的核心内容。

章节总结内容：
{{chapterSummaries}}

分析要求：
1. 章节之间的联系
2. 全书的核心主题
3. 实用价值
4. 简明总结

输出要求：
- 用通俗易懂的语言分析
- 不要输出任何问候语或解释性文字""",
            'overallSummary': """任务：基于以下信息生成《{{bookTitle}}》的全面总结报告。

书籍章节结构：
{{chapterInfo}}

章节关联分析：
{{connections}}

总结要求：
1. 书籍核心观点和主要论述
2. 重要的概念和理论框架
3. 实际应用价值和指导意义
4. 适合的读者群体
5. 阅读本书的主要收获

输出要求：
- 语言简洁明了，重点突出
- 不要输出任何问候语或解释性文字""",
        }
    }

    def __init__(self, prompt_config=None):
        """
        初始化 Prompt 模板管理器

        Args:
            prompt_config: PromptConfig 对象（可选），如果为 None 则使用默认模板
        """
        self.prompt_config = prompt_config
        self._cache = {}

    def get_prompt(self, prompt_type: str, book_type: str = "non-fiction") -> str:
        """
        获取指定类型的 Prompt 模板

        Args:
            prompt_type: prompt 类型 (chapterSummary, connectionAnalysis, overallSummary)
            book_type: 书籍类型 (fiction, non-fiction)

        Returns:
            Prompt 模板字符串
        """
        cache_key = f"{prompt_type}:{book_type}"

        if cache_key in self._cache:
            return self._cache[cache_key]

        # 1. 优先从配置获取
        if self.prompt_config and self.prompt_config.versions:
            version = self.prompt_config.currentVersion or 'v2'
            version_config = self.prompt_config.versions.get(version, None)

            if version_config is not None:
                # 根据 prompt_type 和 book_type 获取对应的模板
                if prompt_type == 'chapterSummary':
                    type_key = f'chapterSummary_{book_type}'
                    # 使用 getattr 获取属性
                    prompt = getattr(version_config, type_key, '') or \
                             getattr(version_config, 'chapterSummary_fiction' if book_type == 'fiction' else 'chapterSummary_nonFiction', '')
                else:
                    prompt = getattr(version_config, prompt_type, '')

                if prompt:
                    self._cache[cache_key] = prompt
                    return prompt

        # 2. 使用默认值
        version = 'v2'
        if prompt_type == 'chapterSummary':
            # 尝试多种键名格式（兼容 'non-fiction' 和 'nonFiction'）
            prompt = self.DEFAULT_PROMPTS[version].get(f'{prompt_type}_{book_type}', '') or \
                     self.DEFAULT_PROMPTS[version].get(f'{prompt_type}_nonFiction' if book_type in ('non-fiction', 'nonFiction') else f'{prompt_type}_fiction', '')
        else:
            prompt = self.DEFAULT_PROMPTS[version].get(prompt_type, '')

        self._cache[cache_key] = prompt
        return prompt

    def format_prompt(self, template: str, **kwargs) -> str:
        """格式化 Prompt 模板"""
        result = template
        for key, value in kwargs.items():
            placeholder = f'{{{{{key}}}}}'
            result = result.replace(placeholder, str(value))
        return result


class AIClient:
    """AI 客户端基类"""

    MODEL_PRICING = {
        # Gemini models (per 1M tokens)
        'gemini-1.5-pro': {'input': 1.25, 'output': 18.75},
        'gemini-1.5-flash': {'input': 0.075, 'output': 1.125},
        'gemini-1.0-pro': {'input': 0.5, 'output': 1.5},
        # OpenAI models
        'gpt-4o': {'input': 5.0, 'output': 15.0},
        'gpt-4o-mini': {'input': 0.15, 'output': 0.6},
        'gpt-4': {'input': 30.0, 'output': 60.0},
    }

    def __init__(self, config, logger: Logger, prompt_templates: PromptTemplates = None):
        self.config = config
        self.logger = logger
        self.model = config.model
        self.temperature = config.temperature
        self.prompts = prompt_templates or PromptTemplates()

    def get_pricing(self) -> dict:
        """获取模型定价"""
        return self.MODEL_PRICING.get(self.model, {'input': 1.25, 'output': 18.75})

    def calculate_cost(self, input_tokens: int, output_tokens: int) -> tuple:
        """计算处理费用"""
        pricing = self.get_pricing()
        exchange_rate = self.config.advanced.exchangeRate if hasattr(self.config, 'advanced') else 7.0

        cost_usd = (pricing['input'] / 1_000_000) * input_tokens + \
                   (pricing['output'] / 1_000_000) * output_tokens
        cost_cny = cost_usd * exchange_rate

        return cost_usd, cost_cny

    def summarize_chapter(self, chapter: ChapterInfo, book_type: str, language: str) -> AIResponse:
        """总结章节"""
        raise NotImplementedError

    def generate_mindmap(self, chapter: ChapterInfo, language: str) -> AIResponse:
        """生成思维导图"""
        raise NotImplementedError

    def analyze_connections(self, chapters: list[ChapterInfo], language: str) -> AIResponse:
        """分析章节关联"""
        raise NotImplementedError

    def generate_overall_summary(self, title: str, chapters: list[ChapterInfo], connections: str, language: str) -> AIResponse:
        """生成全书总结"""
        raise NotImplementedError


class GeminiClient(AIClient):
    """Gemini API 客户端"""

    def __init__(self, config, logger: Logger, prompt_templates: PromptTemplates = None):
        super().__init__(config, logger, prompt_templates)
        self.api_key = config.apiKey
        self._client = None

    def _get_client(self):
        """获取 Gemini 客户端"""
        if self._client is None:
            try:
                from google import genai
                self._client = genai.Client(api_key=self.api_key)
            except ImportError:
                self.logger.error("未安装 google-genai 库")
                return None
        return self._client

    def summarize_chapter(self, chapter: ChapterInfo, book_type: str, language: str) -> AIResponse:
        """使用 Gemini 总结章节"""
        try:
            client = self._get_client()
            if client is None:
                return AIResponse(success=False, content='', error="客户端初始化失败")

            # 从配置获取 Prompt 模板
            prompt_template = self.prompts.get_prompt('chapterSummary', book_type)

            # 格式化 Prompt
            language_instruction = self._get_language_instruction(language)
            prompt = self.prompts.format_prompt(
                prompt_template,
                title=chapter.title,
                content=chapter.content
            )

            # 添加语言指令
            if language_instruction:
                prompt = f"{language_instruction}\n\n{prompt}"

            # 调用 API
            response = client.models.generate_content(
                model=self.model,
                contents=prompt,
                config={
                    'temperature': self.temperature,
                    'max_output_tokens': 4096
                }
            )

            # 解析响应
            content = ""
            input_tokens = 0
            output_tokens = 0

            if hasattr(response, 'text'):
                content = response.text
            elif hasattr(response, 'parts'):
                content = ''.join([p.text for p in response.parts])

            # 获取 token 使用情况
            if hasattr(response, 'usage_metadata'):
                input_tokens = getattr(response.usage_metadata, 'prompt_token_count', 0)
                output_tokens = getattr(response.usage_metadata, 'candidates_token_count', 0)

            return AIResponse(
                success=True,
                content=content,
                input_tokens=input_tokens,
                output_tokens=output_tokens
            )

        except Exception as e:
            self.logger.error(f"Gemini API 调用失败: {e}")
            return AIResponse(success=False, content='', error=str(e))

    def generate_mindmap(self, chapter: ChapterInfo, language: str) -> AIResponse:
        """使用 Gemini 生成思维导图"""
        try:
            client = self._get_client()
            if client is None:
                return AIResponse(success=False, content='', error="客户端初始化失败")

            language_instruction = self._get_language_instruction(language)

            prompt = f"""{language_instruction}

请为以下章节内容生成一个思维导图结构，以 JSON 格式输出：

章节标题：{chapter.title}

章节内容：
{chapter.content}

请生成 MindElixir 格式的思维导图数据，只输出 JSON，不要其他内容。
JSON 格式示例：
{{
  "nodeData": {{
    "id": "root",
    "topic": "章节主题",
    "children": [
      {{
        "id": "point1",
        "topic": "要点1",
        "children": [...]
      }}
    ]
  }}
}}
"""

            response = client.models.generate_content(
                model=self.model,
                contents=prompt,
                config={
                    'temperature': self.temperature,
                    'max_output_tokens': 8192
                }
            )

            content = ""
            if hasattr(response, 'text'):
                content = response.text or ""
            elif hasattr(response, 'parts'):
                content = ''.join([p.text or "" for p in response.parts])

            # 清理 JSON
            content = self._extract_json(content)

            return AIResponse(
                success=True,
                content=content,
                input_tokens=getattr(response.usage_metadata, 'prompt_token_count', 0) if hasattr(response, 'usage_metadata') else 0,
                output_tokens=getattr(response.usage_metadata, 'candidates_token_count', 0) if hasattr(response, 'usage_metadata') else 0
            )

        except Exception as e:
            self.logger.error(f"Gemini API 调用失败: {e}")
            return AIResponse(success=False, content='', error=str(e))

    def analyze_connections(self, chapters: list[ChapterInfo], language: str) -> AIResponse:
        """分析章节关联"""
        try:
            client = self._get_client()
            if client is None:
                return AIResponse(success=False, content='', error="客户端初始化失败")

            # 从配置获取 Prompt 模板
            prompt_template = self.prompts.get_prompt('connectionAnalysis')

            # 构建章节摘要列表
            chapter_summaries = "\n".join([
                f"第{i+1}章 {c.title}: {c.content[:200]}..."
                for i, c in enumerate(chapters)
            ])

            # 格式化 Prompt
            prompt = self.prompts.format_prompt(
                prompt_template,
                chapterSummaries=chapter_summaries
            )

            # 添加语言指令
            language_instruction = self._get_language_instruction(language)
            if language_instruction:
                prompt = f"{language_instruction}\n\n{prompt}"

            response = client.models.generate_content(
                model=self.model,
                contents=prompt,
                config={
                    'temperature': self.temperature,
                    'max_output_tokens': 4096
                }
            )

            content = ""
            if hasattr(response, 'text'):
                content = response.text or ""
            elif hasattr(response, 'parts'):
                content = ''.join([p.text or "" for p in response.parts])

            return AIResponse(
                success=True,
                content=content,
                input_tokens=getattr(response.usage_metadata, 'prompt_token_count', 0) if hasattr(response, 'usage_metadata') else 0,
                output_tokens=getattr(response.usage_metadata, 'candidates_token_count', 0) if hasattr(response, 'usage_metadata') else 0
            )

        except Exception as e:
            self.logger.error(f"Gemini API 调用失败: {e}")
            return AIResponse(success=False, content='', error=str(e))

    def generate_overall_summary(self, title: str, chapters: list[ChapterInfo], connections: str, language: str) -> AIResponse:
        """生成全书总结"""
        try:
            client = self._get_client()
            if client is None:
                return AIResponse(success=False, content='', error="客户端初始化失败")

            # 从配置获取 Prompt 模板
            prompt_template = self.prompts.get_prompt('overallSummary')

            # 构建简化的章节列表
            chapter_list = "\n".join([c.title for c in chapters])

            # 格式化 Prompt
            prompt = self.prompts.format_prompt(
                prompt_template,
                bookTitle=title,
                chapterInfo=chapter_list,
                connections=connections or "无关联分析"
            )

            # 添加语言指令
            language_instruction = self._get_language_instruction(language)
            if language_instruction:
                prompt = f"{language_instruction}\n\n{prompt}"

            response = client.models.generate_content(
                model=self.model,
                contents=prompt,
                config={
                    'temperature': self.temperature,
                    'max_output_tokens': 4096
                }
            )

            content = ""
            if hasattr(response, 'text'):
                content = response.text or ""
            elif hasattr(response, 'parts'):
                content = ''.join([p.text or "" for p in response.parts])

            return AIResponse(
                success=True,
                content=content,
                input_tokens=getattr(response.usage_metadata, 'prompt_token_count', 0) if hasattr(response, 'usage_metadata') else 0,
                output_tokens=getattr(response.usage_metadata, 'candidates_token_count', 0) if hasattr(response, 'usage_metadata') else 0
            )

        except Exception as e:
            self.logger.error(f"Gemini API 调用失败: {e}")
            return AIResponse(success=False, content='', error=str(e))

    def _get_language_instruction(self, language: str) -> str:
        """获取语言指令"""
        instructions = {
            'zh': '请用中文回答。',
            'en': 'Please answer in English.',
            'ja': '日本語で回答してください。',
            'fr': 'Répondez en français.',
            'de': 'Bitte antworten Sie auf Deutsch.',
            'es': 'Responda en español.',
            'ru': 'Ответьте на русском языке.',
            'auto': '请使用原书的语言回答。'
        }
        return instructions.get(language, instructions['auto'])

    def _extract_json(self, text: str) -> str:
        """从文本中提取 JSON"""
        # 尝试提取 ```json ... ``` 或纯 JSON
        import re

        # 匹配代码块
        code_block_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
        if code_block_match:
            return code_block_match.group(1).strip()

        # 尝试直接解析 JSON
        try:
            json.loads(text)
            return text
        except json.JSONDecodeError:
            pass

        # 返回原始文本，让调用方处理
        return text


class OpenAIClient(AIClient):
    """OpenAI 兼容 API 客户端（包括自定义端点和 302.ai）"""

    def __init__(self, config, logger: Logger, prompt_templates: PromptTemplates = None):
        super().__init__(config, logger, prompt_templates)
        self.api_key = config.apiKey
        self.api_url = config.apiUrl.rstrip('/') if config.apiUrl else 'https://api.openai.com/v1'
        self._client = None

    def _get_client(self):
        """获取 OpenAI 客户端"""
        if self._client is None:
            try:
                from openai import OpenAI
                self._client = OpenAI(
                    api_key=self.api_key,
                    base_url=self.api_url,
                    # 禁用默认超时，使用自定义处理
                    timeout=None
                )
            except ImportError:
                self.logger.error("未安装 openai 库")
                return None
        return self._client

    def summarize_chapter(self, chapter: ChapterInfo, book_type: str, language: str) -> AIResponse:
        """使用 OpenAI 兼容 API 总结章节"""
        try:
            client = self._get_client()
            if client is None:
                return AIResponse(success=False, content='', error="客户端初始化失败")

            # 构建提示词
            book_type_prompt = "小说" if book_type == "fiction" else "非小说"
            language_instruction = self._get_language_instruction(language)

            prompt = f"""{language_instruction}

请对以下{book_type_prompt}的章节内容进行总结：

章节标题：{chapter.title}

章节内容：
{chapter.content}

请用简洁的语言总结本章的主要内容和要点。
"""

            # 调用 API
            response = client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=self.temperature,
                max_tokens=4096
            )

            content = response.choices[0].message.content or ""
            input_tokens = response.usage.prompt_tokens if hasattr(response, 'usage') and response.usage else 0
            output_tokens = response.usage.completion_tokens if hasattr(response, 'usage') and response.usage else 0

            return AIResponse(
                success=True,
                content=content,
                input_tokens=input_tokens,
                output_tokens=output_tokens
            )

        except Exception as e:
            self.logger.error(f"OpenAI API 调用失败: {e}")
            return AIResponse(success=False, content='', error=str(e))

    def generate_mindmap(self, chapter: ChapterInfo, language: str) -> AIResponse:
        """使用 OpenAI 兼容 API 生成思维导图"""
        try:
            client = self._get_client()
            if client is None:
                return AIResponse(success=False, content='', error="客户端初始化失败")

            language_instruction = self._get_language_instruction(language)

            prompt = f"""{language_instruction}

请为以下章节内容生成一个思维导图结构，以 JSON 格式输出：

章节标题：{chapter.title}

章节内容：
{chapter.content}

请生成 MindElixir 格式的思维导图数据，只输出 JSON，不要其他内容。
JSON 格式示例：
{{
  "nodeData": {{
    "id": "root",
    "topic": "章节主题",
    "children": [
      {{
        "id": "point1",
        "topic": "要点1",
        "children": [...]
      }}
    ]
  }}
}}
"""

            response = client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=self.temperature,
                max_tokens=8192
            )

            content = response.choices[0].message.content or ""
            input_tokens = response.usage.prompt_tokens if hasattr(response, 'usage') and response.usage else 0
            output_tokens = response.usage.completion_tokens if hasattr(response, 'usage') and response.usage else 0

            # 清理 JSON
            content = self._extract_json(content)

            return AIResponse(
                success=True,
                content=content,
                input_tokens=input_tokens,
                output_tokens=output_tokens
            )

        except Exception as e:
            self.logger.error(f"OpenAI API 调用失败: {e}")
            return AIResponse(success=False, content='', error=str(e))

    def analyze_connections(self, chapters: list[ChapterInfo], language: str) -> AIResponse:
        """分析章节关联"""
        try:
            client = self._get_client()
            if client is None:
                return AIResponse(success=False, content='', error="客户端初始化失败")

            # 从配置获取 Prompt 模板
            prompt_template = self.prompts.get_prompt('connectionAnalysis')

            # 构建章节摘要列表
            chapter_summaries = "\n".join([
                f"第{i+1}章 {c.title}: {c.content[:200]}..."
                for i, c in enumerate(chapters)
            ])

            # 格式化 Prompt
            prompt = self.prompts.format_prompt(
                prompt_template,
                chapterSummaries=chapter_summaries
            )

            # 添加语言指令
            language_instruction = self._get_language_instruction(language)
            if language_instruction:
                prompt = f"{language_instruction}\n\n{prompt}"

            response = client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=self.temperature,
                max_tokens=4096
            )

            content = response.choices[0].message.content or ""
            input_tokens = response.usage.prompt_tokens if hasattr(response, 'usage') and response.usage else 0
            output_tokens = response.usage.completion_tokens if hasattr(response, 'usage') and response.usage else 0

            return AIResponse(
                success=True,
                content=content,
                input_tokens=input_tokens,
                output_tokens=output_tokens
            )

        except Exception as e:
            self.logger.error(f"OpenAI API 调用失败: {e}")
            return AIResponse(success=False, content='', error=str(e))

    def generate_overall_summary(self, title: str, chapters: list[ChapterInfo], connections: str, language: str) -> AIResponse:
        """生成全书总结"""
        try:
            client = self._get_client()
            if client is None:
                return AIResponse(success=False, content='', error="客户端初始化失败")

            # 从配置获取 Prompt 模板
            prompt_template = self.prompts.get_prompt('overallSummary')

            # 构建简化的章节列表
            chapter_list = "\n".join([c.title for c in chapters])

            # 格式化 Prompt
            prompt = self.prompts.format_prompt(
                prompt_template,
                bookTitle=title,
                chapterInfo=chapter_list,
                connections=connections or "无关联分析"
            )

            # 添加语言指令
            language_instruction = self._get_language_instruction(language)
            if language_instruction:
                prompt = f"{language_instruction}\n\n{prompt}"

            response = client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=self.temperature,
                max_tokens=4096
            )

            content = response.choices[0].message.content or ""
            input_tokens = response.usage.prompt_tokens if hasattr(response, 'usage') and response.usage else 0
            output_tokens = response.usage.completion_tokens if hasattr(response, 'usage') and response.usage else 0

            return AIResponse(
                success=True,
                content=content,
                input_tokens=input_tokens,
                output_tokens=output_tokens
            )

        except Exception as e:
            self.logger.error(f"OpenAI API 调用失败: {e}")
            return AIResponse(success=False, content='', error=str(e))

    def _get_language_instruction(self, language: str) -> str:
        """获取语言指令"""
        instructions = {
            'zh': '请用中文回答。',
            'en': 'Please answer in English.',
            'ja': '日本語で回答してください。',
            'fr': 'Répondez en français.',
            'de': 'Bitte antworten Sie auf Deutsch.',
            'es': 'Responda en español.',
            'ru': 'Ответьте на русском языке.',
            'auto': '请使用原书的语言回答。'
        }
        return instructions.get(language, instructions['auto'])

    def _extract_json(self, text: str) -> str:
        """从文本中提取 JSON"""
        import re

        # 匹配代码块
        code_block_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
        if code_block_match:
            return code_block_match.group(1).strip()

        # 尝试直接解析 JSON
        try:
            json.loads(text)
            return text
        except json.JSONDecodeError:
            pass

        # 返回原始文本
        return text


def create_ai_client(config, logger: Logger, prompt_templates: PromptTemplates = None) -> Optional[AIClient]:
    """创建 AI 客户端（支持多提供商）"""
    # 检查是否为多提供商配置
    if hasattr(config, 'providers') and config.providers:
        if len(config.providers) > config.currentProviderIndex:
            provider_config = config.providers[config.currentProviderIndex]
            logger.info(f"使用多提供商配置，当前提供商: {provider_config.provider}, 模型: {provider_config.model}")
            return _create_client_for_provider(provider_config, config, logger, prompt_templates)
        else:
            logger.warning(f"提供商索引 {config.currentProviderIndex} 超出范围，使用第一个提供商")
            provider_config = config.providers[0]
            return _create_client_for_provider(provider_config, config, logger, prompt_templates)

    # 单提供商模式
    return _create_client_for_provider(config, config, logger, prompt_templates)


def _create_client_for_provider(provider_config, full_config, logger: Logger, prompt_templates: PromptTemplates = None) -> Optional[AIClient]:
    """根据提供商配置创建客户端"""
    provider = provider_config.provider.lower()

    if provider == 'gemini':
        # Gemini 使用配置中的模型和 API Key
        provider_config.model = getattr(provider_config, 'model', '') or full_config.model
        return GeminiClient(provider_config, logger, prompt_templates)
    elif provider == 'openai':
        # OpenAI 兼容 API（包括自定义端点如 302.ai）
        provider_config.model = getattr(provider_config, 'model', '') or full_config.model
        return OpenAIClient(provider_config, logger, prompt_templates)
    elif provider == 'ollama':
        logger.warning("Ollama 客户端待实现")
        return None
    elif provider == '302.ai':
        # 302.ai 使用 OpenAI 兼容接口
        provider_config.model = getattr(provider_config, 'model', '') or full_config.model
        return OpenAIClient(provider_config, logger, prompt_templates)
    else:
        logger.error(f"不支持的 AI 提供商: {provider}")
        return None
