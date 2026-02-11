/**
 * SpacePage - Space 动态页面
 * 整合时间线、侧边栏、状态管理
 */

import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { SpaceTimeline, SpaceExplore, SpaceNotifications, SpaceCommentDrawer, type PostData } from '../components/space';
import { useSpaceStore } from '../stores';
import { useChatStore } from '../features/chat/store/chatStore';
import { messageAPI } from '../services/apiClient';
import SharePostModal from '../components/space/SharePostModal';
import { authUtils } from '../services/apiClient';
import { motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { showToast } from '../components/ui/Toast';
import { HomeIcon, SearchIcon, NotificationIcon, MessageIcon, PlusIcon, SparkIcon, TrendIcon, UserPlusIcon } from '../components/icons/SpaceIcons';
import { spaceAPI, type RecommendedUser, type TrendItem } from '../services/spaceApi';
import { SHARE_BASE_URL } from '../config/share';
import './SpacePage.css';

const pageVariants = {
    initial: { opacity: 0, scale: 0.98 },
    animate: { opacity: 1, scale: 1, transition: { duration: 0.4 } },
    exit: { opacity: 0, scale: 0.98, transition: { duration: 0.2 } }
};

const SPACE_ASIDE_WIDTH_STORAGE_KEY = 'space_aside_width_v1';
const SPACE_ASIDE_WIDTH_DEFAULT = 340;
const SPACE_ASIDE_WIDTH_MIN = 280;
const SPACE_ASIDE_WIDTH_MAX = 560;

export const SpacePage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [activeSection, setActiveSection] = useState<'home' | 'explore' | 'notifications'>('home');
    const [commentPost, setCommentPost] = useState<PostData | null>(null);
    const [trends, setTrends] = useState<TrendItem[]>([]);
    const [recommendedUsers, setRecommendedUsers] = useState<RecommendedUser[]>([]);
    const [loadingAside, setLoadingAside] = useState(false);
    const [sharePostId, setSharePostId] = useState<string | null>(null);
    const [isShareOpen, setIsShareOpen] = useState(false);

    const [asideWidth, setAsideWidth] = useState<number>(() => {
        if (typeof window === 'undefined') return SPACE_ASIDE_WIDTH_DEFAULT;
        const raw = window.localStorage.getItem(SPACE_ASIDE_WIDTH_STORAGE_KEY);
        const parsed = raw ? Number(raw) : NaN;
        if (!Number.isFinite(parsed)) return SPACE_ASIDE_WIDTH_DEFAULT;
        return Math.min(SPACE_ASIDE_WIDTH_MAX, Math.max(SPACE_ASIDE_WIDTH_MIN, parsed));
    });

    const resizingRef = useRef(false);
    const asideWidthRef = useRef(asideWidth);

    useEffect(() => {
        asideWidthRef.current = asideWidth;
    }, [asideWidth]);

    // 获取状态
    const posts = useSpaceStore((state) => state.posts);
    const isLoading = useSpaceStore((state) => state.isLoadingFeed);
    const hasMore = useSpaceStore((state) => state.hasMore);
    const newPostsCount = useSpaceStore((state) => state.newPostsCount);
    const updatePost = useSpaceStore((state) => state.updatePost);
    const searchPosts = useSpaceStore((state) => state.searchPosts);
    const searchResults = useSpaceStore((state) => state.searchResults);

    // 获取操作
    const fetchFeed = useSpaceStore((state) => state.fetchFeed);
    const loadMore = useSpaceStore((state) => state.loadMore);
    const refreshFeed = useSpaceStore((state) => state.refreshFeed);
    const createPost = useSpaceStore((state) => state.createPost);
    const likePost = useSpaceStore((state) => state.likePost);
    const unlikePost = useSpaceStore((state) => state.unlikePost);
    const repostPost = useSpaceStore((state) => state.repostPost);
    const loadContacts = useChatStore((state) => state.loadContacts);
    const contacts = useChatStore((state) => state.contacts);

    // 获取当前用户
    const currentUser = authUtils.getCurrentUser();

    // 初始加载
    useEffect(() => {
        if (posts.length === 0) {
            fetchFeed(true);
        }
    }, [fetchFeed, posts.length]);

    useEffect(() => {
        let mounted = true;
        const loadAside = async () => {
            setLoadingAside(true);
            try {
                const [trendData, userData] = await Promise.all([
                    spaceAPI.getTrends(6),
                    spaceAPI.getRecommendedUsers(4),
                ]);
                if (mounted) {
                    setTrends(trendData);
                    setRecommendedUsers(userData);
                }
            } finally {
                if (mounted) setLoadingAside(false);
            }
        };
        loadAside();
        return () => {
            mounted = false;
        };
    }, []);

    // 处理创建帖子
    const handleCreatePost = useCallback(
        async (content: string, media?: File[]) => {
            setActiveSection('home');
            await createPost(content, media);
            showToast('动态发布成功！', 'success');
            setTimeout(() => {
                document.getElementById('space-posts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 120);
        },
        [createPost]
    );

    // 处理帖子点击
    const handlePostClick = useCallback((postId: string) => {
        navigate(`/space/post/${postId}`);
    }, [navigate]);

    const handleAuthorClick = useCallback((authorId: string) => {
        navigate(`/space/user/${authorId}`);
    }, [navigate]);

    // 处理评论
    const handleComment = useCallback((postId: string) => {
        const target = posts.find((p) => p.id === postId)
            || searchResults.find((p) => p.id === postId)
            || null;
        if (target) {
            setCommentPost(target);
        } else {
            showToast('未找到该动态', 'info');
        }
    }, [posts, searchResults]);

    // 处理分享
    const handleShare = useCallback(async (postId: string) => {
        setSharePostId(postId);
        setIsShareOpen(true);
        if (contacts.length === 0) {
            await loadContacts();
        }
    }, [contacts.length, loadContacts]);

    const handleShareSend = useCallback(async (receiverId: string) => {
        if (!sharePostId) return;
        const shareUrl = `${SHARE_BASE_URL}/space/post/${sharePostId}`;
        await messageAPI.sendMessage({
            chatType: 'private',
            receiverId,
            content: `分享动态：${shareUrl}`,
            type: 'share',
        });
        showToast('已分享给好友', 'success');
        setIsShareOpen(false);
        setSharePostId(null);
    }, [sharePostId]);

    // 导航处理
    const handleNavClick = (path: string, label: string) => {
        if (path === '/space') {
            // 如果已经在首页，则刷新
            refreshFeed();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setActiveSection('home');
        } else {
            if (path === 'explore') {
                setActiveSection('explore');
            } else if (path === 'notifications') {
                setActiveSection('notifications');
            } else if (path.startsWith('/')) {
                navigate(path);
            } else {
                showToast(`${label} 模块开发中`, 'info');
            }
        }
    };

    const handleTrendClick = (tag: string) => {
        const keyword = tag.startsWith('#') ? tag : `#${tag}`;
        setActiveSection('explore');
        searchPosts(keyword);
    };

    const handleFollowToggle = async (user: RecommendedUser) => {
        try {
            if (user.isFollowed) {
                await spaceAPI.unfollowUser(user.id);
                showToast(`已取消关注 ${user.username}`, 'info');
            } else {
                await spaceAPI.followUser(user.id);
                showToast(`已关注 ${user.username}`, 'success');
            }
            setRecommendedUsers((prev) =>
                prev.map((u) =>
                    u.id === user.id ? { ...u, isFollowed: !user.isFollowed } : u
                )
            );
        } catch (error) {
            showToast('操作失败，请稍后再试', 'error');
        }
    };

    const clampAsideWidth = useCallback((value: number) => {
        return Math.min(SPACE_ASIDE_WIDTH_MAX, Math.max(SPACE_ASIDE_WIDTH_MIN, value));
    }, []);

    const persistAsideWidth = useCallback((value: number) => {
        try {
            window.localStorage.setItem(SPACE_ASIDE_WIDTH_STORAGE_KEY, String(value));
        } catch {
            // ignore
        }
    }, []);

    const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();

        const startX = e.clientX;
        const startWidth = asideWidth;
        asideWidthRef.current = startWidth;
        resizingRef.current = true;

        const prevCursor = document.body.style.cursor;
        const prevSelect = document.body.style.userSelect;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMove = (ev: PointerEvent) => {
            if (!resizingRef.current) return;
            const deltaX = ev.clientX - startX;
            const next = clampAsideWidth(startWidth - deltaX);
            asideWidthRef.current = next;
            setAsideWidth(next);
        };

        const onUp = () => {
            resizingRef.current = false;
            document.body.style.cursor = prevCursor;
            document.body.style.userSelect = prevSelect;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            persistAsideWidth(asideWidthRef.current);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [asideWidth, clampAsideWidth, persistAsideWidth]);

    const resetAsideWidth = useCallback(() => {
        const next = SPACE_ASIDE_WIDTH_DEFAULT;
        setAsideWidth(next);
        persistAsideWidth(next);
    }, [persistAsideWidth]);

    const pageStyle = useMemo(() => {
        return {
            ['--space-aside-width' as any]: `${asideWidth}px`,
        } as React.CSSProperties;
    }, [asideWidth]);

    return (
        <motion.div
            className="space-page"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            style={pageStyle}
        >
            {/* 左侧导航栏 */}
            <aside className="space-page__sidebar">
                {/* 品牌区 */}
                <div
                    className="space-page__brand"
                    role="button"
                    tabIndex={0}
                    aria-label="返回首页"
                    onClick={() => navigate('/')}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate('/');
                        }
                    }}
                >
                    <div className="space-page__brand-icon">
                        <SparkIcon />
                    </div>
                    <span className="space-page__brand-text">Space</span>
                </div>

                <nav className="space-page__nav">
                    <button
                        type="button"
                        className={`space-page__nav-item ${activeSection === 'home' ? 'is-active' : ''}`}
                        onClick={() => handleNavClick('/space', '首页')}
                    >
                        <HomeIcon active={activeSection === 'home'} />
                        <span>首页</span>
                    </button>
                    <button
                        type="button"
                        className={`space-page__nav-item ${activeSection === 'explore' ? 'is-active' : ''}`}
                        onClick={() => handleNavClick('explore', '探索')}
                    >
                        <SearchIcon />
                        <span>探索</span>
                    </button>
                    <button
                        type="button"
                        className={`space-page__nav-item ${activeSection === 'notifications' ? 'is-active' : ''}`}
                        onClick={() => handleNavClick('notifications', '通知')}
                    >
                        <NotificationIcon />
                        <span>通知</span>
                    </button>
                    <button
                        type="button"
                        className={`space-page__nav-item ${location.pathname === '/chat' ? 'is-active' : ''}`}
                        onClick={() => handleNavClick('/chat', '消息')}
                    >
                        <MessageIcon />
                        <span>消息</span>
                    </button>
                </nav>

                <button
                    type="button"
                    className="space-page__compose-btn"
                    onClick={() => {
                        setActiveSection('home');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        setTimeout(() => {
                            const textarea = document.querySelector('.post-composer__textarea') as HTMLElement;
                            textarea?.focus();
                        }, 200);
                    }}
                >
                    <PlusIcon />
                    <span>发布动态</span>
                </button>

                {/* 用户信息 */}
                <div
                    className="space-page__user"
                    role="button"
                    tabIndex={0}
                    aria-label="查看我的个人主页"
                    onClick={() => currentUser?.id && navigate(`/space/user/${currentUser.id}`)}
                    onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && currentUser?.id) {
                            e.preventDefault();
                            navigate(`/space/user/${currentUser.id}`);
                        }
                    }}
                >
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
                    {activeSection === 'home' && (
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
                            onAuthorClick={handleAuthorClick}
                        />
                    )}
                    {activeSection === 'explore' && (
                        <SpaceExplore
                            onLike={likePost}
                            onUnlike={unlikePost}
                            onComment={handleComment}
                            onRepost={(id) => { repostPost(id); showToast('已转发', 'success'); }}
                            onShare={handleShare}
                            onPostClick={handlePostClick}
                            onAuthorClick={handleAuthorClick}
                        />
                    )}
                    {activeSection === 'notifications' && (
                        <SpaceNotifications onPostClick={handlePostClick} />
                    )}
                </div>
            </main>

            {/* 可拖拽分隔条：调整主内容区与右侧栏宽度 */}
            <div
                className="space-page__resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label="调整右侧栏宽度"
                onPointerDown={handleResizePointerDown}
                onDoubleClick={resetAsideWidth}
                title="拖动调整宽度（双击重置）"
            />

            {/* 右侧边栏 - 推荐/趋势 */}
            <aside className="space-page__aside">
                <div className="space-page__widget glass-card">
                    <h2 className="space-page__widget-title">
                        <TrendIcon />
                        热门趋势
                    </h2>
                    {trends.length === 0 && !loadingAside && (
                        <div className="space-page__empty-state">暂无趋势话题</div>
                    )}
                    {trends.map((trend, i) => (
                        <div
                            className="space-page__trend-item"
                            key={trend.tag}
                            role="button"
                            tabIndex={0}
                            aria-label={`查看趋势 ${trend.tag}`}
                            onClick={() => handleTrendClick(trend.tag)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleTrendClick(trend.tag);
                                }
                            }}
                        >
                            <div className="space-page__trend-info">
                                <span className="space-page__trend-category">话题 · 热门</span>
                                <span className="space-page__trend-name">#{trend.tag}</span>
                                <span className="space-page__trend-posts">{trend.count} 动态</span>
                            </div>
                            <div className="space-page__trend-meta">
                                <div className="space-page__heatbar">
                                    <div
                                        className="space-page__heatbar-fill"
                                        style={{ width: `${trend.heat}%`, animationDelay: `${i * 0.1}s` }}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="space-page__widget glass-card">
                    <h2 className="space-page__widget-title">
                        <UserPlusIcon />
                        推荐关注
                    </h2>
                    {recommendedUsers.length === 0 && !loadingAside && (
                        <div className="space-page__empty-state">暂无推荐用户</div>
                    )}
                    {recommendedUsers.map((user) => (
                        <div className="space-page__user-item" key={user.id}>
                            <div className={`space-page__user-avatar-wrapper ${user.isOnline ? 'is-online' : ''}`}>
                                {user.avatarUrl ? (
                                    <img className="space-page__user-avatar-img" src={user.avatarUrl} alt={user.username} />
                                ) : (
                                    <div className="space-page__user-avatar">{user.username.charAt(0).toUpperCase()}</div>
                                )}
                                {user.isOnline && <div className="space-page__user-status-ring" />}
                            </div>
                            <div className="space-page__user-info">
                                <div className="space-page__user-name">{user.username}</div>
                                <div className="space-page__user-handle">{user.reason || '@space'}</div>
                            </div>
                            <button
                                type="button"
                                className={`space-page__follow-btn ${user.isFollowed ? 'is-followed' : ''}`}
                                onClick={() => handleFollowToggle(user)}
                            >
                                {user.isFollowed ? '已关注' : '关注'}
                            </button>
                        </div>
                    ))}
                </div>
            </aside>

            <nav className="space-page__bottom-nav">
                <button
                    type="button"
                    className={`space-page__bottom-item ${activeSection === 'home' ? 'is-active' : ''}`}
                    onClick={() => handleNavClick('/space', '首页')}
                >
                    <HomeIcon active={activeSection === 'home'} />
                    <span>首页</span>
                </button>
                <button
                    type="button"
                    className={`space-page__bottom-item ${activeSection === 'explore' ? 'is-active' : ''}`}
                    onClick={() => handleNavClick('explore', '探索')}
                >
                    <SearchIcon />
                    <span>探索</span>
                </button>
                <button
                    type="button"
                    className={`space-page__bottom-item ${activeSection === 'notifications' ? 'is-active' : ''}`}
                    onClick={() => handleNavClick('notifications', '通知')}
                >
                    <NotificationIcon />
                    <span>通知</span>
                </button>
                <button
                    type="button"
                    className={`space-page__bottom-item ${location.pathname === '/chat' ? 'is-active' : ''}`}
                    onClick={() => handleNavClick('/chat', '消息')}
                >
                    <MessageIcon />
                    <span>消息</span>
                </button>
            </nav>

            <button
                type="button"
                className="space-page__fab"
                onClick={() => {
                    setActiveSection('home');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    setTimeout(() => {
                        const textarea = document.querySelector('.post-composer__textarea') as HTMLElement;
                        textarea?.focus();
                    }, 200);
                }}
                aria-label="发布动态"
            >
                <PlusIcon />
            </button>

            <SpaceCommentDrawer
                open={!!commentPost}
                post={commentPost}
                onClose={() => setCommentPost(null)}
                onCommentAdded={(id) => {
                    const currentCount = posts.find((p) => p.id === id)?.commentCount
                        ?? searchResults.find((p) => p.id === id)?.commentCount
                        ?? 0;
                    updatePost(id, { commentCount: currentCount + 1 });
                }}
            />

            <SharePostModal
                open={isShareOpen}
                postId={sharePostId}
                onClose={() => {
                    setIsShareOpen(false);
                    setSharePostId(null);
                }}
                onSend={handleShareSend}
            />
        </motion.div>
    );
};

export default SpacePage;
