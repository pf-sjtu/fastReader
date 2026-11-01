"""
数据模型定义
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from enum import Enum
import re

CACHE_FILE_SUFFIX = "-完整摘要.md"


def sanitize_file_name(file_name: str) -> str:
    """严格对齐前端 cloudCacheService.ts sanitizeFileName（约定 C10）：
    1. 只去掉最后一个扩展名：/\\.[^/.]+$/（与大小写无关）
    2. 删除 Windows 非法字符 <>:"/\\|?*
    3. 连续空白合并为一个空格并 trim（JS \\s 含 \\ufeff，Python 需显式补上）
    """
    without_ext = re.sub(r'\.[^/.]+\Z', '', file_name)
    sanitized = re.sub(r'[<>:"/\\|?*]', '', without_ext)
    return re.sub(r'[\s﻿]+', ' ', sanitized).strip()


class QueueItemStatus(Enum):
    """队列项状态"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class BookFile:
    """电子书文件"""
    name: str
    path: str
    extension: str  # .epub, .pdf, .txt, .md
    size: int
    last_modified: datetime

    @property
    def sanitized_name(self) -> str:
        """获取清理后的名称（与前端 cloudCacheService.sanitizeFileName 一致）"""
        return sanitize_file_name(self.name)

    @property
    def cache_file_name(self) -> str:
        """云端缓存文件名 {sanitizedName}-完整摘要.md"""
        return f"{self.sanitized_name}{CACHE_FILE_SUFFIX}"


@dataclass
class QueueItem:
    """批量队列项"""
    id: str
    book: BookFile
    status: QueueItemStatus = QueueItemStatus.PENDING
    progress: float = 0.0
    error: Optional[str] = None
    retry_count: int = 0
    metadata: dict = field(default_factory=dict)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

    @property
    def cache_file_name(self) -> str:
        """获取缓存文件名"""
        return f"{self.book.sanitized_name}-完整摘要.md"


@dataclass
class ProcessingResult:
    """处理结果"""
    success: bool
    book_name: str
    error: Optional[str] = None
    metadata: Optional[dict] = None
    content: Optional[str] = None
    cost_usd: float = 0.0
    cost_cny: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    processing_time: float = 0.0


@dataclass
class BatchResult:
    """批量处理结果"""
    total: int = 0
    success: int = 0
    failed: int = 0
    skipped: int = 0
    total_cost_usd: float = 0.0
    total_cost_cny: float = 0.0
    processing_time: float = 0.0
    failed_books: list = field(default_factory=list)
    skipped_books: list = field(default_factory=list)


@dataclass
class ChapterInfo:
    """章节信息"""
    id: str
    title: str
    content: str
    level: int = 0
    order: int = 0


@dataclass
class ChapterData:
    """章节数据（用于处理）"""
    title: str
    content: str
    index: int
