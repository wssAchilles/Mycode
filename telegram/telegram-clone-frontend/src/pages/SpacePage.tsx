/**
 * SpacePage - Space 动态页面
 * 整合时间线、侧边栏、状态管理
 */

import React, { useEffect, useCallback } from 'react';
import { SpaceTimeline } from '../components/space';
import { useSpaceStore } from '../stores';
import { authUtils } from '../services/apiClient';
import { motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { showToast } from '../components/ui/Toast';
import { HomeIcon, SearchIcon, NotificationIcon, MessageIcon, PlusIcon } from '../components/icons/SpaceIcons';
import './SpacePage.css';

const pageVariants = {
    initial: { opacity: 0, scale: 0.98 },
    animate: { opacity: 1, scale: 1, transition: { duration: 0.4 } },
    exit: { opacity: 0, scale: 0.98, transition: { duration: 0.2 } }
};

export const SpacePage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();

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
            showToast('动态发布成功！', 'success');
        },
        [createPost]
    );

    // 处理帖子点击
    const handlePostClick = useCallback((postId: string) => {
        // 暂时显示 Toast，后续路由完善后启用
        showToast('进入详情页 (开发中)', 'info');
        // navigate(`/space/post/${postId}`);
        void postId; // Suppress unused warning
    }, []);

    // 处理评论
    const handleComment = useCallback((postId: string) => {
        showToast('评论功能即将上线', 'info');
        void postId; // Suppress unused warning
    }, []);

    // 处理分享
    const handleShare = useCallback((postId: string) => {
        // 模拟复制链接
        navigator.clipboard.writeText(`https://telegram-clone.app/space/post/${postId}`);
        showToast('链接已复制到剪贴板', 'success');
    }, []);

    // 导航处理
    const handleNavClick = (path: string, label: string) => {
        if (path === '/space') {
            // 如果已经在首页，则刷新
            refreshFeed();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            // 目前只有 space 是真实页面，其他显示 Toast
            if (path.startsWith('/')) {
                navigate(path);
            } else {
                showToast(`${label} 模块开发中`, 'info');
            }
        }
    };

    return (
        <motion.div
            className="space-page"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
        >
            {/* 左侧导航栏 */}
            <aside className="space-page__sidebar">
                {/* 品牌区 */}
                <div className="space-page__brand" onClick={() => navigate('/')}>
                    <div className="space-page__brand-icon">✨</div>
                    <span className="space-page__brand-text">Space</span>
                </div>

                <nav className="space-page__nav">
                    <button
                        className={`space-page__nav-item ${location.pathname === '/space' ? 'is-active' : ''}`}
                        onClick={() => handleNavClick('/space', '首页')}
                    >
                        <HomeIcon active={location.pathname === '/space'} />
                        <span>首页</span>
                    </button>
                    <button
                        className="space-page__nav-item"
                        onClick={() => handleNavClick('explore', '探索')}
                    >
                        <SearchIcon />
                        <span>探索</span>
                    </button>
                    <button
                        className="space-page__nav-item"
                        onClick={() => handleNavClick('notifications', '通知')}
                    >
                        <NotificationIcon />
                        <span>通知</span>
                    </button>
                    <button
                        className={`space-page__nav-item ${location.pathname === '/chat' ? 'is-active' : ''}`}
                        onClick={() => handleNavClick('/chat', '消息')}
                    >
                        <MessageIcon />
                        <span>消息</span>
                    </button>
                </nav>

                <button
                    className="space-page__compose-btn"
                    onClick={() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        const textarea = document.querySelector('.post-composer__textarea') as HTMLElement;
                        textarea?.focus();
                    }}
                >
                    <PlusIcon />
                    <span>发布动态</span>
                </button>

                {/* 用户信息 */}
                <div className="space-page__user" onClick={() => showToast('个人主页开发中', 'info')}>
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
                        onRepost={(id) => { repostPost(id); showToast('已转发', 'success'); }}
                        onShare={handleShare}
                        onPostClick={handlePostClick}
                    />
                </div>
            </main>

            {/* 右侧边栏 - 推荐/趋势 */}
            <aside className="space-page__aside">
                <div className="space-page__widget glass-card">
                    <h2 className="space-page__widget-title">🔥 热门趋势</h2>
                    {[
                        { cat: '技术 · 热门', tag: '#React19', count: '2.5万', heat: '90%' },
                        { cat: '科技 · 热门', tag: '#AI大模型', count: '1.8万', heat: '75%' },
                        { cat: '生活 · 热门', tag: '#周末分享', count: '9.2千', heat: '60%' },
                        { cat: '设计 · 新星', tag: '#Glassmorphism', count: '8.5千', heat: '45%' },
                    ].map((trend, i) => (
                        <div className="space-page__trend-item" key={i} onClick={() => showToast(`查看话题 ${trend.tag}`, 'info')}>
                            <div className="space-page__trend-info">
                                <span className="space-page__trend-category">{trend.cat}</span>
                                <span className="space-page__trend-name">{trend.tag}</span>
                                <span className="space-page__trend-posts">{trend.count} 动态</span>
                            </div>
                            <div className="space-page__trend-meta">
                                {/* Visual Heatbar */}
                                <div className="space-page__heatbar">
                                    <div
                                        className="space-page__heatbar-fill"
                                        style={{ width: trend.heat, animationDelay: `${i * 0.1}s` }}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="space-page__widget glass-card">
                    <h2 className="space-page__widget-title">💡 推荐关注</h2>
                    {[
                        { name: 'Alice', handle: '@alice_dev', avatar: 'A', online: true },
                        { name: 'Bob', handle: '@bob_design', avatar: 'B', online: false },
                        { name: 'Charlie', handle: '@code_master', avatar: 'C', online: true },
                    ].map((user, i) => (
                        <div className="space-page__user-item" key={i}>
                            <div className={`space-page__user-avatar-wrapper ${user.online ? 'is-online' : ''}`}>
                                <div className="space-page__user-avatar">{user.avatar}</div>
                                {user.online && <div className="space-page__user-status-ring" />}
                            </div>
                            <div className="space-page__user-info">
                                <div className="space-page__user-name">{user.name}</div>
                                <div className="space-page__user-handle">{user.handle}</div>
                            </div>
                            <button className="space-page__follow-btn" onClick={() => showToast(`已关注 ${user.name}`, 'success')}>关注</button>
                        </div>
                    ))}
                </div>
            </aside>
        </motion.div>
    );
};

export default SpacePage;
