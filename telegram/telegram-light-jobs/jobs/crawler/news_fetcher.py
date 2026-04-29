import os
import re
import time
from datetime import datetime
from typing import Dict, List

import feedparser
import newspaper
import requests
from requests.adapters import HTTPAdapter
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from urllib3.util.retry import Retry


RSS_FEEDS = {
    "bbc_world": "https://feeds.bbci.co.uk/news/world/rss.xml",
    "guardian_world": "https://www.theguardian.com/world/rss",
    "npr_world": "https://feeds.npr.org/1004/rss.xml",
}

DEFAULT_UA = os.getenv(
    "CRAWLER_USER_AGENT",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
)
REQUEST_TIMEOUT = int(os.getenv("CRAWLER_REQUEST_TIMEOUT", "12"))
MAX_RETRIES = int(os.getenv("CRAWLER_MAX_RETRIES", "2"))
SLEEP_SEC = float(os.getenv("CRAWLER_SLEEP_SEC", "0.4"))
MAX_ENTRIES_PER_FEED = int(os.getenv("CRAWLER_MAX_ENTRIES_PER_FEED", "5"))


def _trim_summary(text: str, max_len: int = 180) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", text or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) <= max_len:
        return cleaned
    return f"{cleaned[:max_len]}..."


def _parse_published(entry) -> str:
    for key in ("published_parsed", "updated_parsed"):
        value = entry.get(key)
        if value:
            return datetime.fromtimestamp(time.mktime(value)).isoformat()
    return datetime.now().isoformat()


def _extract_rss_image(entry) -> str:
    try:
        for key in ("media_thumbnail", "media_content"):
            value = entry.get(key)
            if isinstance(value, list) and value:
                url = value[0].get("url")
                if url:
                    return url
        for link in entry.get("links", []) or []:
            if (link.get("type") or "").startswith("image") and link.get("href"):
                return link["href"]
    except Exception:
        pass
    return ""


class NewsCrawler:
    def __init__(self):
        retry = Retry(
            total=MAX_RETRIES,
            backoff_factor=0.6,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST"],
        )
        adapter = HTTPAdapter(max_retries=retry)
        self.session = requests.Session()
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        self.session.headers.update({"User-Agent": DEFAULT_UA})

        config = newspaper.Config()
        config.browser_user_agent = DEFAULT_UA
        config.request_timeout = REQUEST_TIMEOUT
        config.memoize_articles = False
        self.article_config = config

    def fetch_rss(self) -> List[dict]:
        print(f"[{datetime.now()}] Starting RSS fetch...")
        fetched_articles = []
        seen_urls = set()

        for source, url in RSS_FEEDS.items():
            try:
                response = self.session.get(url, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                feed = feedparser.parse(response.content)
                print(f"  - Fetching {source}: {len(feed.entries)} entries found.")

                for entry in feed.entries[:MAX_ENTRIES_PER_FEED]:
                    article_url = entry.get("link")
                    if not article_url or article_url in seen_urls:
                        continue
                    seen_urls.add(article_url)

                    summary = entry.get("summary", "") or entry.get("description", "") or ""
                    rss_image = _extract_rss_image(entry)

                    try:
                        article = newspaper.Article(article_url, config=self.article_config)
                        article.download()
                        article.parse()

                        content = article.text or summary
                        if not content:
                            continue

                        fetched_articles.append(
                            {
                                "title": article.title or entry.get("title", "新闻速递"),
                                "url": article_url,
                                "source_url": article_url,
                                "source": source,
                                "published": _parse_published(entry),
                                "content": content.strip() + f"\n\n**[阅读原文 / Read Original]({article_url})**",
                                "summary": _trim_summary(summary or content),
                                "top_image": article.top_image or rss_image,
                                "images": list(article.images)[:5] if article.images else ([rss_image] if rss_image else []),
                            }
                        )
                    except Exception as exc:
                        print(f"    ! Failed to parse article {article_url}, fallback to RSS summary: {exc}")
                        if not summary:
                            continue
                        fetched_articles.append(
                            {
                                "title": entry.get("title", "新闻速递"),
                                "url": article_url,
                                "source_url": article_url,
                                "source": source,
                                "published": _parse_published(entry),
                                "content": summary.strip() + f"\n\n**[阅读原文 / Read Original]({article_url})**",
                                "summary": _trim_summary(summary),
                                "top_image": rss_image,
                                "images": [rss_image] if rss_image else [],
                            }
                        )
                    time.sleep(SLEEP_SEC)
            except Exception as exc:
                print(f"  ! Error fetching {source}: {exc}")

        print(f"  > Total articles fetched: {len(fetched_articles)}")
        return fetched_articles

    def process_and_cluster(self, articles: List[dict], n_clusters: int = 5) -> List[dict]:
        if not articles:
            return []

        titles = [article["title"] for article in articles]
        vectorizer = TfidfVectorizer(max_features=512, stop_words="english")
        embeddings = vectorizer.fit_transform(titles).toarray()

        n_clusters = min(n_clusters, max(1, len(articles) // 3))
        print(f"  > Clustering into {n_clusters} topics with TF-IDF...")
        labels = KMeans(n_clusters=n_clusters, random_state=42, n_init=10).fit(embeddings).labels_

        for idx, article in enumerate(articles):
            article["cluster_id"] = int(labels[idx])
            article["embedding"] = embeddings[idx].tolist()
        return articles

    def push_to_backend(self, articles: List[dict]) -> int:
        backend_url = os.getenv("BACKEND_URL", "").strip()
        if not backend_url:
            print("  ! BACKEND_URL is not configured")
            return 0

        headers: Dict[str, str] = {}
        cron_secret = os.getenv("CRON_SECRET", "").strip()
        if cron_secret:
            headers["Authorization"] = f"Bearer {cron_secret}"

        endpoint = f"{backend_url.rstrip('/')}/api/news/ingest"
        print(f"  > Pushing to: {endpoint}")
        try:
            response = self.session.post(endpoint, json={"articles": articles}, headers=headers, timeout=REQUEST_TIMEOUT)
            if response.status_code == 200:
                print("  > Successfully pushed news to backend.")
                try:
                    return int(response.json().get("count", 0))
                except Exception:
                    return len(articles)
            print(f"  ! Backend returned error: {response.status_code} - {response.text}")
            return 0
        except Exception as exc:
            print(f"  ! Error pushing to backend: {exc}")
            return 0

    def run_job(self) -> dict:
        articles = self.fetch_rss()
        if not articles:
            return {"fetched_count": 0, "clustered_count": 0, "pushed_count": 0}

        clustered = self.process_and_cluster(articles)
        pushed = self.push_to_backend(clustered)
        return {
            "fetched_count": len(articles),
            "clustered_count": len(clustered),
            "pushed_count": pushed,
        }


_crawler: NewsCrawler | None = None


def run_crawler_job() -> dict:
    global _crawler
    if _crawler is None:
        _crawler = NewsCrawler()
    return _crawler.run_job()
