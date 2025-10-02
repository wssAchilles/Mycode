# flask/app/search_service.py

"""
高级搜索服务 - 全文搜索引擎
集成Whoosh提供更准确的搜索结果和相关性排序
支持中文分词、语义搜索、搜索建议等功能
"""

import os
import re
try:
    import jieba
    JIEBA_AVAILABLE = True
except Exception:
    # 允许在缺少 jieba 依赖时降级运行（使用通用分词器作为回退）
    jieba = None
    JIEBA_AVAILABLE = False
from datetime import datetime
from flask import current_app # 确保导入 current_app

# --- Whoosh 模块导入和可用性判断 ---
# 正确导入索引函数（Whoosh 提供的是 create_in/open_dir/exists_in）
try:
    from whoosh.index import create_in as create_index, open_dir as open_index, exists_in
    WHOOSH_INDEX_FUNCS_IMPORTED = True
except Exception:
    create_index = None
    open_index = None
    exists_in = None
    WHOOSH_INDEX_FUNCS_IMPORTED = False
        
try:
    from whoosh.filedb.filestore import FileStorage
    from whoosh.qparser import MultifieldParser, QueryParser
    from whoosh.query import Term, Or, And
    from whoosh.writing import BufferedWriter
    from whoosh.collectors import TimeLimitCollector, TimeLimit
    from whoosh.scoring import WeightingModel, BM25F
    from whoosh import fields, analysis
    from whoosh.analysis import StandardAnalyzer, CharsetFilter, LowercaseFilter, StopFilter
    WHOOSH_MODULES_IMPORTED = True # 新名称：明确表示 Whoosh 模块是否成功导入
except ImportError:
    WHOOSH_MODULES_IMPORTED = False
    FileStorage = None
    MultifieldParser = None
    QueryParser = None
    Term = Or = And = None
    BufferedWriter = None
    TimeLimitCollector = TimeLimit = None
    WeightingModel = BM25F = None
    StandardAnalyzer = CharsetFilter = LowercaseFilter = StopFilter = None
    accent_map = None

from app.models import Post, Category, Tag, User
from app import db
from sqlalchemy import or_


# 当 Whoosh 模块不可用时，analysis 可能为 None。为避免导入期错误，这里做条件定义。
if WHOOSH_MODULES_IMPORTED:
    class ChineseAnalyzer(analysis.Analyzer):
        """中文分析器，使用jieba分词"""
        
        def __init__(self):
            # 加载用户词典（可选）
            # jieba.load_userdict("custom_dict.txt") 
            pass
        
        def __call__(self, text, **kwargs):
            # 如果 jieba 不可用，回退到 StandardAnalyzer，保证功能可用性
            if jieba is None:
                try:
                    fallback = StandardAnalyzer()
                    for token in fallback(text):
                        yield token
                    return
                except Exception:
                    # 最后兜底：不输出任何 token，避免抛错
                    for _ in []:
                        yield _
                    return
            # 使用 jieba 进行中文分词，并为 Whoosh Token 设置必须的属性
            pos = 0
            offset = 0
            for word in jieba.cut_for_search(text):
                w = word.strip().lower()
                if not w:
                    continue
                token = analysis.Token(text=w)
                # 必需属性：词位/字符范围
                token.pos = pos
                token.startchar = offset
                token.endchar = offset + len(w)
                yield token
                pos += 1
                # 使用原分词长度推进偏移（与 w 等长，此处更直观）
                offset += len(word)
else:
    class ChineseAnalyzer:
        """占位分析器：当 Whoosh 不可用时避免导入期异常。不会被实际使用。"""
        def __init__(self, *args, **kwargs):
            pass
        def __call__(self, text, **kwargs):
            # 返回空的生成器，确保被误用时也不会抛错
            for _ in []:
                yield _


class AdvancedSearchService:
    """高级搜索服务"""
    
    def __init__(self, index_dir=None):
        self._is_initialized = False # 标记是否已成功初始化 Whoosh
        self.whoosh_available = False # 初始设置为 False，等待延迟初始化
        self.index_dir = index_dir
        self.schema = None
        self.index = None
        
        # 不要在这里直接调用 current_app 或进行 Whoosh 初始化
        # 初始化逻辑放在 _deferred_init 中，由 init_search_service 调用

    def _deferred_init(self):
        """延迟初始化 Whoosh 相关的索引和模式，确保在应用上下文中运行"""
        if self._is_initialized: # 避免重复初始化
            return

        # 检查 Whoosh 模块及索引方法是否已成功导入
        if not WHOOSH_MODULES_IMPORTED or not WHOOSH_INDEX_FUNCS_IMPORTED:
            current_app.logger.warning("Whoosh库模块未完全加载，高级搜索不可用。将使用基础搜索功能。")
            self.whoosh_available = False
            return
        
        # 确保 current_app 在这里是可用的
        if not current_app:
            current_app.logger.error("AdvancedSearchService 尝试在无应用上下文时进行延迟初始化。")
            self.whoosh_available = False
            return

        # 如果到达这里，说明 Whoosh 模块已导入且 current_app 可用
        self.whoosh_available = True 

        if self.index_dir is None:
            self.index_dir = os.path.join(current_app.instance_path, 'search_index')
        
        os.makedirs(self.index_dir, exist_ok=True)
        
        # 定义搜索架构
        self.schema = fields.Schema(
            id=fields.NUMERIC(stored=True, unique=True),
            title=fields.TEXT(stored=True, analyzer=ChineseAnalyzer(), field_boost=3.0),
            content=fields.TEXT(stored=True, analyzer=ChineseAnalyzer(), field_boost=1.0),
            summary=fields.TEXT(stored=True, analyzer=ChineseAnalyzer(), field_boost=2.0),
            tags=fields.TEXT(stored=True, analyzer=ChineseAnalyzer(), field_boost=1.5),
            category=fields.TEXT(stored=True, analyzer=ChineseAnalyzer(), field_boost=1.2),
            author=fields.TEXT(stored=True, analyzer=ChineseAnalyzer()),
            published=fields.BOOLEAN(stored=True),
            timestamp=fields.DATETIME(stored=True), # Whoosh 索引的字段
            views=fields.NUMERIC(stored=True),
            slug=fields.ID(stored=True)
        )
        
        self._init_index_instance() # 调用真正的索引文件初始化
        self._is_initialized = True # 标记初始化成功

    def _init_index_instance(self): # 重命名以区分
        """初始化或打开搜索索引的实际文件操作"""
        if not self.whoosh_available:
            return

        try:
            if exists_in(self.index_dir):
                self.index = open_index(self.index_dir)
                current_app.logger.info("搜索索引已加载")
            else:
                self.index = create_index(self.index_dir, self.schema)
                current_app.logger.info("搜索索引已创建")
                # 首次创建时建立索引
                # 在这里调用 rebuild_index 可能会导致额外的日志，但在首次设置时通常是安全的
                # 最好通过 CLI 命令进行首次构建，这里作为自动恢复机制
                self.rebuild_index() 
        except Exception as e:
            current_app.logger.error(f"Whoosh搜索索引文件操作失败: {e}，尝试重建索引...")
            # 如果索引损坏，重新创建
            try:
                import shutil
                if os.path.exists(self.index_dir):
                    shutil.rmtree(self.index_dir) # 彻底删除旧索引
                os.makedirs(self.index_dir, exist_ok=True)
                self.index = create_index(self.index_dir, self.schema)
                self.rebuild_index()
                current_app.logger.info("Whoosh搜索索引成功重建。")
            except Exception as rebuild_error:
                current_app.logger.error(f"Whoosh重建索引失败: {rebuild_error}。高级搜索功能将不可用。")
                self.whoosh_available = False # 如果重建也失败，标记 Whoosh 不可用
                self.index = None # 清空索引对象

    # --- 以下方法需要添加 whoosh_available 和 self.index 的检查，并修正 timestamp 引用 ---

    def add_post_to_index(self, post):
        """添加单篇文章到索引"""
        if not self.whoosh_available or not self.index:
            current_app.logger.warning("Whoosh服务不可用或索引未加载，无法添加文章到索引。")
            return False
        
        try:
            writer = self.index.writer()
            tags_text = ' '.join([tag.name for tag in post.tags]) if post.tags else ''
            content_text = self._clean_html(post.content)
            
            writer.add_document(
                id=post.id,
                title=post.title or '',
                content=content_text,
                summary=post.summary or '',
                tags=tags_text,
                category=post.category.name if post.category else '',
                author=post.author.username if post.author else '',
                published=post.published,
                # 关键修改：使用 post.published_at 作为 Whoosh 的 timestamp 字段
                timestamp=post.published_at if post.published_at else post.created_at,
                views=post.views or 0,
                slug=post.slug or ''
            )
            writer.commit()
            return True
        except Exception as e:
            current_app.logger.error(f"添加文章到搜索索引失败: {e}")
            return False
    
    def update_post_in_index(self, post):
        """更新索引中的文章"""
        if not self.whoosh_available or not self.index:
            current_app.logger.warning("Whoosh服务不可用或索引未加载，无法更新文章索引。")
            return False
        
        try:
            writer = self.index.writer()
            writer.delete_by_term('id', post.id) # 删除旧文档
            
            tags_text = ' '.join([tag.name for tag in post.tags]) if post.tags else ''
            content_text = self._clean_html(post.content)
            
            writer.add_document(
                id=post.id,
                title=post.title or '',
                content=content_text,
                summary=post.summary or '',
                tags=tags_text,
                category=post.category.name if post.category else '',
                author=post.author.username if post.author else '',
                published=post.published,
                # 关键修改：使用 post.published_at 作为 Whoosh 的 timestamp 字段
                timestamp=post.published_at if post.published_at else post.created_at,
                views=post.views or 0,
                slug=post.slug or ''
            )
            writer.commit()
            return True
        except Exception as e:
            current_app.logger.error(f"更新搜索索引失败: {e}")
            return False
    
    def remove_post_from_index(self, post_id):
        """从索引中删除文章"""
        if not self.whoosh_available or not self.index:
            current_app.logger.warning("Whoosh服务不可用或索引未加载，无法从索引删除文章。")
            return False
        
        try:
            writer = self.index.writer()
            writer.delete_by_term('id', post_id)
            writer.commit()
            return True
        except Exception as e:
            current_app.logger.error(f"从搜索索引删除文章失败: {e}")
            return False
    
    def rebuild_index(self):
        """重建完整搜索索引"""
        if not self.whoosh_available: # 优先检查 whoosh_available，因为可能索引根本没成功创建
            current_app.logger.warning("Whoosh服务不可用，无法重建索引。")
            return False
        
        try:
            # 清空并重建索引的可靠方法：删除目录并重新创建
            import shutil
            if os.path.exists(self.index_dir):
                shutil.rmtree(self.index_dir) # 删除旧索引目录
            os.makedirs(self.index_dir, exist_ok=True) # 创建新目录
            self.index = create_index(self.index_dir, self.schema) # 重新创建索引
            
            writer = self.index.writer() # 获取新索引的 writer
            
            posts = Post.query.filter_by(published=True).all()
            
            for post in posts:
                tags_text = ' '.join([tag.name for tag in post.tags]) if post.tags else ''
                content_text = self._clean_html(post.content)
                
                writer.add_document(
                    id=post.id,
                    title=post.title or '',
                    content=content_text,
                    summary=post.summary or '',
                    tags=tags_text,
                    category=post.category.name if post.category else '',
                    author=post.author.username if post.author else '',
                    published=post.published,
                    # 关键修改：使用 post.published_at 作为 Whoosh 的 timestamp 字段
                    timestamp=post.published_at if post.published_at else post.created_at,
                    views=post.views or 0,
                    slug=post.slug or ''
                )
            writer.commit()
            current_app.logger.info(f"搜索索引重建完成，索引了 {len(posts)} 篇文章")
            return True
        except Exception as e:
            current_app.logger.error(f"重建搜索索引失败: {e}")
            return False
    
    def search(self, query_text, page=1, per_page=10, filters=None):
        """
        高级搜索功能
        
        Args:
            query_text: 搜索关键词
            page: 页码
            per_page: 每页结果数
            filters: 搜索过滤器 {'category': 'tech', 'author': 'admin'}
        
        Returns:
            dict: 搜索结果和元数据
        """
        # 记录查询（用于热门搜索统计）
        try:
            if query_text and query_text.strip():
                self._record_query(query_text)
        except Exception as _e:
            # 记录失败不影响搜索主流程
            if current_app:
                current_app.logger.warning(f"记录搜索关键词失败: {_e}")

        # 如果Whoosh不可用，使用基础搜索
        if not self.whoosh_available:
            current_app.logger.info("Whoosh不可用，回退到基础搜索。")
            return self._basic_search(query_text, page, per_page, filters)
            
        if not hasattr(self, 'index') or not self.index or not query_text.strip():
            return {
                'results': [], 'total': 0, 'page': page, 'per_page': per_page,
                'suggestions': [], 'query': query_text
            }
        
        try:
            searcher = self.index.searcher(weighting=BM25F())
            
            # 创建多字段解析器
            parser = MultifieldParser(
                ['title', 'content', 'summary', 'tags', 'category', 'author'],
                schema=self.index.schema
            )
            
            # 解析查询
            query = parser.parse(query_text)
            
            # 添加过滤器
            if filters:
                filter_terms = []
                for field, value in filters.items():
                    if field in self.schema and value:
                        filter_terms.append(Term(field, value))
                
                if filter_terms:
                    if len(filter_terms) == 1:
                        query = And([query, filter_terms[0]])
                    else:
                        query = And([query] + filter_terms)
            
            # 只搜索已发布的文章
            query = And([query, Term('published', True)])
            
            # 执行搜索
            results = searcher.search(query, limit=per_page * 10) # 获取更多结果用于分页
            
            # 计算分页
            total = len(results)
            start = (page - 1) * per_page
            end = start + per_page
            page_results = results[start:end]
            
            # 构造结果
            search_results = []
            for hit in page_results:
                result = {
                    'id': hit['id'],
                    'title': hit['title'],
                    'summary': hit['summary'],
                    'category': hit['category'],
                    'author': hit['author'],
                    # 关键修改：这里也使用正确的 timestamp 字段
                    'timestamp': hit['timestamp'],
                    # 兼容模板：提供 created_at / published_at 字段
                    'created_at': hit['timestamp'],
                    'published_at': hit['timestamp'],
                    'views': hit['views'],
                    'slug': hit['slug'],
                    'score': hit.score,
                    'highlights': self._get_highlights(hit, query_text)
                }
                search_results.append(result)
            
            # 生成搜索建议
            suggestions = self.get_search_suggestions(query_text)
            
            return {
                'results': search_results,
                'total': total,
                'page': page,
                'per_page': per_page,
                'pages': (total + per_page - 1) // per_page,
                'has_prev': page > 1,
                'has_next': page * per_page < total,
                'suggestions': suggestions,
                'query': query_text
            }
            
        except Exception as e:
            current_app.logger.error(f"Whoosh搜索执行失败: {e}")
            return {
                'results': [],
                'total': 0,
                'page': page,
                'per_page': per_page,
                'suggestions': [],
                'error': str(e),
                'query': query_text
            }
    
    def get_search_suggestions(self, query_text, limit=10):
        """获取搜索建议和自动补全"""
        if not self.whoosh_available or not self.index or not query_text.strip():
            return []
        
        try:
            searcher = self.index.searcher()
            
            # 基于词汇的建议
            suggestions = []
            seen = set()  # 去重（不区分大小写）
            
            # 搜索标题字段的词汇
            title_reader = searcher.lexicon('title')
            for term in title_reader:
                term_text = term.decode('utf-8', 'ignore') if isinstance(term, (bytes, bytearray)) else term
                if not isinstance(term_text, str):
                    continue
                t_lower = term_text.lower()
                if query_text.lower() in t_lower and len(term_text) > len(query_text) and t_lower not in seen:
                    seen.add(t_lower)
                    suggestions.append({
                        'text': term_text,
                        'type': 'title',
                        'score': self._calculate_suggestion_score(term_text, query_text)
                    })
            
            # 搜索标签字段的词汇
            tag_reader = searcher.lexicon('tags')
            for term in tag_reader:
                term_text = term.decode('utf-8', 'ignore') if isinstance(term, (bytes, bytearray)) else term
                if not isinstance(term_text, str):
                    continue
                t_lower = term_text.lower()
                if query_text.lower() in t_lower and len(term_text) > len(query_text) and t_lower not in seen:
                    seen.add(t_lower)
                    suggestions.append({
                        'text': term_text,
                        'type': 'tag',
                        'score': self._calculate_suggestion_score(term_text, query_text)
                    })
            
            # 按分数排序并限制数量
            suggestions.sort(key=lambda x: x['score'], reverse=True)
            return suggestions[:limit]
            
        except Exception as e:
            current_app.logger.error(f"获取搜索建议失败: {e}")
            return []
    
    def get_popular_searches(self, limit=10):
        """获取热门搜索词（基于日志统计）"""
        try:
            log_path = os.path.join(current_app.instance_path, 'search_queries.log')
            if not os.path.exists(log_path):
                return []
            from collections import Counter
            cnt = Counter()
            with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    # 行格式：ISO_TIME\tquery
                    parts = line.rstrip('\n').split('\t', 1)
                    if len(parts) == 2:
                        q = parts[1].strip()
                        if q:
                            cnt[q] += 1
            # 返回按次数排序的前 N 个词
            return [term for term, _ in cnt.most_common(limit)]
        except Exception as e:
            current_app.logger.warning(f"读取热门搜索日志失败: {e}")
            return []

    def _record_query(self, query_text):
        """将搜索关键词记录到实例目录日志，用于统计热门搜索。"""
        try:
            if not query_text or not query_text.strip():
                return
            log_dir = current_app.instance_path
            os.makedirs(log_dir, exist_ok=True)
            log_path = os.path.join(log_dir, 'search_queries.log')
            with open(log_path, 'a', encoding='utf-8') as f:
                f.write(f"{datetime.utcnow().isoformat()}\t{query_text.strip()}\n")
        except Exception as e:
            # 仅记录告警，不抛出
            current_app.logger.warning(f"写入搜索日志失败: {e}")
    
    def _clean_html(self, html_text):
        """清理HTML标签，保留纯文本"""
        if not html_text:
            return ''
        
        # 移除HTML标签
        clean_text = re.sub(r'<[^>]+>', '', html_text)
        
        # 移除多余的空白字符
        clean_text = re.sub(r'\s+', ' ', clean_text).strip()
        
        return clean_text
    
    def _get_highlights(self, hit, query_text):
        """获取搜索结果高亮片段"""
        highlights = {}
        
        try:
            # 简单的高亮实现
            for field in ['title', 'content', 'summary']:
                if field in hit:
                    text = str(hit[field])
                    if text and query_text.lower() in text.lower():
                        # 创建高亮片段
                        highlighted = self._highlight_text(text, query_text)
                        highlights[field] = highlighted
            
            return highlights
            
        except Exception as e:
            current_app.logger.error(f"生成高亮失败: {e}")
            return {}
    
    def _highlight_text(self, text, query_text, max_length=200):
        """在文本中高亮查询词汇"""
        if not text or not query_text:
            return text[:max_length] + '...' if len(text) > max_length else text
        
        # 查找查询词在文本中的位置
        query_lower = query_text.lower()
        text_lower = text.lower()
        
        # 找到第一个匹配位置
        match_pos = text_lower.find(query_lower)
        if match_pos == -1:
            return text[:max_length] + '...' if len(text) > max_length else text
        
        # 计算高亮片段的开始和结束位置
        start = max(0, match_pos - max_length // 3)
        end = min(len(text), start + max_length)
        
        # 提取片段
        snippet = text[start:end]
        
        # 添加省略号
        if start > 0:
            snippet = '...' + snippet
        if end < len(text):
            snippet = snippet + '...'
        
        # 高亮查询词
        pattern = re.compile(re.escape(query_text), re.IGNORECASE)
        highlighted = pattern.sub(f'<mark>{query_text}</mark>', snippet)
        
        return highlighted
    
    def _calculate_suggestion_score(self, term, query_text):
        """计算搜索建议的相关性分数"""
        # 简单的相关性计算
        if term.lower().startswith(query_text.lower()):
            return 10 # 前缀匹配高分
        elif query_text.lower() in term.lower():
            return 5 # 包含匹配中分
        else:
            return 1 # 其他情况低分
    
    def get_stats(self):
        """获取搜索索引统计信息"""
        if not self.whoosh_available or not self.index: # 检查 Whoosh 可用性
            current_app.logger.warning("Whoosh服务不可用或索引未加载，无法获取统计信息。")
            return {}
        
        try:
            searcher = self.index.searcher()
            return {
                'total_documents': searcher.doc_count(),
                'index_size': self._get_index_size(),
                'last_updated': datetime.now().isoformat()
            }
        except Exception as e:
            current_app.logger.error(f"获取索引统计失败: {e}")
            return {}
    
    def _get_index_size(self):
        """获取索引文件大小"""
        try:
            total_size = 0
            # 确保 index_dir 存在且 Whoosh 可用
            if not self.whoosh_available or not self.index_dir or not os.path.exists(self.index_dir):
                return 0
            for root, dirs, files in os.walk(self.index_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    total_size += os.path.getsize(file_path)
            return total_size
        except Exception:
            return 0
    
    def _basic_search(self, query_text, page=1, per_page=10, filters=None):
        """
        基础搜索功能（当Whoosh不可用时使用）
        """
        try:
            # 构建基础查询
            query = Post.query.filter(Post.published == True)
            
            # 搜索标题和内容
            search_filter = or_(
                Post.title.contains(query_text),
                Post.content.contains(query_text),
                Post.summary.contains(query_text)
            )
            query = query.filter(search_filter)
            
            # 应用额外过滤器
            if filters:
                if filters.get('category'):
                    query = query.join(Category).filter(Category.name == filters['category'])
                if filters.get('author'):
                    query = query.join(User).filter(User.username == filters['author'])
            
            # 按相关性排序（标题匹配优先）
            # 关键修改：Post.timestamp 不存在，应该使用 Post.published_at 优先
            query = query.order_by(Post.published_at.desc() if hasattr(Post, 'published_at') else Post.created_at.desc())
            
            # 分页
            paginated = query.paginate(
                page=page, 
                per_page=per_page, 
                error_out=False
            )
            
            # 格式化结果
            results = []
            for post in paginated.items:
                results.append({
                    'id': post.id,
                    'title': post.title,
                    'content': post.content[:200] + '...' if len(post.content) > 200 else post.content,
                    'summary': post.summary,
                    'author': post.author.username,
                    'category': post.category.name if post.category else '',
                    # 关键修改：这里也使用正确的 timestamp 字段
                    'timestamp': post.published_at if post.published_at else post.created_at,
                    # 兼容模板：提供 created_at / published_at 字段
                    'created_at': post.created_at,
                    'published_at': post.published_at,
                    'slug': post.slug,
                    'views': post.views,
                    'score': 1.0 # 基础搜索没有评分
                })
            
            return {
                'results': results,
                'total': paginated.total,
                'page': page,
                'per_page': per_page,
                'suggestions': [] # 基础搜索不提供建议
            }
            
        except Exception as e:
            current_app.logger.error(f"基础搜索失败: {e}")
            return {
                'results': [],
                'total': 0,
                'page': page,
                'per_page': per_page,
                'suggestions': []
            }

# 全局搜索服务实例
search_service = None # 保持 None

def init_search_service(app):
    """初始化搜索服务"""
    global search_service
    with app.app_context(): # 确保在应用上下文中运行
        if search_service is None:
            search_service = AdvancedSearchService()
            # 触发延迟初始化，确保 current_app 可用
            search_service._deferred_init() # <-- 新增：触发延迟初始化
    return search_service

def get_search_service():
    """获取搜索服务实例"""
    global search_service
    # 如果这里 search_service 仍为 None，说明初始化失败，记录错误并返回 None
    if search_service is None:
        if current_app: # 只有在有应用上下文时才记录到 logger
            current_app.logger.error("Whoosh 搜索服务实例未初始化。搜索功能可能受限。")
        else: # 如果连 current_app 都没有，直接打印到控制台
            print("ERROR: Whoosh 搜索服务实例未初始化，且无应用上下文。")
    return search_service