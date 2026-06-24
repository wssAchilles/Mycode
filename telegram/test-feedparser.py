import feedparser
d = feedparser.parse('https://feeds.bbci.co.uk/news/world/rss.xml')
for entry in d.entries[:3]:
    print("KEYS:", entry.keys())
    print("MEDIA THUMBNAIL:", entry.get("media_thumbnail"))
