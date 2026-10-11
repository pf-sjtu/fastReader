#!/usr/bin/env python3
"""
fastReader CLI - 批量处理命令行工具

Usage:
    python -m src.cli.main batch --config <config.yaml>
    python -m src.cli.main batch -c <config.yaml>
    python -m src.cli.main --help
"""

import argparse
import sys
import os
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))


def _load_env() -> None:
    """加载项目 .env（放在 main() 内执行，避免 import 本模块时改动进程环境）"""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return  # python-dotenv 未安装
    env_file = project_root / '.env'
    if env_file.exists():
        load_dotenv(env_file)
        print(f"✅ 已加载环境变量: {env_file}")

from .config import ConfigLoader, validate_config, active_provider
from .batch_processor import BatchProcessor
from .logger import Logger


def create_argparse() -> argparse.ArgumentParser:
    """创建命令行参数解析器"""
    parser = argparse.ArgumentParser(
        prog='fastreader',
        description='fastReader CLI - AI 驱动的电子书批量处理工具',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # 使用配置文件运行批量处理
    python -m src.cli.main batch -c config.yaml

    # 指定不同的配置文件
    python -m src.cli.main batch --config /path/to/config.yaml

    # 显示帮助信息
    python -m src.cli.main --help
        """
    )

    subparsers = parser.add_subparsers(
        title='commands',
        dest='command',
        help='Available commands'
    )

    # batch 命令
    batch_parser = subparsers.add_parser(
        'batch',
        help='批量处理电子书',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python -m src.cli.main batch -c config.yaml
        """
    )
    batch_parser.add_argument(
        '-c', '--config',
        required=True,
        help='配置文件路径 (YAML 格式)'
    )
    batch_parser.add_argument(
        '--dry-run',
        action='store_true',
        help='试运行模式，不实际执行处理'
    )

    # version 命令
    version_parser = subparsers.add_parser(
        'version',
        help='显示版本信息'
    )

    return parser


def cmd_batch(args: argparse.Namespace) -> int:
    """执行批量处理命令"""
    config_path = args.config

    if not os.path.exists(config_path):
        print(f"❌ 配置文件不存在: {config_path}")
        return 1

    # 初始化日志
    logger = Logger()

    try:
        # 加载配置
        print("📋 加载配置...")
        config_loader = ConfigLoader(config_path)
        config = config_loader.load()

        if config is None:
            print("❌ 配置加载失败")
            return 1

        # 启动校验：越界索引 / 未定义环境变量 / 不支持的模式等一律在此报错
        errors = validate_config(config)
        if errors:
            print("❌ 配置校验失败:")
            for err in errors:
                print(f"   - {err}")
            return 1

        print("✅ 配置加载成功")
        # 日志落到配置的 logDir，debug 开关生效
        logger = Logger(log_dir=config.output.logDir, debug=config.advanced.debug)

        provider = active_provider(config.ai)
        print(f"   - AI 提供商: {provider.provider}")
        print(f"   - 模型: {provider.model}")

        print(f"   - WebDAV: {config.webdav.serverUrl}")
        print(f"   - 源路径: {config.batch.sourcePath}")
        print(f"   - 跳过已处理: {config.batch.skipProcessed}")

        # 试运行模式
        if args.dry_run:
            print("\n�Dry Run 模式 - 预览处理队列")
            # TODO: 实现预览功能
            print("预览功能待实现")
            return 0

        # 初始化批量处理器
        print("\n🚀 初始化批量处理器...")
        processor = BatchProcessor(config, logger)

        # 执行批量处理
        print("\n⏳ 开始批量处理...")
        result = processor.run()

        # 输出结果摘要
        print("\n" + "=" * 50)
        print("📊 处理结果摘要")
        print("=" * 50)
        print(f"   总数: {result.total}")
        print(f"   成功: {result.success}")
        print(f"   失败: {result.failed}")
        print(f"   跳过: {result.skipped}")
        print(f"   总费用: ${result.total_cost_usd:.5f} / ¥{result.total_cost_cny:.5f}")
        print("=" * 50)

        return 0 if result.failed == 0 else 1

    except KeyboardInterrupt:
        print("\n⚠️ 用户中断处理")
        return 130
    except Exception as e:
        print(f"\n❌ 处理失败: {e}")
        logger.error(f"批量处理异常: {e}", exc_info=True)
        return 1


def cmd_version() -> int:
    """显示版本信息"""
    from . import __version__
    print(f"fastReader CLI v{__version__}")
    return 0


def main():
    """主入口函数"""
    _load_env()
    parser = create_argparse()
    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        return 0

    if args.command == 'batch':
        return cmd_batch(args)
    elif args.command == 'version':
        return cmd_version()
    else:
        parser.print_help()
        return 1


if __name__ == '__main__':
    sys.exit(main())
