/**
 * SpacePage - Space 动态页面
 * 整合时间线、侧边栏、状态管理
 */

import React, { useEffect, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import {
    SpaceAsideWidgets,
    SpaceTimeline,
    SpaceExplore,
    SpaceNotifications,
    SpaceCommentDrawer,
    ComposePostModal,
    type PostData,
} from '../components/space';
import { useSpaceStore } from '../stores';
import { useChatStore } from '../features/chat/store/chatStore';
import { messageAPI } from '../services/apiClient';
import SharePostModal from '../components/space/SharePostModal';
import { authUtils } from '../services/apiClient';
import { motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { showToast } from '../components/ui/Toast';
import { HomeIcon, SearchIcon, NotificationIcon, MessageIcon, PlusIcon, SparkIcon } from '../components/icons/SpaceIcons';
import { openCommandPalette } from '../components/command/CommandPalette';
import { spaceAPI, type RecommendedUser, type RecommendationDailyRefreshOps, type TrendItem } from '../services/spaceApi';
import { SHARE_BASE_URL } from '../config/share';
import { useAnalytics } from '../hooks/useAnalytics';
import './SpacePage.css';

const pageVariants = {
    initial: { opacity: 0, scale: 0.98 },
    animate: { opacity: 1, scale: 1, transition: { duration: 0.4 } },
    exit: { opacity: 0, scale: 0.98, transition: { duration: 0.2 } }
};

const SPACE_ASIDE_WIDTH_STORAGE_KEY = 'space_aside_width_v2';
const SPACE_ASIDE_WIDTH_FALLBACK = 360;
const SPACE_ASIDE_WIDTH_MIN = 300;
const SPACE_ASIDE_WIDTH_MAX = 520;

export const SpacePage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const analytics = useAnalytics({ source: 'space_page' });
    const [activeSection, setActiveSection] = useState<'home' | 'explore' | 'notifications'>('home');
    const [commentPost, setCommentPost] = useState<PostData | null>(null);
    const [trends, setTrends] = useState<TrendItem[]>([]);
    const [recommendedUsers, setRecommendedUsers] = useState<RecommendedUser[]>([]);
    const [loadingAside, setLoadingAside] = useState(false);
    const [asideError, setAsideError] = useState<string | null>(null);
    const [recommendationRefreshStatus, setRecommendationRefreshStatus] = useState<RecommendationDailyRefreshOps | null>(null);
    const [loadingRecommendationRefresh, setLoadingRecommendationRefresh] = useState(false);
    const [recommendationRefreshError, setRecommendationRefreshError] = useState<string | null>(null);
    const [sharePostId, setSharePostId] = useState<string | null>(null);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const [composeModalOpen, setComposeModalOpen] = useState(false);
    const [refreshingRecommendedUsers, setRefreshingRecommendedUsers] = useState(false);
    const [showBackToTop, setShowBackToTop] = useState(false);
    const seenRecommendedIdsRef = useRef<Set<string>>(new Set());
    const scrollPositionsRef = useRef<Record<'home' | 'explore' | 'notifications', number>>({
        home: 0,
        explore: 0,
        notifications: 0,
    });
    const prevSectionRef = useRef<'home' | 'explore' | 'notifications'>('home');
    const contentScrollRef = useRef<HTMLDivElement>(null);
    const asideMountedRef = useRef(true);

    // 默认置空以交由 CSS clamp() 按视口宽度自适应缩放；仅在用户主动拖拽后持久化自定义宽度
    const [asideWidth, setAsideWidth] = useState<number | null>(() => {
        if (typeof window === 'undefined') return null;
        const raw = window.localStorage.getItem(SPACE_ASIDE_WIDTH_STORAGE_KEY);
        if (!raw) return null;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return null;
        return Math.min(SPACE_ASIDE_WIDTH_MAX, Math.max(SPACE_ASIDE_WIDTH_MIN, parsed));
    });

    const resizingRef = useRef(false);
    const asideWidthRef = useRef<number | null>(asideWidth);

    useEffect(() => {
        asideMountedRef.current = true;
        return () => {
            asideMountedRef.current = false;
        };
    }, []);

    // 同步 URL 查询参数（如通过全局 ⌘K 命令面板跳转到 ?section=explore）
    useEffect(() => {
        const sectionParam = new URLSearchParams(location.search).get('section');
        if (sectionParam === 'explore' || sectionParam === 'notifications' || sectionParam === 'home') {
            setActiveSection(sectionParam);
        }
    }, [location.search]);

    useEffect(() => {
        asideWidthRef.current = asideWidth;
    }, [asideWidth]);

    const scrollContentToTop = useCallback((behavior: ScrollBehavior = 'smooth') => {
        const scrollEl = contentScrollRef.current;
        if (scrollEl) {
            scrollEl.scrollTo({ top: 0, behavior });
        }
    }, []);

    // 获取状态
    const posts = useSpaceStore((state) => state.posts);
    const isLoading = useSpaceStore((state) => state.isLoadingFeed);
    const hasMore = useSpaceStore((state) => state.hasMore);
    const newPostsCount = useSpaceStore((state) => state.newPostsCount);
    const inNetworkOnly = useSpaceStore((state) => state.inNetworkOnly);
    const updatePost = useSpaceStore((state) => state.updatePost);
    const searchTopicPosts = useSpaceStore((state) => state.searchTopicPosts);
    const searchResults = useSpaceStore((state) => state.searchResults);
    const spaceError = useSpaceStore((state) => state.error);
    const unreadNotificationsCount = useSpaceStore((state) => state.unreadNotificationsCount);

    // 获取操作
    const fetchFeed = useSpaceStore((state) => state.fetchFeed);
    const loadMore = useSpaceStore((state) => state.loadMore);
    const refreshFeed = useSpaceStore((state) => state.refreshFeed);
    const setInNetworkOnly = useSpaceStore((state) => state.setInNetworkOnly);
    const createPost = useSpaceStore((state) => state.createPost);
    const likePost = useSpaceStore((state) => state.likePost);
    const unlikePost = useSpaceStore((state) => state.unlikePost);
    const repostPost = useSpaceStore((state) => state.repostPost);
    const unrepostPost = useSpaceStore((state) => state.unrepostPost);
    const clearUnreadNotifications = useSpaceStore((state) => state.clearUnreadNotifications);
    const loadContacts = useChatStore((state) => state.loadContacts);
    const contacts = useChatStore((state) => state.contacts);
    const chats = useChatStore((state) => state.chats);
    const pendingRequestsCount = useChatStore((state) => state.pendingRequests.length);
    const chatUnreadBadgeCount = useMemo(
        () => chats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0) + pendingRequestsCount,
        [chats, pendingRequestsCount],
    );

    // 停留在通知面板时自动清空未读通知徽章（须在 store selector 声明之后执行以避免 TDZ）
    useEffect(() => {
        if (activeSection === 'notifications' && unreadNotificationsCount > 0) {
            clearUnreadNotifications();
        }
    }, [activeSection, unreadNotificationsCount, clearUnreadNotifications]);

    // 获取当前用户
    const currentUser = authUtils.getCurrentUser();

    // 初始加载
    useEffect(() => {
        if (posts.length === 0) {
            fetchFeed(true);
        }
    }, [fetchFeed, posts.length]);

    const loadAside = useCallback(async () => {
        setLoadingAside(true);
        setAsideError(null);
        try {
            const [trendData, userData] = await Promise.all([
                spaceAPI.getTrends(6),
                spaceAPI.getRecommendedUsers(4),
            ]);
            if (!asideMountedRef.current) return;
            setTrends(trendData);
            setRecommendedUsers(userData);
            userData.forEach((u) => seenRecommendedIdsRef.current.add(String(u.id)));
        } catch {
            if (!asideMountedRef.current) return;
            setAsideError('右侧栏内容加载失败，请稍后重试');
        } finally {
            if (asideMountedRef.current) setLoadingAside(false);
        }
    }, []);

    const loadRecommendationRefreshStatus = useCallback(async () => {
        setLoadingRecommendationRefresh(true);
        setRecommendationRefreshError(null);
        try {
            const status = await spaceAPI.getRecommendationDailyRefresh();
            if (!asideMountedRef.current) return;
            setRecommendationRefreshStatus(status);
        } catch {
            if (!asideMountedRef.current) return;
            setRecommendationRefreshError('无法获取每日推荐闭环统计。');
        } finally {
            if (asideMountedRef.current) setLoadingRecommendationRefresh(false);
        }
    }, []);

    useEffect(() => {
        loadAside();
        loadRecommendationRefreshStatus();
    }, [loadAside, loadRecommendationRefreshStatus]);

    useEffect(() => {
        if (!asideError) return;
        showToast(asideError, 'error');
    }, [asideError]);

    // 换一批推荐用户（过滤本轮已浏览过的推荐人选；耗尽时自动重置池子重拉）
    const handleRefreshRecommendedUsers = useCallback(async () => {
        if (refreshingRecommendedUsers) return;
        setRefreshingRecommendedUsers(true);
        try {
            const excludeIds = Array.from(seenRecommendedIdsRef.current);
            let nextUsers = await spaceAPI.getRecommendedUsers(4, excludeIds);
            if (nextUsers.length === 0 && excludeIds.length > 0) {
                seenRecommendedIdsRef.current.clear();
                recommendedUsers.forEach((u) => seenRecommendedIdsRef.current.add(String(u.id)));
                nextUsers = await spaceAPI.getRecommendedUsers(4, Array.from(seenRecommendedIdsRef.current));
            }
            if (!asideMountedRef.current) return;
            if (nextUsers.length > 0) {
                setRecommendedUsers(nextUsers);
                nextUsers.forEach((u) => seenRecommendedIdsRef.current.add(String(u.id)));
            } else {
                showToast('暂无更多推荐创作者', 'info');
            }
        } catch {
            showToast('换一批推荐失败，请稍后重试', 'error');
        } finally {
            if (asideMountedRef.current) {
                setRefreshingRecommendedUsers(false);
            }
        }
    }, [refreshingRecommendedUsers, recommendedUsers]);

    // 记忆各视图滚动位置，并在超过 600px 时显示回到顶部悬浮钮
    useLayoutEffect(() => {
        const el = contentScrollRef.current;
        const prev = prevSectionRef.current;
        if (el && prev !== activeSection) {
            scrollPositionsRef.current[prev] = el.scrollTop;
            const targetTop = scrollPositionsRef.current[activeSection] ?? 0;
            el.scrollTo({ top: targetTop, behavior: 'auto' });
            setShowBackToTop(targetTop > 600);
            prevSectionRef.current = activeSection;
        }
    }, [activeSection]);

    useEffect(() => {
        const el = contentScrollRef.current;
        if (!el) return;
        const onScroll = () => {
            scrollPositionsRef.current[activeSection] = el.scrollTop;
            setShowBackToTop(el.scrollTop > 600);
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, [activeSection]);

    // 处理创建帖子
    const handleCreatePost = useCallback(
        async (content: string, media?: File[]) => {
            setActiveSection('home');
            await createPost(content, media);
            showToast('动态发布成功！', 'success');
            setTimeout(() => {
                scrollContentToTop('smooth');
            }, 120);
        },
        [createPost, scrollContentToTop]
    );

    const handleQuotePost = useCallback(
        async (postId: string, quoteContent: string) => {
            setActiveSection('home');
            await createPost(quoteContent, undefined, {
                quotePostId: postId,
                quoteContent,
            });
            showToast('引用发布成功', 'success');
            setTimeout(() => {
                scrollContentToTop('smooth');
            }, 120);
        },
        [createPost, scrollContentToTop]
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
            scrollContentToTop('smooth');
            setActiveSection('home');
            if (location.search) {
                navigate('/space', { replace: true });
            }
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
        analytics.trackHashtagClick(tag, { productSurface: 'explore' });
        setActiveSection('explore');
        searchTopicPosts(tag);
    };

    const handleFollowToggle = async (user: RecommendedUser) => {
        try {
            if (user.isFollowed) {
                await spaceAPI.unfollowUser(user.id);
                analytics.trackUnfollow(user.id, { productSurface: 'space_feed' });
                showToast(`已取消关注 ${user.username}`, 'info');
            } else {
                await spaceAPI.followUser(user.id);
                analytics.trackFollow(user.id, { productSurface: 'space_feed' });
                showToast(`已关注 ${user.username}`, 'success');
            }
            setRecommendedUsers((prev) =>
                prev.map((u) =>
                    u.id === user.id ? { ...u, isFollowed: !user.isFollowed } : u
                )
            );
        } catch {
            showToast('操作失败，请稍后再试', 'error');
        }
    };

    const clampAsideWidth = useCallback((value: number) => {
        return Math.min(SPACE_ASIDE_WIDTH_MAX, Math.max(SPACE_ASIDE_WIDTH_MIN, value));
    }, []);

    const persistAsideWidth = useCallback((value: number | null) => {
        try {
            if (value === null) {
                window.localStorage.removeItem(SPACE_ASIDE_WIDTH_STORAGE_KEY);
            } else {
                window.localStorage.setItem(SPACE_ASIDE_WIDTH_STORAGE_KEY, String(value));
            }
        } catch {
            // 忽略隐私模式下 localStorage 写入异常
        }
    }, []);

    const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();

        const startX = e.clientX;
        const asideEl = document.querySelector('.space-page__aside');
        const measuredWidth = asideEl ? Math.round(asideEl.getBoundingClientRect().width) : SPACE_ASIDE_WIDTH_FALLBACK;
        const startWidth = asideWidth ?? clampAsideWidth(measuredWidth);
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
        asideWidthRef.current = null;
        setAsideWidth(null);
        persistAsideWidth(null);
    }, [persistAsideWidth]);

    const pageStyle = useMemo(() => {
        if (asideWidth === null) return undefined;
        return {
            '--space-aside-width': `${asideWidth}px`,
        } as React.CSSProperties & Record<'--space-aside-width', string>;
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

                {/* Apple Spotlight 快捷命令触发胶囊 */}
                <button
                    type="button"
                    className="space-page__spotlight-trigger"
                    onClick={openCommandPalette}
                    aria-label="打开全局指令面板（⌘K）"
                >
                    <SearchIcon />
                    <span className="space-page__spotlight-label">快速跳转</span>
                    <kbd className="space-page__spotlight-kbd">⌘K</kbd>
                </button>

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
                        <SearchIcon active={activeSection === 'explore'} />
                        <span>探索</span>
                    </button>
                    <button
                        type="button"
                        className={`space-page__nav-item ${activeSection === 'notifications' ? 'is-active' : ''}`}
                        onClick={() => handleNavClick('notifications', '通知')}
                    >
                        <NotificationIcon active={activeSection === 'notifications'} />
                        <span>通知</span>
                        {unreadNotificationsCount > 0 && (
                            <span className="space-page__nav-badge" aria-label={`未读通知 ${unreadNotificationsCount}`}>
                                {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
                            </span>
                        )}
                    </button>
                    <button
                        type="button"
                        className={`space-page__nav-item ${location.pathname === '/chat' ? 'is-active' : ''}`}
                        onClick={() => handleNavClick('/chat', '消息')}
                    >
                        <MessageIcon active={location.pathname === '/chat'} />
                        <span>消息</span>
                        {chatUnreadBadgeCount > 0 && (
                            <span className="space-page__nav-badge" aria-label={`未读消息 ${chatUnreadBadgeCount}`}>
                                {chatUnreadBadgeCount > 99 ? '99+' : chatUnreadBadgeCount}
                            </span>
                        )}
                    </button>
                </nav>

                <button
                    type="button"
                    className="space-page__compose-btn"
                    onClick={() => setComposeModalOpen(true)}
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
                        {currentUser?.avatarUrl ? (
                            <img
                                className="space-page__user-avatar-img"
                                src={currentUser.avatarUrl}
                                alt={currentUser.username || 'Me'}
                            />
                        ) : (
                            currentUser?.username?.charAt(0).toUpperCase() || 'U'
                        )}
                    </div>
                    <div className="space-page__user-info">
                        <div className="space-page__user-name">{currentUser?.username || 'User'}</div>
                        <div className="space-page__user-handle">@{currentUser?.username || 'user'}</div>
                    </div>
                    <span className="space-page__user-more" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <circle cx="5" cy="12" r="1.6" />
                            <circle cx="12" cy="12" r="1.6" />
                            <circle cx="19" cy="12" r="1.6" />
                        </svg>
                    </span>
                </div>
            </aside>

            {/* 主内容区 */}
            <main className="space-page__main">
                <div ref={contentScrollRef} className="space-page__content">
                    {activeSection === 'home' && (
                        <SpaceTimeline
                            posts={posts}
                            isLoading={isLoading}
                            error={spaceError}
                            hasMore={hasMore}
                            newPostsCount={newPostsCount}
                            currentUser={currentUser || { username: 'User' }}
                            inNetworkOnly={inNetworkOnly}
                            onInNetworkOnlyChange={setInNetworkOnly}
                            onLoadMore={loadMore}
                            onRefresh={refreshFeed}
                            onRetry={refreshFeed}
                            onCreatePost={handleCreatePost}
                            onLike={likePost}
                            onUnlike={unlikePost}
                            onComment={handleComment}
                            onRepost={(id) => { repostPost(id); showToast('已转发', 'success'); }}
                            onUnrepost={(id) => { unrepostPost(id); showToast('已取消转发', 'info'); }}
                            onQuote={handleQuotePost}
                            onShare={handleShare}
                            onPostClick={handlePostClick}
                            onAuthorClick={handleAuthorClick}
                            onHashtagClick={handleTrendClick}
                            scrollElementRef={contentScrollRef}
                        />
                    )}
                    {activeSection === 'explore' && (
                        <SpaceExplore
                            onLike={likePost}
                            onUnlike={unlikePost}
                            onComment={handleComment}
                            onRepost={(id) => { repostPost(id); showToast('已转发', 'success'); }}
                            onUnrepost={(id) => { unrepostPost(id); showToast('已取消转发', 'info'); }}
                            onQuote={handleQuotePost}
                            onShare={handleShare}
                            onPostClick={handlePostClick}
                            onAuthorClick={handleAuthorClick}
                            onHashtagClick={handleTrendClick}
                        />
                    )}
                    {activeSection === 'notifications' && (
                        <SpaceNotifications
                            onPostClick={handlePostClick}
                            onAuthorClick={handleAuthorClick}
                        />
                    )}
                </div>
                {showBackToTop && (
                    <button
                        type="button"
                        className="space-page__back-top"
                        onClick={() => scrollContentToTop('smooth')}
                        aria-label="回到顶部"
                        title="回到顶部"
                    >
                        <ArrowUp size={18} />
                    </button>
                )}
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
            <SpaceAsideWidgets
                trends={trends}
                recommendedUsers={recommendedUsers}
                loadingAside={loadingAside}
                asideError={asideError}
                recommendationRefreshStatus={recommendationRefreshStatus}
                loadingRecommendationRefresh={loadingRecommendationRefresh}
                recommendationRefreshError={recommendationRefreshError}
                onRetry={loadAside}
                onRecommendationRefreshRetry={loadRecommendationRefreshStatus}
                onTrendClick={handleTrendClick}
                onFollowToggle={handleFollowToggle}
                onUserClick={handleAuthorClick}
                refreshingRecommendedUsers={refreshingRecommendedUsers}
                onRefreshRecommendedUsers={() => void handleRefreshRecommendedUsers()}
            />

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
                    {unreadNotificationsCount > 0 && (
                        <span className="space-page__bottom-badge" aria-label={`未读通知 ${unreadNotificationsCount}`}>
                            {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    className={`space-page__bottom-item ${location.pathname === '/chat' ? 'is-active' : ''}`}
                    onClick={() => handleNavClick('/chat', '消息')}
                >
                    <MessageIcon />
                    <span>消息</span>
                    {chatUnreadBadgeCount > 0 && (
                        <span className="space-page__bottom-badge" aria-label={`未读消息 ${chatUnreadBadgeCount}`}>
                            {chatUnreadBadgeCount > 99 ? '99+' : chatUnreadBadgeCount}
                        </span>
                    )}
                </button>
            </nav>

            <button
                type="button"
                className="space-page__fab"
                onClick={() => setComposeModalOpen(true)}
                aria-label="发布动态"
            >
                <PlusIcon />
            </button>

            <ComposePostModal
                open={composeModalOpen}
                onOpenChange={setComposeModalOpen}
                currentUser={currentUser || { username: 'User' }}
                onSubmit={handleCreatePost}
            />

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
