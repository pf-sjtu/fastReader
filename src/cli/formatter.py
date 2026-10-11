"""
结果格式化器
负责生成处理结果的 Markdown 文件

产物结构严格对齐前端 src/services/metadataFormatter.ts：
- 元数据注释字段与顺序同 formatAsHTMLComment
- 正文结构同 formatUnifiedMarkdown（chapterNamingMode='auto'）
- 不在文末追加时间戳等额外行：前端 parseUnifiedMarkdown 的章节正则会把它吞进最后一章
"""

from datetime import datetime, timezone
from typing import Optional
import json

from .logger import Logger


def js_number(value) -> str:
    """数字按 JS String(number) 的常见形态输出（7.0→'7'，0.00123→'0.00123'，避免 1e-05）"""
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, int):
        return str(value)
    text = f"{float(value):.10f}".rstrip('0').rstrip('.')
    return text if text not in ('', '-0') else '0'


def js_iso_now() -> str:
    """等价 JS new Date().toISOString()：UTC、毫秒、Z 结尾"""
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def build_metadata(
    file_name: str,
    model: str,
    chapter_detection_mode: str,
    selected_chapters: list,
    chapter_count: int,
    original_char_count: int,
    processed_char_count: int,
    input_tokens: int,
    output_tokens: int,
    cost_usd: float,
    cost_cny: float,
    skipped_chapters: Optional[int] = None,
    is_partial: Optional[bool] = None,
    epub_toc_depth: Optional[int] = None,
    processed_at: Optional[str] = None,
) -> dict:
    """生成处理元数据（字段同前端 generateMetadata）"""
    metadata = {
        'source': 'WebDAV',
        'fileName': file_name,
        'processedAt': processed_at or js_iso_now(),
        'model': model,
        'chapterDetectionMode': chapter_detection_mode,
        'epubTocDepth': epub_toc_depth,
        'selectedChapters': ','.join(map(str, selected_chapters)),
        'selectedChapterCount': len(selected_chapters),
        'chapterCount': chapter_count,
        'originalCharCount': original_char_count,
        'processedCharCount': processed_char_count,
        'inputTokens': input_tokens,
        'outputTokens': output_tokens,
        'costUSD': round(cost_usd, 5),
        'costRMB': round(cost_cny, 5),
    }
    if skipped_chapters is not None:
        metadata['skippedChapters'] = skipped_chapters
    if is_partial is not None:
        metadata['isPartial'] = is_partial
    return metadata


def format_metadata_comment(metadata: dict, exchange_rate: float = 7.0) -> str:
    """HTML 注释元数据（字段顺序与格式同前端 formatAsHTMLComment）"""
    depth = metadata.get('epubTocDepth')
    lines = [
        f"source: {metadata['source']}",
        f"fileName: {metadata['fileName']}",
        f"processedAt: {metadata['processedAt']}",
        f"model: {metadata['model']}",
        f"chapterDetectionMode: {metadata['chapterDetectionMode']}",
        f"epubTocDepth: {'N/A' if depth is None else depth}",
        f"selectedChapters: {metadata['selectedChapters']}",
        f"selectedChapterCount: {metadata['selectedChapterCount']}",
        f"chapterCount: {metadata['chapterCount']}",
        f"originalCharCount: {metadata['originalCharCount']}",
        f"processedCharCount: {metadata['processedCharCount']}",
        f"inputTokens: {metadata['inputTokens']}",
        f"outputTokens: {metadata['outputTokens']}",
        f"costUSD: {js_number(metadata['costUSD'])}",
        f"costRMB: {js_number(metadata['costRMB'])} (USD/CNY: {js_number(exchange_rate)})",
    ]
    if 'skippedChapters' in metadata:
        lines.append(f"skippedChapters: {metadata['skippedChapters']}")
    if 'isPartial' in metadata:
        lines.append(f"isPartial: {js_number(bool(metadata['isPartial']))}")
    return "<!--\n" + "\n".join(lines) + "\n-->"


def format_unified_markdown(
    title: str,
    author: str,
    chapters: list[tuple[str, str]],
    overall_summary: str = "",
    connections: str = "",
    metadata: Optional[dict] = None,
    exchange_rate: float = 7.0,
) -> str:
    """统一格式 Markdown（同前端 formatUnifiedMarkdown，chapters 为 (标题, 摘要)）"""
    lines: list[str] = []

    if metadata:
        lines.append(format_metadata_comment(metadata, exchange_rate))
        lines.append('')

    lines.append(f"# {title}")
    lines.append('')

    if author:
        lines.append(f"**作者**: {author}")
        lines.append('')

    if overall_summary:
        lines.extend(['## 全书总结', '', overall_summary, ''])

    if connections:
        lines.extend(['## 章节关联分析', '', connections, ''])

    if chapters:
        lines.extend(['## 章节摘要', ''])
        for index, (chapter_title, summary) in enumerate(chapters):
            lines.append(f"### {chapter_title or f'第{index + 1}章'}")
            lines.append('')
            lines.append(summary or '（暂无总结）')
            lines.append('')

    return '\n'.join(lines)


class ResultFormatter:
    """结果格式化器"""

    def __init__(self, logger: Logger):
        self.logger = logger

    def format_summary(self, title: str, author: str, chapters: list[tuple[str, str]],
                       connections: str, overall_summary: str, metadata: Optional[dict],
                       exchange_rate: float = 7.0) -> str:
        """格式化总结结果 - 统一格式（见 format_unified_markdown）"""
        return format_unified_markdown(
            title, author, chapters, overall_summary, connections, metadata, exchange_rate
        )

    def save_to_file(self, content: str, output_dir: str, file_name: str) -> str:
        """
        保存内容到文件

        Args:
            content: 文件内容
            output_dir: 输出目录
            file_name: 文件名

        Returns:
            完整文件路径
        """
        from pathlib import Path

        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        file_path = output_path / file_name
        file_path.write_text(content, encoding='utf-8', newline='\n')  # Windows 默认写 CRLF，Web 端解析章节依赖 LF

        self.logger.debug_log(f"保存文件: {file_path}")
        return str(file_path)

    def generate_batch_report(
        self,
        total: int,
        success: int,
        failed: int,
        skipped: int,
        total_cost_usd: float,
        total_cost_cny: float,
        failed_books: list,
        skipped_books: list,
        processing_time: float
    ) -> str:
        """生成批量处理报告"""
        lines = []

        lines.append("# fastReader 批量处理报告")
        lines.append("")
        lines.append(f"**生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append("")

        lines.append("## 处理统计")
        lines.append("")
        lines.append(f"| 指标 | 数量 |")
        lines.append("|------|------|")
        lines.append(f"| 总数 | {total} |")
        lines.append(f"| 成功 | {success} |")
        lines.append(f"| 失败 | {failed} |")
        lines.append(f"| 跳过 | {skipped} |")
        lines.append(f"| 成功率 | {(success/total*100) if total > 0 else 0:.1f}% |")
        lines.append("")

        lines.append("## 费用统计")
        lines.append("")
        lines.append(f"- 美元: ${total_cost_usd:.5f}")
        lines.append(f"- 人民币: ¥{total_cost_cny:.5f}")
        lines.append(f"- 处理时间: {processing_time:.1f} 秒")
        lines.append("")

        if failed_books:
            lines.append("## 失败列表")
            lines.append("")
            for book in failed_books:
                lines.append(f"- **{book['name']}**: {book['error']}")
            lines.append("")

        if skipped_books:
            lines.append("## 跳过列表")
            lines.append("")
            for book in skipped_books:
                lines.append(f"- {book['name']}")
            lines.append("")

        lines.append("---")
        lines.append("*由 fastReader CLI 自动生成*")

        return "\n".join(lines)

    def save_batch_report(
        self,
        content: str,
        log_dir: str
    ) -> str:
        """保存批量处理报告"""
        from pathlib import Path
        from datetime import datetime

        log_path = Path(log_dir)
        log_path.mkdir(parents=True, exist_ok=True)

        file_name = f"batch_report_{datetime.now().strftime('%Y%m%d')}.md"
        file_path = log_path / file_name
        file_path.write_text(content, encoding='utf-8', newline='\n')  # Windows 默认写 CRLF，Web 端解析章节依赖 LF

        return str(file_path)

    def format_json(self, data: dict) -> str:
        """格式化为 JSON 字符串"""
        return json.dumps(data, ensure_ascii=False, indent=2)
