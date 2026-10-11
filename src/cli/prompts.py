"""
Prompt 模板（与前端共享 src/services/prompts/config/v{1,2}-prompts.yaml）

- 模板来源优先级：配置文件 promptVersionConfig > 仓库内 YAML
- 默认版本与前端 configStore 一致（v1）
- 输入组装与前端 aiService 对齐：章节摘要用「标题 + 原文」，关联/全书只喂章节摘要 JSON
- 模板渲染语义见 src/services/prompts/config/README.md；render_prompt 与前端 renderPrompt 等价
  （跨端用例 tests/fixtures/prompts/render-cases.json）
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Optional

import yaml

# 前端 configStore 的 currentPromptVersion 默认值
DEFAULT_PROMPT_VERSION = "v1"
SUPPORTED_PROMPT_VERSIONS = ("v1", "v2")

# 仓库内共享 YAML 目录（src/cli/ → src/services/prompts/config）
DEFAULT_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "services" / "prompts" / "config"

# 后处理输入软上限（与前端 aiService.ts POST_PROCESS_* 一致）
POST_PROCESS_SOFT_LIMIT_CHARS = 200_000
POST_PROCESS_CONNECTIONS_SOFT_LIMIT = 50_000

# 语言指令：文本与前端 prompts/utils.ts getLanguageInstruction 一致；
# 唯一差异是 auto —— 前端跟随界面语言，CLI 跟随原书语言（约定 C8）
LANGUAGE_INSTRUCTIONS = {
    "zh": "请用中文回复。",
    "en": "Please respond in English.",
    "ja": "日本語で回答してください。",
    "fr": "Veuillez répondre en français.",
    "de": "Bitte antworten Sie auf Deutsch.",
    "es": "Por favor responda en español.",
    "ru": "Пожалуйста, отвечайте на русском языке.",
    "auto": "请使用与原书相同的语言回复。Please respond in the same language as the original book.",
}

# 结果状态前缀（与前端 src/utils/resultStatus.ts RESULT_PREFIX 一致）
RESULT_PREFIX = {
    "chapterFailed": "【处理失败】",
    "chapterSkipped": "【已跳过】",
    "connectionsFailed": "【关联分析失败】",
    "overallFailed": "【全书总结失败】",
}

# 前端 aiService 在可用章节不足时直接返回的文案（不调用 AI）
CONNECTIONS_NOT_ENOUGH = "章节数量不足，无法分析关联。"
OVERALL_NO_CHAPTERS = "没有可用的章节摘要，无法生成全书总结。"


def failed_text(prefix: str, err: object) -> str:
    return f"{prefix}{err if err else '未知错误'}"


def is_placeholder_text(text: Optional[str]) -> bool:
    return bool(text) and any(text.startswith(p) for p in RESULT_PREFIX.values())


def is_usable_text(text: Optional[str]) -> bool:
    return bool(text) and bool(text.strip()) and not is_placeholder_text(text)


def get_language_instruction(language: str) -> str:
    return LANGUAGE_INSTRUCTIONS.get(language, LANGUAGE_INSTRUCTIONS["auto"])


def load_yaml_prompts(version: str, prompts_dir: Optional[str] = None) -> dict:
    """读取共享 YAML（v2 文件带 BOM，用 utf-8-sig）"""
    base = Path(prompts_dir) if prompts_dir else DEFAULT_PROMPTS_DIR
    path = base / f"{version}-prompts.yaml"
    if not path.exists():
        raise FileNotFoundError(f"Prompt 模板不存在: {path}（可用 advanced.promptsDir 指定目录）")
    with open(path, "r", encoding="utf-8-sig") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Prompt 模板格式错误: {path}")
    return data


def _truncate(text: str, max_len: int) -> str:
    s = (text or "").strip()
    if len(s) <= max_len:
        return s
    return s[: max(0, max_len - 1)] + "…"


def prepare_post_process_chapters(
    chapters: list[tuple[str, str]],
    soft_limit: int = POST_PROCESS_SOFT_LIMIT_CHARS,
) -> list[dict]:
    """(title, summary) → [{index, title, summary}]；只保留可用摘要，超软上限时按章均分截断"""
    valid = [(t, s.strip()) for t, s in chapters if is_usable_text(s)]
    full = [{"index": i + 1, "title": t, "summary": s} for i, (t, s) in enumerate(valid)]
    total = sum(len(c["summary"]) for c in full)
    if total <= soft_limit or not full:
        return full
    per = max(400, soft_limit // len(full))
    return [{**c, "summary": _truncate(c["summary"], per)} for c in full]


_log = logging.getLogger(__name__)

# {{name}}，允许花括号内两侧空白；name 须以字母或下划线开头（与前端 PLACEHOLDER 一致）
_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def _replace_placeholders(template: str, values: dict) -> tuple[str, set, list]:
    """一次性替换已知占位符（值中的 {{…}} 不会被二次替换）；返回 (文本, 已用名, 未知名)"""
    used: set = set()
    unknown: list = []

    def sub(match: re.Match) -> str:
        name = match.group(1)
        if name not in values:
            if name not in unknown:
                unknown.append(name)
            return match.group(0)
        used.add(name)
        return str(values[name])

    return _PLACEHOLDER.sub(sub, template or ""), used, unknown


def render_prompt(template: str, variables: list[dict]) -> str:
    """渲染模板（语义与前端 renderPrompt 一致）

    variables: [{name, label, value, inline?}]，顺序即回退追加顺序
    1. 模板引用的已知占位符全部替换
    2. 未知占位符保留原样并告警
    3. 模板未引用的变量以「标签: 值」追加到末尾——每个变量恰好发送一次
    """
    rendered, used, unknown = _replace_placeholders(template, {v["name"]: v["value"] for v in variables})
    if unknown:
        _log.warning("[render_prompt] 模板含未知占位符，已原样保留: %s", ", ".join(unknown))
    appended = [
        v["label"] + ":" + (" " if v.get("inline") else "\n") + str(v["value"])
        for v in variables if v["name"] not in used
    ]
    if not appended:
        return rendered
    base = rendered.rstrip()
    return "\n\n".join(([base] if base else []) + appended)


def _json(data) -> str:
    """与前端 JSON.stringify 一致的紧凑 JSON"""
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


class PromptTemplates:
    """Prompt 模板管理器"""

    def __init__(self, prompt_config=None, prompts_dir: Optional[str] = None):
        """
        Args:
            prompt_config: config.PromptConfig（含用户导出的 promptVersionConfig 与 currentVersion）
            prompts_dir: 共享 YAML 目录覆盖（CLI 打包场景）
        """
        self.prompt_config = prompt_config
        self.prompts_dir = prompts_dir
        self.version = (getattr(prompt_config, "currentVersion", "") or DEFAULT_PROMPT_VERSION)
        self._yaml: Optional[dict] = None

    def _yaml_prompts(self) -> dict:
        if self._yaml is None:
            self._yaml = load_yaml_prompts(self.version, self.prompts_dir)
        return self._yaml

    def get_prompt(self, prompt_type: str, book_type: str = "non-fiction") -> str:
        """prompt_type: chapterSummary / connectionAnalysis / overallSummary"""
        is_fiction = book_type == "fiction"
        # 1. 配置文件中的自定义模板
        versions = getattr(self.prompt_config, "versions", None) or {}
        vc = versions.get(self.version)
        if vc is not None:
            if prompt_type == "chapterSummary":
                custom = vc.chapterSummary_fiction if is_fiction else vc.chapterSummary_nonFiction
            else:
                custom = getattr(vc, prompt_type, "")
            if custom:
                return custom
        # 2. 共享 YAML
        data = self._yaml_prompts()
        if prompt_type == "chapterSummary":
            return (data.get("chapterSummary") or {}).get("fiction" if is_fiction else "nonFiction", "")
        return data.get(prompt_type, "") or ""

    def format_prompt(self, template: str, **kwargs) -> str:
        """仅替换占位符（不追加）"""
        return _replace_placeholders(template, kwargs)[0]

    # ---- 输入组装（对齐前端 aiService）----

    def build_chapter_prompt(self, title: str, content: str, book_type: str) -> str:
        return render_prompt(self.get_prompt("chapterSummary", book_type), [
            {"name": "title", "label": "章节标题", "value": title, "inline": True},
            {"name": "content", "label": "章节内容", "value": content},
        ])

    def build_connections_prompt(self, chapters_json: list[dict]) -> str:
        return render_prompt(self.get_prompt("connectionAnalysis"), [
            {"name": "chapterSummaries", "label": "已处理的章节列表", "value": _json(chapters_json)},
        ])

    def build_overall_prompt(self, book_title: str, chapters_json: list[dict], connections: str) -> str:
        return render_prompt(self.get_prompt("overallSummary"), [
            {"name": "bookTitle", "label": "书名", "value": book_title, "inline": True},
            {"name": "chapterInfo", "label": "已处理的章节列表", "value": _json(chapters_json)},
            {"name": "connections", "label": "章节关联分析",
             "value": _truncate(connections or "", POST_PROCESS_CONNECTIONS_SOFT_LIMIT)},
        ])


def resolve_prompts_dir(configured: str = "") -> Optional[str]:
    """配置 > 环境变量 FASTREADER_PROMPTS_DIR > 仓库默认"""
    return configured or os.environ.get("FASTREADER_PROMPTS_DIR") or None
