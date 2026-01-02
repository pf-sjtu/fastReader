"""
数据模型定义
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from enum import Enum


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
    extension: str  # .epub, .pdf
    size: int
    last_modified: datetime

    @property
    def sanitized_name(self) -> str:
        """获取清理后的名称"""
        # 移除扩展名
        name = self.name.replace(self.extension, '')
        # 移除特殊字符
        for char in '<>:"/\\|?*':
            name = name.replace(char, '')
        # 合并多个空格
        import re
        name = re.sub(r'\s+', ' ', name).strip()
        return name


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
class BookInfo:
    """书籍信息"""
    title: str
    author: str
    chapters: list[ChapterInfo]
    total_char_count: int = 0


@dataclass
class ChapterData:
    """章节数据（用于处理）"""
    title: str
    content: str
    index: int
