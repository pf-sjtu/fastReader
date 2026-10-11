"""
批量处理器
负责执行批量电子书处理流程
"""

import time
import sys
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
import random
import tempfile

from .config import Config, active_provider
from .webdav_client import WebDAVClientWrapper, WebDAVProbeError
from .ai_client import create_ai_client, AIClient
from .prompts import PromptTemplates, RESULT_PREFIX, failed_text, resolve_prompts_dir
from .retry import RetryPolicy
from .checkpoint import ChapterCheckpoint
from .formatter import ResultFormatter, build_metadata
from .logger import Logger
from .chapter_extractor import ChapterExtractorFactory, Chapter
from .models import BookFile, BatchResult, ProcessingResult, ChapterInfo

# 失败章节占比超过该值则整本判失败、不上传
FAILED_CHAPTER_RATIO_LIMIT = 0.5


@dataclass
class ChapterOutcome:
    """单章处理结果"""
    title: str
    summary: str
    status: str  # ok / skipped / failed
    input_tokens: int = 0
    output_tokens: int = 0
    reused: bool = False


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
        """初始化进度日志文件（追加模式，同日多次运行不互相覆盖）"""
        log_dir = self.config.output.logDir
        os.makedirs(log_dir, exist_ok=True)

        date_str = datetime.now().strftime("%Y%m%d")
        log_file = os.path.join(log_dir, f"batch_progress_{date_str}.log")

        with open(log_file, "a", encoding="utf-8") as f:
            f.write("\n# fastReader 批量处理进度日志\n")
            f.write(f"# 开始时间: {datetime.now().isoformat()}\n")
            f.write(f"# 源路径: {self.config.batch.sourcePath}\n")

        return log_file

    def _log_progress(self, log_file: str, message: str):
        """写入进度日志"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {message}\n")

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
        """打印配置摘要"""
        print("\n⚙️  配置摘要:")
        print(f"   - 处理模式: {self.config.processing.mode}")
        print(
            f"   - 书籍类型: {'小说' if self.config.processing.bookType == 'fiction' else '非小说'}"
        )
        print(f"   - AI 模型: {self.provider_name} / {self.model_name}")
        print(f"   - Prompt 版本: {self.prompt_templates.version}")
        print(f"   - 输出语言: {self.config.processing.outputLanguage}")
        print(f"   - 章节识别: {self.config.processing.chapterDetectionMode}")
        print(f"   - 章节并发: {self.config.batch.concurrency}")
        print(f"   - 跳过已处理: {'是' if self.config.batch.skipProcessed else '否'}")
        print(f"   - 重试次数: {self.config.batch.maxRetries}")
        print(
            f"   - 同步到 WebDAV: {'是' if self.config.output.syncToWebDAV else '否'}"
        )

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
        """章节级并发总结，结果保持章节顺序；成功结果逐章落盘以便断点续跑"""
        assert self.ai_client is not None
        checkpoint = ChapterCheckpoint.for_book(
            self.config.output.localDir, book.sanitized_name,
            model=self.model_name, prompt_version=self.prompt_templates.version,
            book_type=self.config.processing.bookType,
            language=self.config.processing.outputLanguage,
        )
        total = len(chapters)

        def work(idx_chapter: tuple[int, Chapter]) -> ChapterOutcome:
            idx, chapter = idx_chapter
            label = f"章节 {idx + 1}/{total}: {chapter.title[:30]}"
            key = checkpoint.key(chapter.title, chapter.content)
            cached = checkpoint.get(key)
            if cached:
                print(f"   ♻️  复用已完成{label}")
                return ChapterOutcome(chapter.title, cached["summary"], "ok",
                                      cached.get("input_tokens", 0), cached.get("output_tokens", 0), True)

            response = self.ai_client.summarize_chapter(
                ChapterInfo(id=str(idx + 1), title=chapter.title, content=chapter.content, order=idx),
                self.config.processing.bookType,
                self.config.processing.outputLanguage,
            )
            if response.skipped:
                print(f"   ⏭️  跳过{label}")
                return ChapterOutcome(chapter.title, response.content, "skipped")
            if response.success:
                checkpoint.put(key, chapter.title, response.content,
                               response.input_tokens, response.output_tokens)
                print(f"   ✅ 完成{label} (input: {response.input_tokens:,}, output: {response.output_tokens:,})")
                return ChapterOutcome(chapter.title, response.content, "ok",
                                      response.input_tokens, response.output_tokens)
            print(f"   ❌ 失败{label}: {response.error}")
            return ChapterOutcome(
                chapter.title, failed_text(RESULT_PREFIX["chapterFailed"], response.error), "failed",
                response.input_tokens, response.output_tokens,
            )

        if len(checkpoint):
            print(f"   ♻️  发现断点文件，已完成 {len(checkpoint)} 章")
        workers = max(1, min(self.config.batch.concurrency, total))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            outcomes = list(pool.map(work, enumerate(chapters)))
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
            usable = [(o.title, o.summary) for o in outcomes if o.status == "ok"]
            lang = self.config.processing.outputLanguage
            assert self.ai_client is not None

            print("\n🔗 正在生成章节关联分析...")
            conn = self.ai_client.analyze_connections(usable, lang)
            in_tok += conn.input_tokens
            out_tok += conn.output_tokens
            connections = conn.content if conn.success else failed_text(
                RESULT_PREFIX["connectionsFailed"], conn.error)
            print(f"   {'✅ 关联分析完成' if conn.success else '⚠️  关联分析失败: ' + str(conn.error)}")

            print("\n📝 正在生成全书总结...")
            overall_resp = self.ai_client.generate_overall_summary(
                book_content.title, usable, connections if conn.success else "", lang)
            in_tok += overall_resp.input_tokens
            out_tok += overall_resp.output_tokens
            overall = overall_resp.content if overall_resp.success else failed_text(
                RESULT_PREFIX["overallFailed"], overall_resp.error)
            print(f"   {'✅ 全书总结完成' if overall_resp.success else '⚠️  全书总结失败: ' + str(overall_resp.error)}")

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
        """生成处理报告"""
        print("\n" + "=" * 60)
        print("📊 处理结果摘要")
        print("=" * 60)
        print(f"   总数: {result.total}")
        print(
            f"   成功: {result.success} ({result.success / result.total * 100:.1f}%)"
            if result.total > 0
            else "   成功: 0"
        )
        print(f"   失败: {result.failed}")
        print(f"   跳过: {result.skipped}")
        print(f"   总费用: ${result.total_cost_usd:.5f} / ¥{result.total_cost_cny:.5f}")
        print(f"   总耗时: {self._format_time(result.processing_time)}")
        print("=" * 60)

        if result.failed_books:
            print("\n❌ 失败列表:")
            for item in result.failed_books:
                print(f"   - {item['name']}: {item['error']}")

        report_file = self._create_report_file(result)
        print(f"\n📄 详细报告: {report_file}")

    def _create_report_file(self, result: BatchResult) -> str:
        """创建报告文件"""
        report_dir = self.config.output.logDir
        os.makedirs(report_dir, exist_ok=True)

        date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_file = os.path.join(report_dir, f"batch_report_{date_str}.md")

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
- 提供商: {self.provider_name}
- 模型: {self.model_name}

## 失败列表
"""

        for item in result.failed_books:
            content += f"- **{item['name']}**: {item['error']}\n"

        if not result.failed_books:
            content += "\n无失败记录\n"

        content += "\n---\n*由 fastReader CLI 自动生成*\n"

        with open(report_file, "w", encoding="utf-8") as f:
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
