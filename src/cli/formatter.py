"""
结果格式化器
负责生成处理结果的 Markdown 文件
"""

from datetime import datetime
from typing import Optional
import json

from .models import ChapterInfo, BookInfo, ProcessingResult
from .logger import Logger


class ResultFormatter:
    """结果格式化器"""

    def __init__(self, logger: Logger):
        self.logger = logger

    def format_summary(
        self,
        book_info: BookInfo,
        chapter_summaries: dict,
        connections: str,
        overall_summary: str,
        metadata: dict
    ) -> str:
        """
        格式化总结结果 - 统一格式

        统一格式规范：
        1. HTML 注释格式的头部元数据
        2. 书名用一级标题 `# 书名`
        3. 作者信息（如有）
        4. 全书总结用二级标题 `## 全书总结`
        5. 章节关联用二级标题 `## 章节关联分析`
        6. 章节摘要用二级标题 `## 章节摘要`
        7. 各章节用三级标题 `### 章节名`

        Args:
            book_info: 书籍信息
            chapter_summaries: 章节总结字典 {chapter_id: summary}
            connections: 章节关联分析
            overall_summary: 全书总结
            metadata: 处理元数据

        Returns:
            格式化的 Markdown 内容
        """
        lines = []

        # 1. 处理元数据（HTML 注释格式）- 必须放在最前面
        metadata_comment = self._format_metadata_comment(metadata)
        if metadata_comment:
            lines.append(metadata_comment)
            lines.append("")

        # 2. 书名 - 一级标题
        lines.append(f"# {book_info.title}")
        lines.append("")

        # 3. 作者
        if book_info.author:
            lines.append(f"**作者**: {book_info.author}")
            lines.append("")

        # 4. 全书总结 - 二级标题
        if overall_summary:
            lines.append("## 全书总结")
            lines.append("")
            lines.append(overall_summary)
            lines.append("")

        # 5. 章节关联分析 - 二级标题
        if connections:
            lines.append("## 章节关联分析")
            lines.append("")
            lines.append(connections)
            lines.append("")

        # 6. 章节摘要 - 二级标题
        if book_info.chapters:
            lines.append("## 章节摘要")
            lines.append("")

            # 7. 各章节 - 三级标题
            for i, chapter in enumerate(book_info.chapters):
                chapter_key = str(i + 1)
                summary = chapter_summaries.get(chapter_key, "（暂无总结）")

                lines.append(f"### {chapter.title}")
                lines.append("")
                lines.append(summary)
                lines.append("")

        return "\n".join(lines)

    def _format_metadata_comment(self, metadata: dict) -> str:
        """格式化为 HTML 注释"""
        lines = ["<!--"]

        for key, value in metadata.items():
            lines.append(f"{key}: {value}")

        lines.append("-->")

        return "\n".join(lines)

    def format_metadata(
        self,
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
        exchange_rate: float = 7.0
    ) -> dict:
        """生成处理元数据字典"""
        return {
            'source': 'WebDAV',
            'fileName': file_name,
            'processedAt': datetime.now().isoformat(),
            'model': model,
            'chapterDetectionMode': chapter_detection_mode,
            'selectedChapters': ','.join(map(str, selected_chapters)),
            'chapterCount': chapter_count,
            'originalCharCount': original_char_count,
            'processedCharCount': processed_char_count,
            'inputTokens': input_tokens,
            'outputTokens': output_tokens,
            'costUSD': round(cost_usd, 5),
            'costRMB': round(cost_cny, 5)
        }

    def format_metadata_as_html_comment(
        self,
        metadata: dict,
        exchange_rate: float = 7.0
    ) -> str:
        """格式化为 HTML 注释"""
        lines = ["<!--"]

        for key, value in metadata.items():
            if key == 'costRMB' and 'costUSD' in metadata:
                lines.append(f"{key}: {value} (USD/CNY: {exchange_rate})")
            else:
                lines.append(f"{key}: {value}")

        lines.append("-->")

        return "\n".join(lines)

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
        file_path.write_text(content, encoding='utf-8')

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
        file_path.write_text(content, encoding='utf-8')

        return str(file_path)

    def format_result(
        self,
        title: str,
        author: str,
        chapters: dict,
        overall_summary: str = "",
        mode: str = "summary"
    ) -> str:
        """格式化处理结果为 Markdown"""
        lines = []

        # 标题
        lines.append(f"# {title}")
        lines.append("")

        # 作者
        if author and author != "Unknown Author":
            lines.append(f"**作者**: {author}")
            lines.append("")

        # 处理模式
        mode_names = {
            'summary': '文字总结',
            'mindmap': '思维导图',
            'combined-mindmap': '综合思维导图'
        }
        lines.append(f"*处理模式: {mode_names.get(mode, mode)}*")
        lines.append("")

        # 分隔线
        lines.append("---")
        lines.append("")

        # 全书总结
        if overall_summary:
            lines.append("## 全书总结")
            lines.append("")
            lines.append(overall_summary)
            lines.append("")

        # 章节摘要
        lines.append("## 章节摘要")
        lines.append("")

        for idx in range(1, len(chapters) + 1):
            chapter_key = str(idx)
            summary = chapters.get(chapter_key, "（暂无总结）")

            lines.append(f"### 第{idx}章")
            lines.append("")
            lines.append(summary)
            lines.append("")

        # 时间戳
        lines.append(f"*由 fastReader 自动生成于 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*")

        return "\n".join(lines)

    def format_with_metadata(
        self,
        content: str,
        metadata: dict,
        exchange_rate: float = 7.0
    ) -> str:
        """在内容前添加元数据 HTML 注释"""
        lines = ["<!--"]

        for key, value in metadata.items():
            if key == 'costRMB':
                lines.append(f"{key}: {value} (USD/CNY: {exchange_rate})")
            else:
                lines.append(f"{key}: {value}")

        lines.append("-->")
        lines.append("")

        return "\n".join(lines) + content

    def format_json(self, data: dict) -> str:
        """格式化为 JSON 字符串"""
        return json.dumps(data, ensure_ascii=False, indent=2)
