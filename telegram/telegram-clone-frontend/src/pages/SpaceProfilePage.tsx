import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { authUtils } from '../services/apiClient';
import { spaceAPI, type UserProfile } from '../services/spaceApi';
import { SpacePost, SpaceCommentDrawer, type PostData } from '../components/space';
import { ArrowLeftIcon } from '../components/icons/SpaceIcons';
import { showToast } from '../components/ui/Toast';
import { SHARE_BASE_URL } from '../config/share';
import './SpaceProfilePage.css';

const SpaceProfilePage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const currentUser = authUtils.getCurrentUser();
    const isSelf = currentUser?.id === id;

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [posts, setPosts] = useState<PostData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [cursor, setCursor] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(true);
    const [loadingPosts, setLoadingPosts] = useState(false);
    const [likes, setLikes] = useState<PostData[]>([]);
    const [likesCursor, setLikesCursor] = useState<string | undefined>(undefined);
    const [likesHasMore, setLikesHasMore] = useState(true);
    const [likesLoading, setLikesLoading] = useState(false);
    const [commentPost, setCommentPost] = useState<PostData | null>(null);
    const [pinnedPost, setPinnedPost] = useState<PostData | null>(null);
    const [coverUploading, setCoverUploading] = useState(false);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const [activeTab, setActiveTab] = useState<'posts' | 'media' | 'likes'>('posts');

    const loadPosts = async (reset: boolean = false, pinnedId?: string | null) => {
        if (!id) return;
        setLoadingPosts(true);
        try {
            const result = await spaceAPI.getUserPosts(id, 20, reset ? undefined : cursor);
            const filtered = pinnedId ? result.posts.filter((post) => post.id !== pinnedId) : result.posts;
            setPosts((prev) => (reset ? filtered : [...prev, ...filtered]));
            setHasMore(result.hasMore);
            setCursor(result.nextCursor);
        } catch (err) {
            console.error('加载帖子失败:', err);
            setHasMore(false);
        } finally {
            setLoadingPosts(false);
        }
    };

    const loadLikes = async (reset: boolean = false) => {
        if (!id) return;
        if (!reset && (likesLoading || !likesHasMore)) return;
        setLikesLoading(true);
        try {
            const result = await spaceAPI.getUserLikes(id, 20, reset ? undefined : likesCursor);
            setLikes((prev) => (reset ? result.posts : [...prev, ...result.posts]));
            setLikesHasMore(result.hasMore);
            setLikesCursor(result.nextCursor);
        } catch (err) {
            console.error('加载点赞列表失败:', err);
            setLikesHasMore(false);
        } finally {
            setLikesLoading(false);
        }
    };

    useEffect(() => {
        if (!id) return;
        let mounted = true;
        const load = async () => {
            setLoading(true);
            setError(null);
            setActiveTab('posts');
            setLikes([]);
            setLikesCursor(undefined);
            setLikesHasMore(true);
            try {
                const profileData = await spaceAPI.getUserProfile(id);
                if (!mounted) return;
                setProfile(profileData);
                setPinnedPost(profileData.pinnedPost || null);
                await loadPosts(true, profileData.pinnedPost?.id || null);
            } catch (err: any) {
                if (!mounted) return;
                setError(err?.message || '加载失败');
            } finally {
                if (mounted) setLoading(false);
            }
        };
        load();
        return () => {
            mounted = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const handleFollowToggle = async () => {
        if (!profile) return;
        try {
            if (profile.isFollowed) {
                await spaceAPI.unfollowUser(profile.id);
                setProfile((prev) => prev ? {
                    ...prev,
                    isFollowed: false,
                    stats: { ...prev.stats, followers: Math.max(0, prev.stats.followers - 1) }
                } : prev);
                showToast(`已取消关注 ${profile.username}`, 'info');
            } else {
                await spaceAPI.followUser(profile.id);
                setProfile((prev) => prev ? {
                    ...prev,
                    isFollowed: true,
                    stats: { ...prev.stats, followers: prev.stats.followers + 1 }
                } : prev);
                showToast(`已关注 ${profile.username}`, 'success');
            }
        } catch (err) {
            showToast('操作失败，请稍后再试', 'error');
        }
    };

    const handleCoverChange = async (file: File) => {
        if (!profile) return;
        try {
            setCoverUploading(true);
            const coverUrl = await spaceAPI.updateCover(profile.id, file);
            setProfile((prev) => prev ? { ...prev, coverUrl } : prev);
            showToast('封面已更新', 'success');
        } catch (err) {
            console.error('更新封面失败:', err);
            showToast('封面更新失败，请稍后再试', 'error');
        } finally {
            setCoverUploading(false);
        }
    };

    const handlePinToggle = async (postId: string, nextPinned: boolean) => {
        try {
            if (nextPinned) {
                const previousPinned = pinnedPost;
                const updated = await spaceAPI.pinPost(postId);
                setPinnedPost(updated);
                setPosts((prev) => {
                    const withoutNew = prev.filter((post) => post.id !== postId);
                    if (previousPinned && previousPinned.id !== postId) {
                        return [{ ...previousPinned, isPinned: false }, ...withoutNew];
                    }
                    return withoutNew;
                });
                showToast('已设为置顶动态', 'success');
            } else {
                const updated = await spaceAPI.unpinPost(postId);
                setPinnedPost(null);
                setPosts((prev) => [{ ...updated, isPinned: false }, ...prev]);
                showToast('已取消置顶', 'info');
            }
        } catch (err) {
            console.error('置顶操作失败:', err);
            showToast('置顶操作失败，请稍后再试', 'error');
        }
    };

    const handleLikeInLikes = async (postId: string) => {
        await spaceAPI.likePost(postId);
        setLikes((prev) =>
            prev.map((post) =>
                post.id === postId
                    ? { ...post, isLiked: true, likeCount: post.likeCount + 1 }
                    : post
            )
        );
    };

    const handleUnlikeInLikes = async (postId: string) => {
        await spaceAPI.unlikePost(postId);
        const nextLikes = likes.filter((post) => post.id !== postId);
        setLikes(nextLikes);
        if (likesHasMore && !likesLoading && nextLikes.length < 6) {
            loadLikes(false);
        }
    };

    const handleCommentAdded = (postId: string) => {
        setPosts((prev) => prev.map((post) => post.id === postId ? { ...post, commentCount: post.commentCount + 1 } : post));
        setPinnedPost((prev) => prev && prev.id === postId ? { ...prev, commentCount: prev.commentCount + 1 } : prev);
        setLikes((prev) => prev.map((post) => post.id === postId ? { ...post, commentCount: post.commentCount + 1 } : post));
    };

    const mediaPosts = posts.filter((post) => post.media && post.media.length > 0);
    const isMediaTab = activeTab === 'media';
    const isLikesTab = activeTab === 'likes';
    const visiblePosts = isMediaTab ? mediaPosts : posts;
    const showPinned = !isLikesTab && (activeTab === 'posts' || (isMediaTab && pinnedPost?.media?.length));

    useEffect(() => {
        if (activeTab !== 'likes') return;
        if (likesLoading || likes.length > 0) return;
        loadLikes(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, id]);

    if (loading) {
        return (
            <div className="space-profile">
                <div className="space-profile__shell">
                    <div className="space-profile__loading">加载中...</div>
                </div>
            </div>
        );
    }

    if (error || !profile) {
        return (
            <div className="space-profile">
                <div className="space-profile__shell">
                    <div className="space-profile__error">{error || '用户不存在'}</div>
                    <button className="space-profile__back" onClick={() => navigate('/space')}>
                        <ArrowLeftIcon />
                        返回 Space
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-profile">
            <div className="space-profile__shell">
                <header className="space-profile__header">
                    <div className="space-profile__header-left">
                        <button className="space-profile__back" onClick={() => navigate(-1)}>
                            <ArrowLeftIcon />
                            返回
                        </button>
                        <div className="space-profile__title">
                            <h1>个人主页</h1>
                            <div className="space-profile__title-pills">
                                <button
                                    type="button"
                                    className={`space-profile__pill ${activeTab === 'posts' ? 'is-active' : ''}`}
                                    onClick={() => setActiveTab('posts')}
                                >
                                    动态
                                </button>
                                <button
                                    type="button"
                                    className={`space-profile__pill ${activeTab === 'media' ? 'is-active' : ''}`}
                                    onClick={() => setActiveTab('media')}
                                >
                                    媒体
                                </button>
                                <button
                                    type="button"
                                    className={`space-profile__pill ${activeTab === 'likes' ? 'is-active' : ''}`}
                                    onClick={() => setActiveTab('likes')}
                                >
                                    喜欢
                                </button>
                            </div>
                        </div>
                    </div>
                </header>
                <div className="space-profile__divider" />

                <section className="space-profile__hero">
                    <div className="space-profile__cover">
                        {profile.coverUrl ? (
                            <img src={profile.coverUrl} alt="空间封面" className="space-profile__cover-img" />
                        ) : (
                            <div className="space-profile__cover-placeholder" />
                        )}
                        <div className="space-profile__cover-overlay" />
                        {isSelf && (
                            <div className="space-profile__cover-actions">
                                <button
                                    className="space-profile__cover-btn"
                                    onClick={() => coverInputRef.current?.click()}
                                    disabled={coverUploading}
                                >
                                    {coverUploading ? '上传中...' : '编辑封面'}
                                </button>
                                <input
                                    ref={coverInputRef}
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleCoverChange(file);
                                        e.currentTarget.value = '';
                                    }}
                                />
                            </div>
                        )}
                    </div>

                    <div className="space-profile__card">
                        <div className="space-profile__avatar">
                            {profile.avatarUrl ? (
                                <img src={profile.avatarUrl} alt={profile.username} />
                            ) : (
                                <span>{profile.username.charAt(0).toUpperCase()}</span>
                            )}
                        </div>
                        <div className="space-profile__info">
                            <div className="space-profile__name">{profile.username}</div>
                            <div className="space-profile__meta">
                                <span>@{profile.username}</span>
                                {profile.createdAt && (
                                    <span>加入于 {new Date(profile.createdAt).toLocaleDateString('zh-CN')}</span>
                                )}
                            </div>
                            <div className="space-profile__stats">
                                <div className="space-profile__stat">
                                    <span className="space-profile__stat-icon space-profile__stat-icon--posts" aria-hidden="true">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <rect x="4" y="4" width="16" height="16" rx="4" />
                                            <path d="M8 9h8M8 13h8M8 17h5" />
                                        </svg>
                                    </span>
                                    <div className="space-profile__stat-text">
                                        <strong>{profile.stats.posts}</strong>
                                        <span>动态</span>
                                    </div>
                                </div>
                                <div className="space-profile__stat">
                                    <span className="space-profile__stat-icon space-profile__stat-icon--followers" aria-hidden="true">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="9" cy="8" r="3" />
                                            <path d="M3 19a6 6 0 0 1 12 0" />
                                            <path d="M17 11h4M19 9v4" />
                                        </svg>
                                    </span>
                                    <div className="space-profile__stat-text">
                                        <strong>{profile.stats.followers}</strong>
                                        <span>关注者</span>
                                    </div>
                                </div>
                                <div className="space-profile__stat">
                                    <span className="space-profile__stat-icon space-profile__stat-icon--following" aria-hidden="true">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="9" cy="8" r="3" />
                                            <path d="M3 19a6 6 0 0 1 12 0" />
                                            <path d="M16 12l2 2 4-4" />
                                        </svg>
                                    </span>
                                    <div className="space-profile__stat-text">
                                        <strong>{profile.stats.following}</strong>
                                        <span>正在关注</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        {!isSelf && (
                            <div className="space-profile__actions">
                                <button
                                    className={`space-profile__follow ${profile.isFollowed ? 'is-followed' : ''}`}
                                    onClick={handleFollowToggle}
                                >
                                    {profile.isFollowed ? '已关注' : '关注'}
                                </button>
                                <button
                                    className="space-profile__dm"
                                    onClick={() => navigate(`/chat?dm=${profile.id}`)}
                                >
                                    私信
                                </button>
                            </div>
                        )}
                    </div>
                </section>

                {showPinned && (
                    <section className="space-profile__pinned">
                        <div className="space-profile__pinned-header">
                            <h2>置顶动态</h2>
                            {isSelf && (
                                <span className="space-profile__pinned-tip">
                                    置顶后将展示在主页顶部
                                </span>
                            )}
                        </div>
                        {pinnedPost ? (
                            <SpacePost
                                key={pinnedPost.id}
                                post={pinnedPost}
                                onLike={(postId) => spaceAPI.likePost(postId)}
                                onUnlike={(postId) => spaceAPI.unlikePost(postId)}
                                onComment={(postId) => {
                                    setCommentPost(pinnedPost.id === postId ? pinnedPost : null);
                                }}
                                onRepost={(postId) => spaceAPI.repostPost(postId)}
                                onShare={(postId) => {
                                    navigator.clipboard.writeText(`${SHARE_BASE_URL}/space/post/${postId}`);
                                    showToast('链接已复制到剪贴板', 'success');
                                }}
                                onClick={(postId) => navigate(`/space/post/${postId}`)}
                                onAuthorClick={(authorId) => navigate(`/space/user/${authorId}`)}
                                showRecommendationReason={false}
                                showPinAction={isSelf}
                                onPinToggle={handlePinToggle}
                            />
                        ) : (
                            <div className="space-profile__empty space-profile__empty--pinned">
                                还没有置顶动态
                            </div>
                        )}
                    </section>
                )}

                <section className="space-profile__posts">
                    <h2>{activeTab === 'posts' ? '动态' : activeTab === 'media' ? '媒体' : '喜欢'}</h2>
                    <div className="space-profile__tab-panel" key={activeTab}>
                        {isLikesTab && likes.length === 0 && !likesLoading && (
                            <div className="space-profile__empty space-profile__empty--likes">
                                <div className="space-profile__empty-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
                                    </svg>
                                </div>
                                <div className="space-profile__empty-title">还没有喜欢内容</div>
                                <div className="space-profile__empty-desc">点赞后会在这里集中展示，方便回看。</div>
                            </div>
                        )}
                        {!isLikesTab && visiblePosts.length === 0 && !loadingPosts && (
                            <div className="space-profile__empty">
                                {isMediaTab ? '暂无媒体内容' : '还没有发布动态'}
                            </div>
                        )}
                        {isLikesTab && likesLoading && likes.length === 0 && (
                            <div className="space-profile__likes-skeleton">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <div className="space-profile__skeleton-card" key={`likes-skel-${i}`}>
                                        <div className="space-profile__skeleton-avatar" />
                                        <div className="space-profile__skeleton-lines">
                                            <div className="space-profile__skeleton-line is-wide" />
                                            <div className="space-profile__skeleton-line" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {isLikesTab && (
                            <div className="space-profile__post-list">
                                {likes.map((post) => (
                                    <SpacePost
                                        key={post.id}
                                        post={post}
                                        onLike={handleLikeInLikes}
                                        onUnlike={handleUnlikeInLikes}
                                        onComment={(postId) => {
                                            const target = likes.find((p) => p.id === postId) || null;
                                            setCommentPost(target);
                                        }}
                                        onRepost={(postId) => spaceAPI.repostPost(postId)}
                                        onShare={(postId) => {
                                            navigator.clipboard.writeText(`${SHARE_BASE_URL}/space/post/${postId}`);
                                            showToast('链接已复制到剪贴板', 'success');
                                        }}
                                        onClick={(postId) => navigate(`/space/post/${postId}`)}
                                        onAuthorClick={(authorId) => navigate(`/space/user/${authorId}`)}
                                        showRecommendationReason={false}
                                    />
                                ))}
                            </div>
                        )}
                        {!isLikesTab && (
                            <div className="space-profile__post-list">
                                {visiblePosts.map((post) => (
                                    <SpacePost
                                        key={post.id}
                                        post={post}
                                        onLike={(postId) => spaceAPI.likePost(postId)}
                                        onUnlike={(postId) => spaceAPI.unlikePost(postId)}
                                        onComment={(postId) => {
                                            const target = visiblePosts.find((p) => p.id === postId) || null;
                                            setCommentPost(target);
                                        }}
                                        onRepost={(postId) => spaceAPI.repostPost(postId)}
                                        onShare={(postId) => {
                                            navigator.clipboard.writeText(`${SHARE_BASE_URL}/space/post/${postId}`);
                                            showToast('链接已复制到剪贴板', 'success');
                                        }}
                                        onClick={(postId) => navigate(`/space/post/${postId}`)}
                                        onAuthorClick={(authorId) => navigate(`/space/user/${authorId}`)}
                                        showRecommendationReason={false}
                                        showPinAction={isSelf}
                                        onPinToggle={handlePinToggle}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    {!isLikesTab && hasMore && (
                        <button
                            className="space-profile__more"
                            onClick={() => loadPosts(false, pinnedPost?.id || null)}
                            disabled={loadingPosts}
                        >
                            {loadingPosts ? '加载中...' : '加载更多'}
                        </button>
                    )}
                    {isLikesTab && likesHasMore && (
                        <>
                            <button
                                className="space-profile__more"
                                onClick={() => loadLikes(false)}
                                disabled={likesLoading}
                            >
                                {likesLoading ? '加载中...' : '加载更多'}
                            </button>
                            {likesLoading && (
                                <div className="space-profile__likes-load-skeleton">
                                    <span className="space-profile__likes-loading-dot" />
                                    <span className="space-profile__likes-loading-dot" />
                                    <span className="space-profile__likes-loading-dot" />
                                </div>
                            )}
                        </>
                    )}
                </section>
            </div>

            <SpaceCommentDrawer
                open={!!commentPost}
                post={commentPost}
                onClose={() => setCommentPost(null)}
                onCommentAdded={handleCommentAdded}
            />
        </div>
    );
};

export default SpaceProfilePage;
