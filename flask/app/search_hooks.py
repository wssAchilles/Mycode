# flask/app/search_hooks.py

"""
搜索索引钩子
在文章创建、更新、删除时自动维护搜索索引
"""

from flask import current_app
from sqlalchemy import event
from app.models import Post, Category, Tag # 导入 Category 和 Tag 以便未来扩展钩子
from app.search_service import get_search_service

def init_search_hooks(app):
    """初始化搜索索引钩子"""
    
    # 确保事件监听器在 Flask 应用上下文中注册
    with app.app_context():
        # 获取搜索服务实例。注意：如果Whoosh初始化失败，这里可能返回None。
        # 钩子内部的操作会再次检查其可用性。
        search_service = get_search_service()
        if not search_service or not search_service.whoosh_available:
            current_app.logger.warning("Whoosh搜索服务未启用或初始化失败，搜索钩子将不工作。")
            # 如果Whoosh不可用，直接返回，不注册钩子
            return

        @event.listens_for(Post, 'after_insert')
        def after_post_insert(mapper, connection, target):
            """文章创建后添加到搜索索引"""
            # 在事件监听器中，再次获取服务实例以确保在当前请求上下文中的有效性
            local_search_service = get_search_service() 
            if local_search_service and local_search_service.whoosh_available:
                if target.published: # 只添加已发布的文章
                    try:
                        local_search_service.add_post_to_index(target)
                        current_app.logger.info(f"Hook: 文章 {target.id} 已添加到搜索索引")
                    except Exception as e:
                        current_app.logger.error(f"Hook: 添加文章 {target.id} 到搜索索引失败: {e}")
            else:
                current_app.logger.warning(f"Hook: Whoosh服务不可用，无法添加文章 {target.id} 到索引。")
        
        @event.listens_for(Post, 'after_update')
        def after_post_update(mapper, connection, target):
            """文章更新后更新搜索索引"""
            local_search_service = get_search_service()
            if local_search_service and local_search_service.whoosh_available:
                try:
                    if target.published:
                        local_search_service.update_post_in_index(target)
                        current_app.logger.info(f"Hook: 文章 {target.id} 搜索索引已更新")
                    else:
                        # 如果文章变为未发布，从索引中删除
                        local_search_service.remove_post_from_index(target.id)
                        current_app.logger.info(f"Hook: 文章 {target.id} 已从搜索索引中删除 (变为未发布)")
                except Exception as e:
                    current_app.logger.error(f"Hook: 更新文章 {target.id} 搜索索引失败: {e}")
            else:
                current_app.logger.warning(f"Hook: Whoosh服务不可用，无法更新文章 {target.id} 索引。")
        
        @event.listens_for(Post, 'after_delete')
        def after_post_delete(mapper, connection, target):
            """文章删除后从搜索索引中删除"""
            local_search_service = get_search_service()
            if local_search_service and local_search_service.whoosh_available:
                try:
                    local_search_service.remove_post_from_index(target.id)
                    current_app.logger.info(f"Hook: 文章 {target.id} 已从搜索索引中删除")
                except Exception as e:
                    current_app.logger.error(f"Hook: 从搜索索引删除文章 {target.id} 失败: {e}")
            else:
                current_app.logger.warning(f"Hook: Whoosh服务不可用，无法从索引删除文章 {target.id}。")
        
        # 您还可以为 Category 和 Tag 的更改添加钩子，如果它们的名称更改会影响文章的搜索结果
        # 例如：
        # @event.listens_for(Category, 'after_update')
        # def after_category_update(mapper, connection, target):
        #     local_search_service = get_search_service()
        #     if local_search_service and local_search_service.whoosh_available:
        #         current_app.logger.info(f"Hook: 分类 '{target.name}' 更新，考虑更新相关文章索引...")
        #         for post in target.posts.filter_by(published=True).all():
        #             local_search_service.update_post_in_index(post)

        # @event.listens_for(Tag, 'after_update')
        # def after_tag_update(mapper, connection, target):
        #     local_search_service = get_search_service()
        #     if local_search_service and local_search_service.whoosh_available:
        #         current_app.logger.info(f"Hook: 标签 '{target.name}' 更新，考虑更新相关文章索引...")
        #         for post in target.posts.filter_by(published=True).all():
        #             local_search_service.update_post_in_index(post)

        current_app.logger.info("搜索索引钩子已初始化")