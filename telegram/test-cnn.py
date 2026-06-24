import feedparser
import json

sources = [
    "https://www.reutersagency.com/feed/?best-topics=world-news&post_type=best",
    "http://rss.cnn.com/rss/edition.rss"
]

for url in sources:
    print(f"--- {url} ---")
    d = feedparser.parse(url)
    for entry in d.entries[:1]:
        print("KEYS:", entry.keys())
        print("MEDIA THUMBNAIL:", entry.get("media_thumbnail"))
        print("MEDIA CONTENT:", entry.get("media_content"))
        print("LINKS:", json.dumps(entry.get("links", []), indent=2))
