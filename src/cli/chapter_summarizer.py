"""
单本书的 AI 流程：章节级并发摘要（含断点复用）+ 关联分析 / 全书总结后处理
（从 batch_processor 拆出，行为不变）
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from .ai_client import AIClient
from .chapter_extractor import Chapter
from .chapter_meta import clean_chapter_summary
from .checkpoint import ChapterCheckpoint
from .models import ChapterInfo
from .prompts import RESULT_PREFIX, failed_text

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


@dataclass
class PostProcessResult:
    """关联分析 + 全书总结（失败时为带前缀的占位文本）"""
    connections: str
    overall: str
    input_tokens: int
    output_tokens: int


def summarize_chapters(
    ai_client: AIClient, checkpoint: ChapterCheckpoint, chapters: list[Chapter],
    book_type: str, language: str, concurrency: int,
) -> list[ChapterOutcome]:
    """章节级并发总结，结果保持章节顺序；成功结果逐章落盘以便断点续跑"""
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

        response = ai_client.summarize_chapter(
            ChapterInfo(id=str(idx + 1), title=chapter.title, content=chapter.content, order=idx),
            book_type, language,
        )
        if response.skipped:
            print(f"   ⏭️  跳过{label}")
            return ChapterOutcome(chapter.title, response.content, "skipped")
        if response.success:
            # v3 输出带 JSON 旁路：CLI 只要正文，并做与前端一致的程序化清理
            summary = clean_chapter_summary(response.content)
            checkpoint.put(key, chapter.title, summary,
                           response.input_tokens, response.output_tokens)
            print(f"   ✅ 完成{label} (input: {response.input_tokens:,}, output: {response.output_tokens:,})")
            return ChapterOutcome(chapter.title, summary, "ok",
                                  response.input_tokens, response.output_tokens)
        print(f"   ❌ 失败{label}: {response.error}")
        return ChapterOutcome(
            chapter.title, failed_text(RESULT_PREFIX["chapterFailed"], response.error), "failed",
            response.input_tokens, response.output_tokens,
        )

    if len(checkpoint):
        print(f"   ♻️  发现断点文件，已完成 {len(checkpoint)} 章")
    workers = max(1, min(concurrency, total))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(work, enumerate(chapters)))


def post_process(
    ai_client: AIClient, outcomes: list[ChapterOutcome], book_title: str, language: str,
) -> PostProcessResult:
    """后处理只喂成功章节；关联失败时全书总结不带关联文本"""
    usable = [(o.title, o.summary) for o in outcomes if o.status == "ok"]

    print("\n🔗 正在生成章节关联分析...")
    conn = ai_client.analyze_connections(usable, language)
    connections = conn.content if conn.success else failed_text(
        RESULT_PREFIX["connectionsFailed"], conn.error)
    print(f"   {'✅ 关联分析完成' if conn.success else '⚠️  关联分析失败: ' + str(conn.error)}")

    print("\n📝 正在生成全书总结...")
    overall_resp = ai_client.generate_overall_summary(
        book_title, usable, connections if conn.success else "", language)
    overall = overall_resp.content if overall_resp.success else failed_text(
        RESULT_PREFIX["overallFailed"], overall_resp.error)
    print(f"   {'✅ 全书总结完成' if overall_resp.success else '⚠️  全书总结失败: ' + str(overall_resp.error)}")

    return PostProcessResult(
        connections, overall,
        conn.input_tokens + overall_resp.input_tokens,
        conn.output_tokens + overall_resp.output_tokens,
    )
