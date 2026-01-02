"""
批量处理器
负责执行批量电子书处理流程
"""

import time
import json
import sys
import os
from datetime import datetime
from pathlib import Path
from typing import Optional
import random
import tempfile

from .config import Config
from .webdav_client import WebDAVClientWrapper
from .ai_client import create_ai_client, AIClient, AIResponse, PromptTemplates
from .formatter import ResultFormatter
from .logger import Logger
from .chapter_extractor import ChapterExtractorFactory, Chapter, BookContent
from .models import (
    BookFile,
    BatchResult,
    ProcessingResult,
    ChapterInfo
)


class BatchProcessor:
    """批量处理器"""

    def __init__(self, config: Config, logger: Logger):
        self.config = config
        self.logger = logger
        self.webdav = WebDAVClientWrapper(config.webdav, logger)

        # 创建 Prompt 模板管理器（从配置获取，缺省时使用默认值）
        prompt_templates = PromptTemplates(prompt_config=config.prompts)

        self.ai_client: Optional[AIClient] = create_ai_client(config.ai, logger, prompt_templates)
        self.formatter = ResultFormatter(logger)
        self._start_time: Optional[float] = None
        self._temp_dir: Optional[str] = None

    def run(self) -> BatchResult:
        """
        执行批量处理

        Returns:
            BatchResult: 处理结果
        """
        self._start_time = time.time()

        # 创建临时目录
        self._temp_dir = tempfile.mkdtemp(prefix='fastreader_')

        # 初始化日志文件
        log_file = self._init_progress_log()

        try:
            # 连接 WebDAV
            print("\n" + "=" * 60)
            print("🚀 fastReader CLI - 批量处理工具 v1.0.0")
            print("=" * 60)
            print("\n📂 正在连接 WebDAV...")

            if not self.webdav.connect():
                self.logger.error("❌ WebDAV 连接失败")
                return BatchResult(
                    failed=1,
                    failed_books=[{'name': '初始化', 'error': 'WebDAV 连接失败'}]
                )

            print("✅ WebDAV 连接成功")
            print(f"   - 服务器: {self.config.webdav.serverUrl}")
            print(f"   - 同步路径: {self.config.webdav.syncPath}")

            # 发现书籍
            print(f"\n📋 扫描文件夹: {self.config.batch.sourcePath}")
            books = self._discover_books()

            if not books:
                print("\n⚠️  未找到可处理的电子书")
                return BatchResult()

            # 排序
            if self.config.batch.order == 'random':
                random.shuffle(books)
                print("🎲 处理顺序: 随机")
            else:
                books.sort(key=lambda b: b.name)
                print("📄 处理顺序: 顺序")

            # 限制数量
            if self.config.batch.maxFiles > 0:
                books = books[:self.config.batch.maxFiles]
                print(f"📊 限制处理数量: {len(books)}")

            print(f"\n📚 找到 {len(books)} 本待处理书籍")

            # 显示配置摘要
            self._print_config_summary()

            # 确认开始
            print("\n" + "-" * 60)
            input("按 Enter 开始处理... (Ctrl+C 取消) ")
            print("-" * 60)

            # 处理每本书
            result = self._process_books(books, log_file)

            # 生成报告
            self._generate_report(result)

            return result

        except KeyboardInterrupt:
            print("\n⚠️  用户中断处理")
            return BatchResult()
        except Exception as e:
            self.logger.error(f"批量处理异常: {e}", exc_info=True)
            return BatchResult(
                failed=1,
                failed_books=[{'name': '未知', 'error': str(e)}]
            )
        finally:
            # 清理临时目录
            if self._temp_dir and os.path.exists(self._temp_dir):
                import shutil
                shutil.rmtree(self._temp_dir, ignore_errors=True)
            self.webdav.disconnect()

    def _init_progress_log(self) -> str:
        """初始化进度日志文件"""
        log_dir = self.config.output.logDir
        os.makedirs(log_dir, exist_ok=True)

        date_str = datetime.now().strftime('%Y%m%d')
        log_file = os.path.join(log_dir, f'batch_progress_{date_str}.log')

        with open(log_file, 'w', encoding='utf-8') as f:
            f.write(f"# fastReader 批量处理进度日志\n")
            f.write(f"# 开始时间: {datetime.now().isoformat()}\n")
            f.write(f"# 源路径: {self.config.batch.sourcePath}\n")
            f.write("\n")

        return log_file

    def _log_progress(self, log_file: str, message: str):
        """写入进度日志"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"[{timestamp}] {message}\n"

        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(log_entry)

    def _print_config_summary(self):
        """打印配置摘要"""
        mode_names = {
            'summary': '文字总结',
            'mindmap': '思维导图',
            'combined-mindmap': '综合思维导图'
        }

        print(f"\n⚙️  配置摘要:")
        print(f"   - 处理模式: {mode_names.get(self.config.processing.mode, self.config.processing.mode)}")
        print(f"   - 书籍类型: {'小说' if self.config.processing.bookType == 'fiction' else '非小说'}")
        print(f"   - AI 模型: {self.config.ai.model}")
        print(f"   - 输出语言: {self.config.processing.outputLanguage}")
        print(f"   - 跳过已处理: {'是' if self.config.batch.skipProcessed else '否'}")
        print(f"   - 重试次数: {self.config.batch.maxRetries}")
        print(f"   - 同步到 WebDAV: {'是' if self.config.output.syncToWebDAV else '否'}")

    def _discover_books(self) -> list[BookFile]:
        """发现待处理的书籍"""
        books = self.webdav.list_books(self.config.batch.sourcePath)

        # 如果需要跳过已处理的文件
        if self.config.batch.skipProcessed:
            unprocessed = []
            for book in books:
                if not self.webdav.check_cache_exists(book):
                    unprocessed.append(book)
                else:
                    print(f"   ⏭️  跳过已处理: {book.name}")
            return unprocessed

        return books

    def _process_books(self, books: list[BookFile], log_file: str) -> BatchResult:
        """处理书籍列表"""
        result = BatchResult(total=len(books))

        for i, book in enumerate(books):
            self._log_progress(log_file, f"开始处理 [{i+1}/{len(books)}]: {book.name}")

            book_start_time = time.time()

            print(f"\n{'=' * 60}")
            print(f"[{i+1:02d}/{len(books)}] 📖 开始处理: {book.name}")
            print(f"{'=' * 60}")

            try:
                # 处理单本书
                book_result = self._process_single_book(book)

                # 计算耗时
                book_time = time.time() - book_start_time

                if book_result.success:
                    result.success += 1
                    result.total_cost_usd += book_result.cost_usd
                    result.total_cost_cny += book_result.cost_cny

                    print(f"\n✅ 处理完成: {book.name}")
                    print(f"   ⏱️  耗时: {self._format_time(book_time)}")
                    print(f"   💰 费用: ${book_result.cost_usd:.5f} / ¥{book_result.cost_cny:.5f}")
                    if book_result.input_tokens > 0:
                        print(f"   📊 Token: 输入 {book_result.input_tokens:,} | 输出 {book_result.output_tokens:,}")

                    self._log_progress(log_file,
                        f"完成 [{i+1}/{len(books)}]: {book.name} - 成功 - 耗时 {book_time:.1f}s - 费用 ${book_result.cost_usd:.5f}")
                else:
                    result.failed += 1
                    result.failed_books.append({
                        'name': book.name,
                        'error': book_result.error
                    })

                    print(f"\n❌ 处理失败: {book.name}")
                    print(f"   错误: {book_result.error}")
                    self._log_progress(log_file,
                        f"失败 [{i+1}/{len(books)}]: {book.name} - {book_result.error}")

            except KeyboardInterrupt:
                print("\n⚠️  用户中断处理")
                break
            except Exception as e:
                result.failed += 1
                error_msg = str(e)
                result.failed_books.append({
                    'name': book.name,
                    'error': error_msg
                })
                print(f"\n❌ 处理异常: {book.name}")
                print(f"   错误: {error_msg}")
                self._log_progress(log_file, f"异常 [{i+1}/{len(books)}]: {book.name} - {error_msg}")

        # 计算总时间
        result.processing_time = time.time() - (self._start_time or 0)

        return result

    def _process_single_book(self, book: BookFile) -> ProcessingResult:
        """处理单本书"""
        start_time = time.time()

        # 1. 下载书籍到临时目录
        print(f"\n📥 正在下载: {book.name}...")
        local_path = self._download_book(book)
        if not local_path:
            return ProcessingResult(
                success=False,
                book_name=book.name,
                error="下载书籍失败"
            )

        # 2. 提取章节
        print(f"📖 正在提取章节...")
        try:
            book_content = ChapterExtractorFactory.extract(local_path)
            chapter_count = len(book_content.chapters)
            total_chars = sum(len(ch.content) for ch in book_content.chapters)

            print(f"   ✅ 提取到 {chapter_count} 个章节")
            print(f"   📊 总字符数: {total_chars:,}")

        except Exception as e:
            return ProcessingResult(
                success=False,
                book_name=book.name,
                error=f"章节提取失败: {e}"
            )

        # 3. 检查缓存（断点续传）
        if self.webdav.check_cache_exists(book):
            print(f"\n⏭️  发现缓存，跳过处理")
            return ProcessingResult(
                success=True,
                book_name=book.name,
                processing_time=time.time() - start_time
            )

        # 4. AI 处理章节
        print(f"\n🤖 正在调用 AI 处理...")
        total_input_tokens = 0
        total_output_tokens = 0
        chapter_results = {}
        connections = AIResponse(success=False, content="")
        overall_summary = AIResponse(success=False, content="")

        if self.ai_client:
            for idx, chapter in enumerate(book_content.chapters):
                chapter_num = idx + 1

                print(f"   🔄 处理章节 {chapter_num}/{chapter_count}: {chapter.title[:30]}...")

                response = self.ai_client.summarize_chapter(
                    chapter.title,
                    chapter.content,
                    self.config.processing.bookType,
                    self.config.processing.outputLanguage
                )

                if response.success:
                    chapter_results[str(chapter_num)] = response.content
                    total_input_tokens += response.input_tokens
                    total_output_tokens += response.output_tokens

                    print(f"      ✅ 完成 (input: {response.input_tokens:,}, output: {response.output_tokens:,})")
                else:
                    chapter_results[str(chapter_num)] = f"（处理失败: {response.error}）"
                    print(f"      ❌ 失败: {response.error}")

                # 短暂延迟避免 API 限流
                time.sleep(0.5)
        else:
            print("   ⚠️  AI 客户端未初始化，跳过 AI 处理")
            for idx, chapter in enumerate(book_content.chapters):
                chapter_results[str(idx + 1)] = f"（AI 客户端未配置）"

        # 5. 生成关联分析
        if self.config.processing.mode in ['mindmap', 'combined-mindmap'] and self.ai_client:
            print(f"\n🔗 正在生成章节关联分析...")
            connections = self.ai_client.analyze_connections(
                book_content.chapters[:10],  # 最多分析前10章
                self.config.processing.outputLanguage
            )
            if connections.success:
                print(f"   ✅ 关联分析完成")
            else:
                print(f"   ⚠️  关联分析失败: {connections.error}")

        # 6. 生成全书总结
        if self.config.processing.mode in ['summary', 'combined-mindmap'] and self.ai_client:
            print(f"\n📝 正在生成全书总结...")
            chapters_info = [
                ChapterInfo(
                    id=str(idx + 1),
                    title=ch.title,
                    content=ch.content[:500] if ch.content else "",  # 只传前500字符
                    order=idx
                )
                for idx, ch in enumerate(book_content.chapters)
            ]

            overall_summary = self.ai_client.generate_overall_summary(
                book_content.title,
                chapters_info,
                connections.content if 'connections' in dir() else "",
                self.config.processing.outputLanguage
            )

            if overall_summary.success:
                print(f"   ✅ 全书总结完成")
            else:
                print(f"   ⚠️  全书总结失败: {overall_summary.error}")

        # 7. 计算费用
        cost_usd, cost_cny = 0, 0
        if self.ai_client:
            cost_usd, cost_cny = self.ai_client.calculate_cost(
                total_input_tokens,
                total_output_tokens
            )

        # 8. 保存结果
        print(f"\n💾 正在保存结果...")

        # 生成本地内容
        local_content = self.formatter.format_result(
            title=book_content.title,
            author=book_content.author,
            chapters=chapter_results,
            overall_summary=overall_summary.content if 'overall_summary' in dir() and overall_summary.success else "",
            mode=self.config.processing.mode
        )

        # 保存到本地
        if self.config.output.localDir:
            local_file = self.formatter.save_to_file(
                local_content,
                self.config.output.localDir,
                f"{book.sanitized_name}-完整摘要.md"
            )
            print(f"   💾 已保存到本地: {local_file}")

        # 保存元数据 JSON
        metadata = {
            'fileName': book.name,
            'processedAt': datetime.now().isoformat(),
            'model': self.config.ai.model,
            'chapterDetectionMode': self.config.processing.chapterDetectionMode,
            'chapterCount': chapter_count,
            'originalCharCount': total_chars,
            'processedCharCount': len(local_content),
            'inputTokens': total_input_tokens,
            'outputTokens': total_output_tokens,
            'costUSD': cost_usd,
            'costRMB': cost_cny
        }

        meta_file = self.formatter.save_to_file(
            self.formatter.format_json(metadata),
            self.config.output.localDir,
            f"{book.sanitized_name}.meta.json"
        )
        print(f"   💾 元数据已保存: {meta_file}")

        # 同步到 WebDAV
        if self.config.output.syncToWebDAV:
            # 生成带元数据的内容
            webdav_content = self.formatter.format_with_metadata(
                local_content,
                metadata,
                self.config.advanced.exchangeRate
            )

            sync_path = f"{self.config.webdav.syncPath}/{book.sanitized_name}-完整摘要.md"
            if self.webdav.upload_file(sync_path, webdav_content):
                print(f"   ☁️  已同步到 WebDAV: {sync_path}")
            else:
                print(f"   ⚠️  WebDAV 同步失败")

        # 清理临时文件
        try:
            os.remove(local_path)
        except Exception:
            pass

        return ProcessingResult(
            success=True,
            book_name=book.name,
            metadata=metadata,
            content=local_content,
            cost_usd=cost_usd,
            cost_cny=cost_cny,
            input_tokens=total_input_tokens,
            output_tokens=total_output_tokens,
            processing_time=time.time() - start_time
        )

    def _download_book(self, book: BookFile) -> Optional[str]:
        """下载书籍到临时目录"""
        try:
            # 下载到临时目录
            local_path = os.path.join(self._temp_dir, book.name)

            if self.webdav.download_file(book.path, local_path):
                return local_path
            else:
                return None

        except Exception as e:
            self.logger.error(f"下载书籍失败: {e}")
            return None

    def _generate_report(self, result: BatchResult):
        """生成处理报告"""
        print("\n" + "=" * 60)
        print("📊 处理结果摘要")
        print("=" * 60)
        print(f"   总数: {result.total}")
        print(f"   成功: {result.success} ({result.success/result.total*100:.1f}%)" if result.total > 0 else "   成功: 0")
        print(f"   失败: {result.failed}")
        print(f"   跳过: {result.skipped}")
        print(f"   总费用: ${result.total_cost_usd:.5f} / ¥{result.total_cost_cny:.5f}")
        print(f"   总耗时: {self._format_time(result.processing_time)}")
        print("=" * 60)

        # 失败列表
        if result.failed_books:
            print("\n❌ 失败列表:")
            for item in result.failed_books:
                print(f"   - {item['name']}: {item['error']}")

        # 生成报告文件
        report_file = self._create_report_file(result)
        print(f"\n📄 详细报告: {report_file}")

    def _create_report_file(self, result: BatchResult) -> str:
        """创建报告文件"""
        report_dir = self.config.output.logDir
        os.makedirs(report_dir, exist_ok=True)

        date_str = datetime.now().strftime('%Y%m%d_%H%M%S')
        report_file = os.path.join(report_dir, f'batch_report_{date_str}.md')

        content = f"""# fastReader 批量处理报告

## 基本信息
- 生成时间: {datetime.now().isoformat()}
- 源路径: {self.config.batch.sourcePath}
- 处理模式: {self.config.processing.mode}

## 处理统计
- 总数: {result.total}
- 成功: {result.success}
- 失败: {result.failed}
- 跳过: {result.skipped}
- 总耗时: {self._format_time(result.processing_time)}

## 费用统计
- 总费用 (USD): ${result.total_cost_usd:.5f}
- 总费用 (CNY): ¥{result.total_cost_cny:.5f}

## AI 配置
- 提供商: {self.config.ai.provider}
- 模型: {self.config.ai.model}

## 失败列表
"""

        for item in result.failed_books:
            content += f"- **{item['name']}**: {item['error']}\n"

        if not result.failed_books:
            content += "\n无失败记录\n"

        content += "\n---\n*由 fastReader CLI 自动生成*\n"

        with open(report_file, 'w', encoding='utf-8') as f:
            f.write(content)

        return report_file

    def _format_time(self, seconds: float) -> str:
        """格式化时间"""
        if seconds < 60:
            return f"{seconds:.1f}秒"
        elif seconds < 3600:
            mins = int(seconds // 60)
            secs = int(seconds % 60)
            return f"{mins}分{secs}秒"
        else:
            hours = int(seconds // 3600)
            mins = int((seconds % 3600) // 60)
            return f"{hours}小时{mins}分"
