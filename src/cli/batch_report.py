"""
批量处理的进度日志、控制台摘要与报告文件（从 batch_processor 拆出，行为不变）
"""

import os
from datetime import datetime

from .config import Config
from .models import BatchResult


def format_time(seconds: float) -> str:
    """格式化时间"""
    if seconds < 60:
        return f"{seconds:.1f}秒"
    if seconds < 3600:
        mins = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{mins}分{secs}秒"
    hours = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    return f"{hours}小时{mins}分"


def init_progress_log(config: Config) -> str:
    """初始化进度日志文件（追加模式，同日多次运行不互相覆盖）"""
    log_dir = config.output.logDir
    os.makedirs(log_dir, exist_ok=True)

    date_str = datetime.now().strftime("%Y%m%d")
    log_file = os.path.join(log_dir, f"batch_progress_{date_str}.log")

    with open(log_file, "a", encoding="utf-8") as f:
        f.write("\n# fastReader 批量处理进度日志\n")
        f.write(f"# 开始时间: {datetime.now().isoformat()}\n")
        f.write(f"# 源路径: {config.batch.sourcePath}\n")

    return log_file


def log_progress(log_file: str, message: str):
    """写入进度日志"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(f"[{timestamp}] {message}\n")


def print_config_summary(config: Config, provider_name: str, model_name: str, prompt_version: str):
    """打印配置摘要"""
    print("\n⚙️  配置摘要:")
    print(f"   - 处理模式: {config.processing.mode}")
    print(f"   - 书籍类型: {'小说' if config.processing.bookType == 'fiction' else '非小说'}")
    print(f"   - AI 模型: {provider_name} / {model_name}")
    print(f"   - Prompt 版本: {prompt_version}")
    print(f"   - 输出语言: {config.processing.outputLanguage}")
    print(f"   - 章节识别: {config.processing.chapterDetectionMode}")
    print(f"   - 章节并发: {config.batch.concurrency}")
    print(f"   - 跳过已处理: {'是' if config.batch.skipProcessed else '否'}")
    print(f"   - 重试次数: {config.batch.maxRetries}")
    print(f"   - 同步到 WebDAV: {'是' if config.output.syncToWebDAV else '否'}")


def generate_report(config: Config, result: BatchResult, provider_name: str, model_name: str) -> str:
    """打印处理结果摘要并写报告文件，返回报告路径"""
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
    print(f"   总耗时: {format_time(result.processing_time)}")
    print("=" * 60)

    if result.failed_books:
        print("\n❌ 失败列表:")
        for item in result.failed_books:
            print(f"   - {item['name']}: {item['error']}")

    report_file = create_report_file(config, result, provider_name, model_name)
    print(f"\n📄 详细报告: {report_file}")
    return report_file


def create_report_file(config: Config, result: BatchResult, provider_name: str, model_name: str) -> str:
    """创建报告文件"""
    report_dir = config.output.logDir
    os.makedirs(report_dir, exist_ok=True)

    date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_file = os.path.join(report_dir, f"batch_report_{date_str}.md")

    content = f"""# fastReader 批量处理报告

## 基本信息
- 生成时间: {datetime.now().isoformat()}
- 源路径: {config.batch.sourcePath}
- 处理模式: {config.processing.mode}

## 处理统计
- 总数: {result.total}
- 成功: {result.success}
- 失败: {result.failed}
- 跳过: {result.skipped}
- 总耗时: {format_time(result.processing_time)}

## 费用统计
- 总费用 (USD): ${result.total_cost_usd:.5f}
- 总费用 (CNY): ¥{result.total_cost_cny:.5f}

## AI 配置
- 提供商: {provider_name}
- 模型: {model_name}

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
