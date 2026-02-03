import json
import os
import re
import time
from datetime import datetime
from pathlib import Path

import feedparser
import newspaper
from apscheduler.schedulers.blocking import BlockingScheduler
from sentence_transformers import SentenceTransformer
from sklearn.cluster import KMeans
from urllib3.util.retry import Retry
from requests.adapters import HTTPAdapter
import requests

# 配置 RSS 源
RSS_FEEDS = {
    'bbc_world': 'http://newsrss.bbc.co.uk/rss/newsonline_uk_edition/world/rss.xml',
    'reuters_top': 'https://www.reutersagency.com/feed/?best-topics=top-news&post_type=best',
    'cnn_top': 'http://rss.cnn.com/rss/edition.rss',
}

# 文本嵌入模型
EMBEDDING_MODEL_NAME = 'all-MiniLM-L6-v2'

# Crawler 可靠性配置
DEFAULT_UA = os.getenv(
    'CRAWLER_USER_AGENT',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
)
REQUEST_TIMEOUT = int(os.getenv('CRAWLER_REQUEST_TIMEOUT', '12'))
MAX_RETRIES = int(os.getenv('CRAWLER_MAX_RETRIES', '2'))
SLEEP_SEC = float(os.getenv('CRAWLER_SLEEP_SEC', '0.4'))
LAST_CRAWL_PATH = Path(__file__).resolve().parents[1] / 'data' / 'last_crawl.json'


def _trim_summary(text: str, max_len: int = 180) -> str:
    cleaned = re.sub(r'<[^>]+>', ' ', text or '')
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    if len(cleaned) <= max_len:
        return cleaned
    return f"{cleaned[:max_len]}..."


def _parse_published(entry) -> str:
    for key in ('published_parsed', 'updated_parsed'):
        value = entry.get(key)
        if value:
            return datetime.fromtimestamp(time.mktime(value)).isoformat()
    return datetime.now().isoformat()


class NewsCrawler:
    def __init__(self):
        print(f"Loading embedding model: {EMBEDDING_MODEL_NAME}...")
        self.model = SentenceTransformer(EMBEDDING_MODEL_NAME)
        self.articles_buffer = []

        retry = Retry(
            total=MAX_RETRIES,
            backoff_factor=0.6,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST"],
        )
        adapter = HTTPAdapter(max_retries=retry)
        self.session = requests.Session()
        self.session.mount('http://', adapter)
        self.session.mount('https://', adapter)
        self.session.headers.update({'User-Agent': DEFAULT_UA})

        config = newspaper.Config()
        config.browser_user_agent = DEFAULT_UA
        config.request_timeout = REQUEST_TIMEOUT
        config.memoize_articles = False
        self.article_config = config

    def fetch_rss(self):
        """抓取 RSS 源并解析全文"""
        print(f"[{datetime.now()}] Starting RSS fetch...")
        fetched_articles = []
        seen_urls = set()

        for source, url in RSS_FEEDS.items():
            try:
                response = self.session.get(url, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                feed = feedparser.parse(response.content)
                print(f"  - Fetching {source}: {len(feed.entries)} entries found.")

                # Limit to top 5 per feed to avoid timeout during full-text fetch
                for entry in feed.entries[:5]:
                    article_url = entry.get('link')
                    if not article_url or article_url in seen_urls:
                        continue
                    seen_urls.add(article_url)

                    try:
                        article = newspaper.Article(article_url, config=self.article_config)
                        article.download()
                        article.parse()

                        summary = entry.get('summary', '')
                        content = article.text or summary
                        if not content:
                            continue

                        formatted_content = content.replace('\n\n', '\n\n').strip()
                        formatted_content += f"\n\n**[阅读原文 / Read Original]({article_url})**"

                        article_data = {
                            'title': article.title or entry.get('title', '新闻速递'),
                            'url': article_url,
                            'source': source,
                            'published': _parse_published(entry),
                            'content': formatted_content,
                            'summary': _trim_summary(summary or content),
                            'top_image': article.top_image,
                        }

                        fetched_articles.append(article_data)
                        time.sleep(SLEEP_SEC)
                    except Exception as e:
                        print(f"    ! Failed to parse article {article_url}: {e}")
                        continue

            except Exception as e:
                print(f"  ! Error fetching {source}: {e}")

        print(f"  > Total articles fetched: {len(fetched_articles)}")
        return fetched_articles

    def process_and_cluster(self, articles, n_clusters=5):
        """生成 Embedding 并聚类"""
        if not articles:
            return []

        print("  > Generating embeddings...")
        titles = [a['title'] for a in articles]
        embeddings = self.model.encode(titles)

        # 动态调整聚类数量
        n_clusters = min(n_clusters, max(1, len(articles) // 3))
        if n_clusters < 1:
            n_clusters = 1

        print(f"  > Clustering into {n_clusters} topics...")
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        kmeans.fit(embeddings)
        labels = kmeans.labels_

        # 附加聚类信息
        clustered_articles = []
        for idx, article in enumerate(articles):
            article['cluster_id'] = int(labels[idx])
            article['embedding'] = embeddings[idx].tolist()
            clustered_articles.append(article)

        return clustered_articles

    def push_to_backend(self, articles):
        """推送新闻到后端"""
        backend_url = os.getenv('BACKEND_URL')
        if not backend_url:
            print("  ! Error: BACKEND_URL not found in .env")
            return 0

        api_endpoint = f"{backend_url}/api/space/posts/batch-news"
        print(f"  > Pushing to: {api_endpoint}")

        payload = {
            "articles": articles
        }

        cron_secret = os.getenv("CRON_SECRET")
        headers = {}
        if cron_secret:
            headers["Authorization"] = f"Bearer {cron_secret}"
        else:
            print("  ! Warning: CRON_SECRET not found, request might fail")

        try:
            response = self.session.post(api_endpoint, json=payload, headers=headers, timeout=REQUEST_TIMEOUT)
            if response.status_code == 200:
                print("  > Successfully pushed news to backend.")
                try:
                    return int(response.json().get('count', 0))
                except Exception:
                    return len(articles)
            print(f"  ! Backend returned error: {response.status_code} - {response.text}")
            return 0
        except Exception as e:
            print(f"  ! Error pushing to backend: {e}")
            return 0

    def record_last_crawl(self, fetched_count: int, pushed_count: int):
        payload = {
            "last_crawl_time": datetime.now().isoformat(),
            "fetched_count": fetched_count,
            "pushed_count": pushed_count,
        }
        try:
            LAST_CRAWL_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(LAST_CRAWL_PATH, 'w', encoding='utf-8') as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            print(f"  > Last crawl recorded: {payload['last_crawl_time']}")
        except Exception as e:
            print(f"  ! Failed to record last crawl: {e}")

    def run_job(self):
        """定时任务主逻辑"""
        print(f"[{datetime.now()}] Job started.")
        articles = self.fetch_rss()
        if articles:
            clustered = self.process_and_cluster(articles)
            pushed = self.push_to_backend(clustered)
            self.record_last_crawl(len(clustered), pushed)
        else:
            self.record_last_crawl(0, 0)
            print("  > No articles found.")


if __name__ == "__main__":
    # 加载环境变量
    from dotenv import load_dotenv
    # 向上寻找 .env (假设在根目录)
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.env')
    print(f"Loading .env from: {env_path}")
    load_dotenv(env_path)

    crawler = NewsCrawler()

    # 立即运行一次测试
    crawler.run_job()

    # 启动调度器 (每小时运行)
    print("\nStarting Scheduler (Interval: 1 hour)...")
    scheduler = BlockingScheduler()
    scheduler.add_job(crawler.run_job, 'interval', hours=1)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        pass
