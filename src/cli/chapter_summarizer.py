"""
单本书的 AI 流程：章节级并发摘要（含断点复用）+ 关联分析 / 全书总结后处理
（从 batch_processor 拆出，行为不变）
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from .ai_client import AIClient
from .chapter_extractor import Chapter
from .chapter_meta import check_summary_quality, clean_chapter_summary, split_chapter_meta
from .checkpoint import ChapterCheckpoint
from .models import ChapterInfo
from .prompts import RESULT_PREFIX, SHARED_STRINGS, failed_text
from .rich_blocks import rich_block_count, strip_rich_blocks
from .rich_repair import repair_rich_blocks

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


def _blocking(issues: list[str]) -> list[str]:
    return [i for i in issues if i != "noMeta"]


def _finalize(raw: str, input_chars: int) -> tuple[str, list[str]]:
    """拆旁路 + 程序化清理 + 质量判定（与前端同一套规则；字数只看正文，富内容块不计入）"""
    meta = split_chapter_meta(raw)[1]
    summary = clean_chapter_summary(raw)
    return summary, check_summary_quality(summary, input_chars, True, meta is not None)


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
            # v3 输出带 JSON 旁路：CLI 只要正文，并做与前端一致的程序化清理 + 质量判定
            in_tok, out_tok = response.input_tokens, response.output_tokens
            summary, issues = _finalize(response.content, len(chapter.content))
            if _blocking(issues):
                # 过短：只做一次带说明的定向重写（又一次付费调用，token 计入）；仍不达标则保留首轮结果
                print(f"   ✏️  {label} 正文偏短，定向重写一次")
                info = ChapterInfo(id=str(idx + 1), title=chapter.title, content=chapter.content, order=idx)
                retry = ai_client.summarize_chapter(info, book_type, language, hint=SHARED_STRINGS["rewriteHintTooShort"])
                in_tok += retry.input_tokens
                out_tok += retry.output_tokens
                if retry.success and not retry.skipped:
                    r_summary, r_issues = _finalize(retry.content, len(chapter.content))
                    if len(_blocking(r_issues)) <= len(_blocking(issues)) and len(r_summary) >= len(summary) * 0.8:
                        summary, issues = r_summary, r_issues
            if _blocking(issues):
                print(f"   ⚠️  {label} 正文仍偏短，已保留")
            checkpoint.put(key, chapter.title, summary, in_tok, out_tok)
            print(f"   ✅ 完成{label} (input: {in_tok:,}, output: {out_tok:,})")
            return ChapterOutcome(chapter.title, summary, "ok", in_tok, out_tok)
        print(f"   ❌ 失败{label}: {response.error}")
        return ChapterOutcome(
            chapter.title, failed_text(RESULT_PREFIX["chapterFailed"], response.error), "failed",
            response.input_tokens, response.output_tokens,
        )

    if len(checkpoint):
        print(f"   ♻️  发现断点文件，已完成 {len(checkpoint)} 章")
    workers = max(1, min(concurrency, total))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        outcomes = list(pool.map(work, enumerate(chapters)))
    _repair_blocks(ai_client, checkpoint, chapters, outcomes, language)
    return outcomes


def _repair_blocks(ai_client: AIClient, checkpoint: ChapterCheckpoint, chapters: list[Chapter],
                   outcomes: list[ChapterOutcome], language: str) -> None:
    """富内容块（mermaid / genui / html）统一修复：只依据生成内容本身，一次（分批）LLM 调用；
    修好写回断点（重跑不再重修），仍坏的块删掉，正文逐字不变。与前端 bookPipeline 同语义。
    修复调用的 token 记到第一章（费用总额要算全，不展开到各章）。"""
    if not hasattr(ai_client, "repair_rich_blocks"):
        return
    ok = [i for i, o in enumerate(outcomes) if o.status == "ok"]
    if not any(rich_block_count(outcomes[i].summary) for i in ok):
        return
    usage = {"in": 0, "out": 0}

    def repair(items: list[dict]) -> list[dict]:
        fixes, in_tok, out_tok = ai_client.repair_rich_blocks(items, language)
        usage["in"] += in_tok
        usage["out"] += out_tok
        return fixes

    result = repair_rich_blocks([outcomes[i].summary for i in ok], repair)
    for n in result.changed:
        o = outcomes[ok[n]]
        o.summary = result.summaries[n]
        checkpoint.put(checkpoint.key(chapters[ok[n]].title, chapters[ok[n]].content), o.title, o.summary,
                       o.input_tokens, o.output_tokens)
    if ok:
        outcomes[ok[0]].input_tokens += usage["in"]
        outcomes[ok[0]].output_tokens += usage["out"]
    if result.stats.bad:
        print(f"   🧩 富内容块修复：坏 {result.stats.bad}，修好 {result.stats.fixed}，删除 {result.stats.dropped}")


def post_process(
    ai_client: AIClient, outcomes: list[ChapterOutcome], book_title: str, language: str,
) -> PostProcessResult:
    """后处理只喂成功章节；关联失败时全书总结不带关联文本"""
    # 富内容块不计字数、也不进下游 prompt：只喂正文（与前端 promptChapters 一致）；剔完没有正文的章节不喂
    usable = [(o.title, strip_rich_blocks(o.summary)) for o in outcomes if o.status == "ok" and strip_rich_blocks(o.summary).strip()]

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
