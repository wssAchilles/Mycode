"""
缓存管理CLI命令
提供缓存清理、预热、统计等功能
"""

import click
from flask.cli import with_appcontext
from app import cache
from app.cache_service import CacheInvalidation # CacheInvalidation 确实在 cache_service 中
from app.models import Post, User, Category
import time

@click.group()
def cache_cli():
    """缓存管理命令"""
    pass

@cache_cli.command()
@with_appcontext
def clear():
    """清空所有缓存"""
    try:
        cache.clear()
        click.echo("✅ 所有缓存已清空")
    except Exception as e:
        click.echo(f"❌ 清空缓存失败: {e}")

@cache_cli.command()
@with_appcontext
def warmup():
    """预热缓存"""
    click.echo("🔥 开始缓存预热...")
    start_time = time.time()

    try:
        # 预热文章列表缓存
        click.echo("- 预热文章列表缓存...")
        from app.cache_service import warm_up_cache
        warm_up_cache()

        end_time = time.time()
        click.echo(f"✅ 缓存预热完成！耗时: {end_time - start_time:.2f} 秒")

    except Exception as e:
        click.echo(f"❌ 缓存预热失败: {e}")

@cache_cli.command()
@with_appcontext
def invalidate_posts():
    """清理文章相关缓存"""
    try:
        CacheInvalidation.invalidate_posts_cache()
        click.echo("✅ 文章缓存已清理")
    except Exception as e:
        click.echo(f"❌ 清理文章缓存失败: {e}")

@cache_cli.command()
@click.argument('post_id', type=int)
@with_appcontext
def invalidate_post(post_id):
    """清理指定文章的缓存"""
    try:
        CacheInvalidation.invalidate_post_cache(post_id)
        click.echo(f"✅ 文章 {post_id} 的缓存已清理")
    except Exception as e:
        click.echo(f"❌ 清理文章 {post_id} 缓存失败: {e}")

@cache_cli.command()
@with_appcontext
def stats():
    """显示缓存统计信息"""
    try:
        # 获取 Redis 信息（如果使用 Redis 作为缓存后端）
        if hasattr(cache.cache, '_cache'):
            redis_client = cache.cache._cache
            info = redis_client.info()

            click.echo("📊 缓存统计信息:")
            click.echo(f"- Redis 版本: {info.get('redis_version', 'Unknown')}")
            click.echo(f"- 已用内存: {info.get('used_memory_human', 'Unknown')}")
            click.echo(f"- 键总数: {info.get('db0', {}).get('keys', 0) if 'db0' in info else 0}")
            click.echo(f"- 命中次数: {info.get('keyspace_hits', 0)}")
            click.echo(f"- 未命中次数: {info.get('keyspace_misses', 0)}")

            # 计算命中率
            hits = info.get('keyspace_hits', 0)
            misses = info.get('keyspace_misses', 0)
            if hits + misses > 0:
                hit_rate = hits / (hits + misses) * 100
                click.echo(f"- 命中率: {hit_rate:.2f}%")

        else:
            click.echo("📊 当前使用简单缓存，无详细统计信息")

    except Exception as e:
        click.echo(f"❌ 获取缓存统计失败: {e}")

@cache_cli.command()
@with_appcontext
def test():
    """测试缓存功能"""
    click.echo("🧪 开始缓存功能测试...")

    try:
        # 测试基本缓存功能
        cache.set('test_key', 'test_value', timeout=60)
        value = cache.get('test_key')

        if value == 'test_value':
            click.echo("✅ 基本缓存功能正常")
        else:
            click.echo("❌ 基本缓存功能异常")

        # 清理测试键
        cache.delete('test_key')

        # 测试数据查询缓存
        from app.cache_service import get_cached_categories
        categories = get_cached_categories()
        click.echo(f"✅ 分类缓存测试完成，获取到 {len(categories)} 个分类")

        # 测试文章列表缓存
        from app.cache_service import get_cached_posts_list
        posts = get_cached_posts_list(page=1, per_page=5)
        click.echo(f"✅ 文章列表缓存测试完成，获取到 {len(posts.get('items', []))} 篇文章")

    except Exception as e:
        click.echo(f"❌ 缓存功能测试失败: {e}")

def init_cache_commands(app):
    """初始化缓存命令"""
    app.cli.add_command(cache_cli, name='cache')