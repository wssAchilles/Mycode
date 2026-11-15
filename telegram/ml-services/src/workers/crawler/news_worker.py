"""异步新闻爬虫与定时调度入口，从在线推理容器 app.py 彻底剥离。"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional


def run_news_crawl_once(*, output_path: Optional[Path] = None) -> Dict[str, Any]:
    """延迟加载重型爬虫模块执行单次新闻抓取，确保仅在 Worker 环境引用 newspaper3k。"""
    from crawler.news_fetcher import NewsCrawler

    crawler = NewsCrawler()
    items = crawler.fetch_all() if hasattr(crawler, "fetch_all") else []
    return {
        "fetchedCount": len(items),
        "outputPath": str(output_path) if output_path else None,
    }
