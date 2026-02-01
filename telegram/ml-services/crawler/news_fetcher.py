
import newspaper
import feedparser
import time
from datetime import datetime
from apscheduler.schedulers.blocking import BlockingScheduler
from sentence_transformers import SentenceTransformer
from sklearn.cluster import KMeans
import numpy as np
import json
import os

# 配置 RSS 源
RSS_FEEDS = {
    'bbc_world': 'http://newsrss.bbc.co.uk/rss/newsonline_uk_edition/world/rss.xml',
    'reuters_top': 'https://www.reutersagency.com/feed/?best-topics=top-news&post_type=best',
    'cnn_top': 'http://rss.cnn.com/rss/edition.rss',
}

# 文本嵌入模型
EMBEDDING_MODEL_NAME = 'all-MiniLM-L6-v2'

class NewsCrawler:
    def __init__(self):
        print(f"Loading embedding model: {EMBEDDING_MODEL_NAME}...")
        self.model = SentenceTransformer(EMBEDDING_MODEL_NAME)
        self.articles_buffer = []

    def fetch_rss(self):
        """抓取 RSS 源并解析全文"""
        print(f"[{datetime.now()}] Starting RSS fetch...")
        fetched_articles = []
        
        for source, url in RSS_FEEDS.items():
            try:
                feed = feedparser.parse(url)
                print(f"  - Fetching {source}: {len(feed.entries)} entries found.")
                
                # Limit to top 5 per feed to avoid timeout during full-text fetch
                for entry in feed.entries[:5]: 
                    try:
                        # 1. 初始化 article 对象
                        article_url = entry.link
                        article = newspaper.Article(article_url)
                        
                        # 2. 下载并解析
                        article.download()
                        article.parse()
                        
                        # 3. 提取内容
                        # 如果解析失败，回退到 RSS summary
                        content = article.text if article.text else entry.get('summary', '')
                        
                        # 4. 格式化内容 (简单的 Markdown 处理)
                        # 将双换行符转换为段落
                        formatted_content = content.replace('\n\n', '\n\n')
                        
                        # 5. 添加 "Read Original" 链接
                        formatted_content += f"\n\n**[阅读原文 / Read Original]({article_url})**"
                        
                        # 6. 提取图片
                        top_image = article.top_image
                        
                        article_data = {
                            'title': article.title or entry.title,
                            'url': article_url,
                            'source': source,
                            'published': entry.get('published', str(datetime.now())),
                            'content': formatted_content, # 全文内容
                            'top_image': top_image # 封面图
                        }
                        
                        fetched_articles.append(article_data)
                        # 礼貌性延迟
                        time.sleep(1)
                        
                    except Exception as e:
                        print(f"    ! Failed to parse article {entry.link}: {e}")
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
        n_clusters = min(n_clusters, len(articles) // 3) 
        if n_clusters < 2: 
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
            return

        api_endpoint = f"{backend_url}/api/space/posts/batch-news" 
        print(f"  > Pushing to: {api_endpoint}")

        # 转换格式适配后端
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
            # 真实请求 (需要 requests 库)
            import requests
            response = requests.post(api_endpoint, json=payload, headers=headers)
            if response.status_code == 200:
                 print("  > Successfully pushed news to backend.")
            else:
                 print(f"  ! Backend returned error: {response.status_code} - {response.text}")
        except Exception as e:
            print(f"  ! Error pushing to backend: {e}")

        # Mock Output (Keep for local debug logs)
        for cluster_id in set(a['cluster_id'] for a in articles):
            cluster_items = [a for a in articles if a['cluster_id'] == cluster_id]
            print(f"    [Cluster {cluster_id}] ({len(cluster_items)} items):")
            print(f"      - {cluster_items[0]['title']}")
            
    def run_job(self):
        """定时任务主逻辑"""
        print(f"[{datetime.now()}] Job started.")
        articles = self.fetch_rss()
        if articles:
            clustered = self.process_and_cluster(articles)
            self.push_to_backend(clustered)
        else:
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
