"""
批量报告格式化与 Logger 文件写入
"""

from src.cli.formatter import ResultFormatter
from src.cli.logger import Logger


def test_batch_report_and_save(tmp_path):
    fmt = ResultFormatter(Logger())
    report = fmt.generate_batch_report(
        total=2, success=1, failed=1, skipped=0, total_cost_usd=0.1, total_cost_cny=0.7,
        failed_books=[{"name": "a.epub", "error": "boom"}], skipped_books=[{"name": "b.epub"}],
        processing_time=3.0,
    )
    assert "| 成功率 | 50.0% |" in report
    assert "- **a.epub**: boom" in report and "- b.epub" in report
    path = fmt.save_batch_report(report, str(tmp_path / "log"))
    assert open(path, encoding="utf-8").read() == report
    assert fmt.format_json({"中": 1}) == '{\n  "中": 1\n}'


def test_logger_file_writes(tmp_path):
    logger = Logger(log_dir=str(tmp_path / "log"), debug=True)
    assert logger.get_log_content() is None
    logger.write_error("a.epub", "失败原因")
    logger.write_to_file("普通记录")
    content = logger.get_log_content()
    assert "ERROR - a.epub: 失败原因" in content and "普通记录" in content
    logger.debug_log("调试")
    logger.progress(1, 2, "进度")
    logger.success("成功")
