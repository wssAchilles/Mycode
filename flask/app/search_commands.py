"""
搜索管理CLI命令
提供搜索索引的构建、更新、维护等命令行工具
"""

import click
from flask.cli import with_appcontext
from app.search_service import get_search_service
from app.models import Post

@click.group()
def search():
    """搜索索引管理命令"""
    pass

@search.command()
@with_appcontext
def build():
    """构建搜索索引"""
    click.echo('开始构建搜索索引...')
    
    search_service = get_search_service()
    
    if search_service.rebuild_index():
        stats = search_service.get_stats()
        click.echo(f'搜索索引构建完成！')
        click.echo(f'索引文档数: {stats.get("total_documents", 0)}')
        click.echo(f'索引大小: {stats.get("index_size", 0)} 字节')
    else:
        click.echo('搜索索引构建失败！')

@search.command()
@with_appcontext
def update():
    """更新搜索索引"""
    click.echo('开始更新搜索索引...')
    
    search_service = get_search_service()
    
    # 获取所有文章并更新索引
    posts = Post.query.all()
    updated_count = 0
    
    for post in posts:
        if post.published:
            if search_service.update_post_in_index(post):
                updated_count += 1
        else:
            # 如果文章未发布，从索引中删除
            search_service.remove_post_from_index(post.id)
    
    click.echo(f'搜索索引更新完成！更新了 {updated_count} 篇文章')

@search.command()
@with_appcontext
def stats():
    """显示搜索索引统计信息"""
    search_service = get_search_service()
    stats = search_service.get_stats()
    
    click.echo('搜索索引统计信息:')
    click.echo(f'  总文档数: {stats.get("total_documents", 0)}')
    click.echo(f'  索引大小: {stats.get("index_size", 0)} 字节')
    click.echo(f'  最后更新: {stats.get("last_updated", "未知")}')

@search.command()
@click.option('--limit', default=10, help='显示前N个热门搜索词')
@with_appcontext
def popular(limit):
    """显示热门搜索词（基于搜索日志统计）"""
    search_service = get_search_service()
    terms = search_service.get_popular_searches(limit=limit)
    if not terms:
        click.echo('暂无热门搜索数据（可能尚无搜索日志）。')
        return
    click.echo('热门搜索词:')
    for i, term in enumerate(terms, 1):
        click.echo(f'  {i}. {term}')

@search.command()
@click.argument('query')
@with_appcontext
def test(query):
    """测试搜索功能"""
    click.echo(f'测试搜索: "{query}"')
    
    search_service = get_search_service()
    results = search_service.search(query, page=1, per_page=5)
    
    click.echo(f'找到 {results["total"]} 个结果:')
    
    for result in results['results']:
        click.echo(f'  - [{result["id"]}] {result["title"]} (评分: {result["score"]:.2f})')
    
    if results['suggestions']:
        click.echo('\n搜索建议:')
        for suggestion in results['suggestions']:
            click.echo(f'  - {suggestion["text"]} ({suggestion["type"]})')

def init_search_commands(app):
    """注册搜索管理命令"""
    app.cli.add_command(search)
