"""
批量处理器
负责执行批量电子书处理流程
"""

import time
import sys
import os
import shutil
from typing import Optional
import random
import tempfile

from .config import Config, active_provider
from .webdav_client import WebDAVClientWrapper, WebDAVProbeError
from .ai_client import create_ai_client, AIClient
from .prompts import PromptTemplates, resolve_prompts_dir
from .retry import RetryPolicy
from .checkpoint import ChapterCheckpoint
from .formatter import ResultFormatter, build_metadata
from .logger import Logger
from .chapter_extractor import ChapterExtractorFactory, Chapter
from .models import BookFile, BatchResult, ProcessingResult
from . import batch_report
from .chapter_summarizer import (
    FAILED_CHAPTER_RATIO_LIMIT, ChapterOutcome, post_process, summarize_chapters,
)

__all__ = ["BatchProcessor", "ChapterOutcome", "FAILED_CHAPTER_RATIO_LIMIT"]


class BatchProcessor:
    """批量处理器"""

    def __init__(self, config: Config, logger: Logger):
        self.config = config
        self.logger = logger
        self.webdav = WebDAVClientWrapper(config.webdav, logger)

        # Prompt 模板：配置 promptVersionConfig > 共享 YAML
        self.prompt_templates = PromptTemplates(
            prompt_config=config.prompts,
            prompts_dir=resolve_prompts_dir(config.advanced.promptsDir),
        )
        retry_policy = RetryPolicy(
            max_retries=config.batch.maxRetries, delays=list(config.batch.retryDelays)
        )
        self.ai_client: Optional[AIClient] = create_ai_client(
            config.ai, logger, self.prompt_templates,
            retry_policy=retry_policy,
            timeout=config.advanced.requestTimeout,
            exchange_rate=config.advanced.exchangeRate,
        )
        self.formatter = ResultFormatter(logger)
        self._start_time: Optional[float] = None
        self._temp_dir: Optional[str] = None

    @property
    def model_name(self) -> str:
        """实际使用的提供商的模型名（多提供商时不读顶层空 model）"""
        provider = active_provider(self.config.ai)
        return (getattr(provider, "model", "") if provider else "") or self.config.ai.model

    @property
    def provider_name(self) -> str:
        provider = active_provider(self.config.ai)
        return getattr(provider, "provider", "") if provider else self.config.ai.provider

    def run(self) -> BatchResult:
        """执行批量处理"""
        self._start_time = time.time()
        self._temp_dir = tempfile.mkdtemp(prefix="fastreader_")
        log_file = self._init_progress_log()

        try:
            print("\n" + "=" * 60)
            print("🚀 fastReader CLI - 批量处理工具 v1.0.0")
            print("=" * 60)

            if self.ai_client is None:
                self.logger.error("AI 客户端初始化失败")
                return BatchResult(
                    failed=1,
                    failed_books=[{"name": "初始化", "error": "AI 客户端初始化失败"}],
                )

            print("\n📂 正在连接 WebDAV...")
            if not self.webdav.connect():
                self.logger.error("WebDAV 连接失败")
                return BatchResult(
                    failed=1,
                    failed_books=[{"name": "初始化", "error": "WebDAV 连接失败"}],
                )

            print("✅ WebDAV 连接成功")
            print(f"   - 服务器: {self.config.webdav.serverUrl}")
            print(f"   - 同步路径: {self.config.webdav.syncPath}")

            print(f"\n📋 扫描文件夹: {self.config.batch.sourcePath}")
            books = self.webdav.list_books(self.config.batch.sourcePath)

            if not books:
                print("\n⚠️  未找到可处理的电子书")
                return BatchResult()

            cached_files = self._load_cached_file_names()
            skipped = 0
            if self.config.batch.skipProcessed and cached_files:
                original_count = len(books)
                books = [book for book in books if book.cache_file_name not in cached_files]
                skipped = original_count - len(books)
                if skipped > 0:
                    print(f"   ⏭️  已过滤已处理文件: {skipped} 本")

            if self.config.batch.order == "random":
                random.shuffle(books)
                print("🎲 处理顺序: 随机")
            else:
                books.sort(key=lambda b: b.name)
                print("📄 处理顺序: 顺序")

            if self.config.batch.maxFiles > 0:
                books = books[: self.config.batch.maxFiles]
                print(f"📊 限制处理数量: {len(books)}")

            print(f"\n📚 找到 {len(books)} 本待处理书籍")
            self._print_config_summary()

            # 确认开始（非交互环境如 CI / 管道 / 计划任务不阻塞）
            print("\n" + "-" * 60)
            if sys.stdin is not None and sys.stdin.isatty():
                input("按 Enter 开始处理... (Ctrl+C 取消) ")
            else:
                print("非交互环境，自动开始处理")
            print("-" * 60)

            result = self._process_books(books, log_file, cached_files)
            if skipped > 0:
                result.skipped += skipped

            self._generate_report(result)
            return result

        except KeyboardInterrupt:
            print("\n⚠️  用户中断处理")
            return BatchResult()
        except Exception as e:
            self.logger.error(f"批量处理异常: {e}", exc_info=True)
            return BatchResult(
                failed=1, failed_books=[{"name": "未知", "error": str(e)}]
            )
        finally:
            if self._temp_dir and os.path.exists(self._temp_dir):
                shutil.rmtree(self._temp_dir, ignore_errors=True)
            self.webdav.disconnect()

    def _init_progress_log(self) -> str:
        return batch_report.init_progress_log(self.config)

    def _log_progress(self, log_file: str, message: str):
        batch_report.log_progress(log_file, message)

    def _load_cached_file_names(self) -> set[str]:
        """加载云端缓存文件名集合（{sanitizedName}-完整摘要.md）"""
        if not self.config.batch.skipProcessed:
            return set()

        try:
            cached_files = self.webdav.list_cache_files()
        except WebDAVProbeError as e:
            raise WebDAVProbeError(
                f"云端缓存探测失败，已中止以免重复处理: {e}"
            ) from e
        if cached_files:
            print(f"☁️  已获取缓存列表: {len(cached_files)} 项")
        return cached_files

    def _print_config_summary(self):
        batch_report.print_config_summary(
            self.config, self.provider_name, self.model_name, self.prompt_templates.version)

    def _process_books(
        self, books: list[BookFile], log_file: str, cached_files: set[str]
    ) -> BatchResult:
        """处理书籍列表"""
        result = BatchResult(total=len(books))

        for i, book in enumerate(books):
            tag = f"[{i + 1}/{len(books)}]"
            self._log_progress(log_file, f"开始处理 {tag}: {book.name}")
            book_start_time = time.time()

            print(f"\n{'=' * 60}")
            print(f"[{i + 1:02d}/{len(books)}] 📖 开始处理: {book.name}")
            print(f"{'=' * 60}")

            try:
                book_result = self._process_single_book(book, cached_files)
            except KeyboardInterrupt:
                print("\n⚠️  用户中断处理")
                break
            except Exception as e:
                book_result = ProcessingResult(success=False, book_name=book.name, error=f"处理异常: {e}")

            book_time = time.time() - book_start_time
            if book_result.success:
                result.success += 1
                result.total_cost_usd += book_result.cost_usd
                result.total_cost_cny += book_result.cost_cny

                print(f"\n✅ 处理完成: {book.name}")
                print(f"   ⏱️  耗时: {self._format_time(book_time)}")
                print(f"   💰 费用: ${book_result.cost_usd:.5f} / ¥{book_result.cost_cny:.5f}")
                if book_result.input_tokens > 0:
                    print(
                        f"   📊 Token: 输入 {book_result.input_tokens:,} | 输出 {book_result.output_tokens:,}"
                    )
                self._log_progress(
                    log_file,
                    f"完成 {tag}: {book.name} - 成功 - 耗时 {book_time:.1f}s - 费用 ${book_result.cost_usd:.5f}",
                )
            else:
                result.failed += 1
                result.failed_books.append({"name": book.name, "error": book_result.error})
                print(f"\n❌ 处理失败: {book.name}")
                print(f"   错误: {book_result.error}")
                self._log_progress(log_file, f"失败 {tag}: {book.name} - {book_result.error}")
                self.logger.write_error(book.name, str(book_result.error))

        result.processing_time = time.time() - (self._start_time or 0)
        return result

    # ---- 单本书 ----

    def _summarize_chapters(
        self, book: BookFile, chapters: list[Chapter]
    ) -> tuple[list[ChapterOutcome], ChapterCheckpoint]:
        """章节级并发总结（断点按书 + 模型 + prompt 版本 + 类型 + 语言隔离）"""
        assert self.ai_client is not None
        checkpoint = ChapterCheckpoint.for_book(
            self.config.output.localDir, book.sanitized_name,
            model=self.model_name, prompt_version=self.prompt_templates.version,
            book_type=self.config.processing.bookType,
            language=self.config.processing.outputLanguage,
        )
        outcomes = summarize_chapters(
            self.ai_client, checkpoint, chapters,
            self.config.processing.bookType, self.config.processing.outputLanguage,
            self.config.batch.concurrency,
        )
        return outcomes, checkpoint

    def _process_single_book(
        self, book: BookFile, cached_files: set[str]
    ) -> ProcessingResult:
        """处理单本书"""
        start_time = time.time()

        def fail(error: str) -> ProcessingResult:
            return ProcessingResult(success=False, book_name=book.name, error=error,
                                    processing_time=time.time() - start_time)

        # 1. 下载
        print(f"\n📥 正在下载: {book.name}...")
        local_path = self._download_book(book)
        if not local_path:
            return fail("下载书籍失败")

        try:
            # 2. 提取章节
            print("📖 正在提取章节...")
            mode = self.config.processing.chapterDetectionMode
            try:
                extractor = ChapterExtractorFactory.create(local_path, mode, self.config.processing.epubTocDepth)
                book_content = extractor.extract(local_path)
            except Exception as e:
                return fail(f"章节提取失败: {e}")
            for warning in extractor.warnings:
                self.logger.warning(warning)

            chapters = book_content.chapters
            total_chars = sum(len(ch.content) for ch in chapters)
            print(f"   ✅ 提取到 {len(chapters)} 个章节，总字符数 {total_chars:,}")
            if not chapters:
                return fail("未提取到任何章节")

            # 3. 云端已有缓存
            if book.cache_file_name in cached_files:
                print("\n⏭️  发现缓存，跳过处理")
                return ProcessingResult(success=True, book_name=book.name,
                                        processing_time=time.time() - start_time)

            # 4. 章节摘要
            print(f"\n🤖 正在调用 AI 处理（并发 {self.config.batch.concurrency}）...")
            outcomes, checkpoint = self._summarize_chapters(book, chapters)
            in_tok = sum(o.input_tokens for o in outcomes)
            out_tok = sum(o.output_tokens for o in outcomes)
            failed = sum(1 for o in outcomes if o.status == "failed")
            skipped = sum(1 for o in outcomes if o.status == "skipped")

            if failed / len(outcomes) > FAILED_CHAPTER_RATIO_LIMIT:
                return fail(
                    f"章节失败 {failed}/{len(outcomes)}，超过 {int(FAILED_CHAPTER_RATIO_LIMIT * 100)}%，"
                    "未生成/上传结果（已完成章节已落盘，重跑可续）"
                )

            # 5. 后处理只喂成功章节
            assert self.ai_client is not None
            post = post_process(self.ai_client, outcomes, book_content.title,
                                self.config.processing.outputLanguage)
            in_tok += post.input_tokens
            out_tok += post.output_tokens
            connections, overall = post.connections, post.overall

            # 6. 费用（含关联/全书 token）
            cost_usd, cost_cny = self.ai_client.calculate_cost(in_tok, out_tok)

            # 7. 生成产物（与前端统一格式一致）
            chapter_rows = [(o.title, o.summary) for o in outcomes]
            metadata = build_metadata(
                file_name=book.name,
                model=self.model_name,
                chapter_detection_mode=mode,
                epub_toc_depth=self.config.processing.epubTocDepth if mode == "epub-toc" else None,
                selected_chapters=list(range(1, len(outcomes) + 1)),
                chapter_count=len(chapters),
                original_char_count=total_chars,
                processed_char_count=sum(len(s) for _, s in chapter_rows) + len(connections) + len(overall),
                input_tokens=in_tok,
                output_tokens=out_tok,
                cost_usd=cost_usd,
                cost_cny=cost_cny,
                skipped_chapters=skipped,
                is_partial=(failed + skipped) > 0,
            )
            author = book_content.author if book_content.author != "Unknown Author" else ""
            content = self.formatter.format_summary(
                book_content.title, author, chapter_rows, connections, overall,
                metadata, self.config.advanced.exchangeRate,
            )

            print("\n💾 正在保存结果...")
            local_dir = self.config.output.localDir
            if local_dir:
                local_file = self.formatter.save_to_file(content, local_dir, book.cache_file_name)
                print(f"   💾 已保存到本地: {local_file}")
                self.formatter.save_to_file(
                    self.formatter.format_json(metadata), local_dir, f"{book.sanitized_name}.meta.json")

            if self.config.output.syncToWebDAV:
                remote = self.webdav.cache_path_for(book)
                if not self.webdav.upload_file(remote, content):
                    return fail(f"WebDAV 上传失败: {remote}（本地结果已保存）")
                print(f"   ☁️  已同步到 WebDAV: {remote}")

            checkpoint.clear()
            if failed:
                print(f"   ⚠️  部分章节失败: {failed}/{len(outcomes)}（isPartial: true）")

            return ProcessingResult(
                success=True,
                book_name=book.name,
                metadata=metadata,
                content=content,
                cost_usd=cost_usd,
                cost_cny=cost_cny,
                input_tokens=in_tok,
                output_tokens=out_tok,
                processing_time=time.time() - start_time,
            )
        finally:
            try:
                os.remove(local_path)
            except OSError:
                pass

    def _download_book(self, book: BookFile) -> Optional[str]:
        """下载书籍到临时目录"""
        try:
            if not self._temp_dir:
                raise RuntimeError("临时目录未初始化")
            local_path = os.path.join(self._temp_dir, book.name)
            if self.webdav.download_file(book.path, local_path):
                return local_path
            return None
        except Exception as e:
            self.logger.error(f"下载书籍失败: {e}")
            return None

    def _generate_report(self, result: BatchResult):
        batch_report.generate_report(self.config, result, self.provider_name, self.model_name)

    def _format_time(self, seconds: float) -> str:
        return batch_report.format_time(seconds)
