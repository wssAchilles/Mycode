import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { authUtils } from '../services/apiClient';
import { spaceAPI, type UserProfile } from '../services/spaceApi';
import { SpacePost, SpaceCommentDrawer, type PostData } from '../components/space';
import { ArrowLeftIcon } from '../components/icons/SpaceIcons';
import { showToast } from '../components/ui/Toast';
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
    const [commentPost, setCommentPost] = useState<PostData | null>(null);

    const loadPosts = async (reset: boolean = false) => {
        if (!id) return;
        setLoadingPosts(true);
        try {
            const result = await spaceAPI.getUserPosts(id, 20, reset ? undefined : cursor);
            setPosts((prev) => (reset ? result.posts : [...prev, ...result.posts]));
            setHasMore(result.hasMore);
            setCursor(result.nextCursor);
        } catch (err) {
            console.error('加载帖子失败:', err);
            setHasMore(false);
        } finally {
            setLoadingPosts(false);
        }
    };

    useEffect(() => {
        if (!id) return;
        let mounted = true;
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const profileData = await spaceAPI.getUserProfile(id);
                if (!mounted) return;
                setProfile(profileData);
                await loadPosts(true);
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

    const handleCommentAdded = (postId: string) => {
        setPosts((prev) => prev.map((post) => post.id === postId ? { ...post, commentCount: post.commentCount + 1 } : post));
    };

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
                    <button className="space-profile__back" onClick={() => navigate(-1)}>
                        <ArrowLeftIcon />
                        返回
                    </button>
                    <h1>个人主页</h1>
                </header>

                <section className="space-profile__card">
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
                            <div>
                                <strong>{profile.stats.posts}</strong>
                                <span>动态</span>
                            </div>
                            <div>
                                <strong>{profile.stats.followers}</strong>
                                <span>关注者</span>
                            </div>
                            <div>
                                <strong>{profile.stats.following}</strong>
                                <span>正在关注</span>
                            </div>
                        </div>
                    </div>
                    {!isSelf && (
                        <button
                            className={`space-profile__follow ${profile.isFollowed ? 'is-followed' : ''}`}
                            onClick={handleFollowToggle}
                        >
                            {profile.isFollowed ? '已关注' : '关注'}
                        </button>
                    )}
                </section>

                <section className="space-profile__posts">
                    <h2>动态</h2>
                    {posts.length === 0 && !loadingPosts && (
                        <div className="space-profile__empty">还没有发布动态</div>
                    )}
                    <div className="space-profile__post-list">
                        {posts.map((post) => (
                            <SpacePost
                                key={post.id}
                                post={post}
                                onLike={(postId) => spaceAPI.likePost(postId)}
                                onUnlike={(postId) => spaceAPI.unlikePost(postId)}
                                onComment={(postId) => {
                                    const target = posts.find((p) => p.id === postId) || null;
                                    setCommentPost(target);
                                }}
                                onRepost={(postId) => spaceAPI.repostPost(postId)}
                                onShare={(postId) => {
                                    navigator.clipboard.writeText(`https://telegram-clone.app/space/post/${postId}`);
                                    showToast('链接已复制到剪贴板', 'success');
                                }}
                                onClick={(postId) => navigate(`/space/post/${postId}`)}
                                onAuthorClick={(authorId) => navigate(`/space/user/${authorId}`)}
                                showRecommendationReason={false}
                            />
                        ))}
                    </div>
                    {hasMore && (
                        <button
                            className="space-profile__more"
                            onClick={() => loadPosts(false)}
                            disabled={loadingPosts}
                        >
                            {loadingPosts ? '加载中...' : '加载更多'}
                        </button>
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
