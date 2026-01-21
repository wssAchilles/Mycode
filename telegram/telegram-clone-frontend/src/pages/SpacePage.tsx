/**
 * SpacePage - Space 动态页面
 * 整合时间线、侧边栏、状态管理
 */

import React, { useEffect, useCallback } from 'react';
import { SpaceTimeline } from '../components/space';
import { useSpaceStore } from '../stores';
import { authUtils } from '../services/apiClient';
import './SpacePage.css';

// SVG 图标
const HomeIcon: React.FC<{ active?: boolean }> = ({ active }) => (
    <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
);

const SearchIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);

const NotificationIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
);

const MessageIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
);

const PlusIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

export const SpacePage: React.FC = () => {
    // 获取状态
    const posts = useSpaceStore((state) => state.posts);
    const isLoading = useSpaceStore((state) => state.isLoadingFeed);
    const hasMore = useSpaceStore((state) => state.hasMore);
    const newPostsCount = useSpaceStore((state) => state.newPostsCount);

    // 获取操作
    const fetchFeed = useSpaceStore((state) => state.fetchFeed);
    const loadMore = useSpaceStore((state) => state.loadMore);
    const refreshFeed = useSpaceStore((state) => state.refreshFeed);
    const createPost = useSpaceStore((state) => state.createPost);
    const likePost = useSpaceStore((state) => state.likePost);
    const unlikePost = useSpaceStore((state) => state.unlikePost);
    const repostPost = useSpaceStore((state) => state.repostPost);

    // 获取当前用户
    const currentUser = authUtils.getCurrentUser();

    // 初始加载
    useEffect(() => {
        if (posts.length === 0) {
            fetchFeed(true);
        }
    }, [fetchFeed, posts.length]);

    // 处理创建帖子
    const handleCreatePost = useCallback(
        async (content: string, media?: File[]) => {
            await createPost(content, media);
        },
        [createPost]
    );

    // 处理帖子点击
    const handlePostClick = useCallback((postId: string) => {
        // TODO: 导航到帖子详情页
        console.log('Post clicked:', postId);
    }, []);

    // 处理评论
    const handleComment = useCallback((postId: string) => {
        // TODO: 打开评论模态框或导航
        console.log('Comment on:', postId);
    }, []);

    // 处理分享
    const handleShare = useCallback((postId: string) => {
        // TODO: 打开分享菜单
        console.log('Share:', postId);
    }, []);

    return (
        <div className="space-page">
            {/* 左侧导航栏 */}
            <aside className="space-page__sidebar">
                {/* 品牌区 */}
                <div className="space-page__brand">
                    <div className="space-page__brand-icon">✨</div>
                    <span className="space-page__brand-text">Space</span>
                </div>

                <nav className="space-page__nav">
                    <button className="space-page__nav-item is-active" aria-label="首页">
                        <HomeIcon active />
                        <span>首页</span>
                    </button>
                    <button className="space-page__nav-item" aria-label="搜索">
                        <SearchIcon />
                        <span>探索</span>
                    </button>
                    <button className="space-page__nav-item" aria-label="通知">
                        <NotificationIcon />
                        <span>通知</span>
                    </button>
                    <button className="space-page__nav-item" aria-label="消息">
                        <MessageIcon />
                        <span>消息</span>
                    </button>
                </nav>

                <button className="space-page__compose-btn" aria-label="发布">
                    <PlusIcon />
                    <span>发布动态</span>
                </button>

                {/* 用户信息 */}
                <div className="space-page__user">
                    <div className="space-page__user-avatar">
                        {currentUser?.username?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div className="space-page__user-info">
                        <div className="space-page__user-name">{currentUser?.username || 'User'}</div>
                        <div className="space-page__user-handle">@{currentUser?.username || 'user'}</div>
                    </div>
                </div>
            </aside>

            {/* 主内容区 */}
            <main className="space-page__main">
                <div className="space-page__content">
                    <SpaceTimeline
                        posts={posts}
                        isLoading={isLoading}
                        hasMore={hasMore}
                        newPostsCount={newPostsCount}
                        currentUser={currentUser || { username: 'User' }}
                        onLoadMore={loadMore}
                        onRefresh={refreshFeed}
                        onCreatePost={handleCreatePost}
                        onLike={likePost}
                        onUnlike={unlikePost}
                        onComment={handleComment}
                        onRepost={repostPost}
                        onShare={handleShare}
                        onPostClick={handlePostClick}
                    />
                </div>
            </main>

            {/* 右侧边栏 - 推荐/趋势 */}
            <aside className="space-page__aside">
                <div className="space-page__widget">
                    <h2 className="space-page__widget-title">🔥 热门趋势</h2>
                    <div className="space-page__trend-item">
                        <span className="space-page__trend-category">技术 · 热门</span>
                        <span className="space-page__trend-name">#React19</span>
                        <span className="space-page__trend-posts">2.5万 动态</span>
                    </div>
                    <div className="space-page__trend-item">
                        <span className="space-page__trend-category">科技 · 热门</span>
                        <span className="space-page__trend-name">#AI大模型</span>
                        <span className="space-page__trend-posts">1.8万 动态</span>
                    </div>
                    <div className="space-page__trend-item">
                        <span className="space-page__trend-category">生活 · 热门</span>
                        <span className="space-page__trend-name">#周末分享</span>
                        <span className="space-page__trend-posts">9.2千 动态</span>
                    </div>
                </div>

                <div className="space-page__widget">
                    <h2 className="space-page__widget-title">💡 推荐关注</h2>
                    <div className="space-page__user-item">
                        <div className="space-page__user-avatar">A</div>
                        <div className="space-page__user-info">
                            <div className="space-page__user-name">Alice</div>
                            <div className="space-page__user-handle">@alice_dev</div>
                        </div>
                        <button className="space-page__follow-btn">关注</button>
                    </div>
                    <div className="space-page__user-item">
                        <div className="space-page__user-avatar">B</div>
                        <div className="space-page__user-info">
                            <div className="space-page__user-name">Bob</div>
                            <div className="space-page__user-handle">@bob_design</div>
                        </div>
                        <button className="space-page__follow-btn">关注</button>
                    </div>
                </div>
            </aside>
        </div>
    );
};

export default SpacePage;
