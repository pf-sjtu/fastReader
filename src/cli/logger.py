"""
日志工具
负责处理 CLI 的日志输出和文件记录
"""

import os
import sys
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional


class Logger:
    """日志工具类"""

    def __init__(
        self,
        log_dir: str = "log/",
        debug: bool = False
    ):
        self.log_dir = Path(log_dir)
        self.debug = debug
        self.log_file: Optional[Path] = None
        self.logger = self._setup_logger()

    def _setup_logger(self) -> logging.Logger:
        """设置 logger"""
        logger = logging.getLogger('fastreader')
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)

        # 清除已有 handler
        logger.handlers.clear()

        # 创建控制台 handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.DEBUG if self.debug else logging.INFO)
        console_formatter = logging.Formatter(
            '%(message)s'
        )
        console_handler.setFormatter(console_formatter)
        logger.addHandler(console_handler)

        return logger

    def _ensure_log_dir(self):
        """确保日志目录存在"""
        if not self.log_dir.exists():
            self.log_dir.mkdir(parents=True)

    def _get_log_filename(self) -> str:
        """获取日志文件名"""
        return f"batch_{datetime.now().strftime('%Y%m%d')}.log"

    def info(self, message: str):
        """输出信息"""
        self.logger.info(message)

    def success(self, message: str):
        """输出成功信息"""
        self.logger.info(f"✅ {message}")

    def error(self, message: str, exc_info: bool = False):
        """输出错误信息"""
        self.logger.error(f"❌ {message}", exc_info=exc_info)

    def warning(self, message: str):
        """输出警告信息"""
        self.logger.warning(f"⚠️ {message}")

    def debug_log(self, message: str):
        """输出调试信息"""
        if self.debug:
            self.logger.debug(f"🔍 {message}")

    def progress(self, current: int, total: int, message: str = ""):
        """输出进度信息"""
        percent = (current / total * 100) if total > 0 else 0
        self.logger.info(f"📊 [{current}/{total}] ({percent:.1f}%) {message}")

    def write_to_file(self, content: str):
        """写入日志文件"""
        self._ensure_log_dir()

        if self.log_file is None:
            self.log_file = self.log_dir / self._get_log_filename()

        with open(self.log_file, 'a', encoding='utf-8') as f:
            timestamp = datetime.now().isoformat()
            f.write(f"[{timestamp}] {content}\n")

    def write_error(self, file_name: str, error: str):
        """写入错误日志"""
        self._ensure_log_dir()

        if self.log_file is None:
            self.log_file = self.log_dir / self._get_log_filename()

        timestamp = datetime.now().isoformat()
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(f"[{timestamp}] ERROR - {file_name}: {error}\n")

    def get_log_content(self) -> Optional[str]:
        """获取日志文件内容"""
        if self.log_file and self.log_file.exists():
            return self.log_file.read_text(encoding='utf-8')
        return None
