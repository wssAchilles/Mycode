//! `telegram-thunder-store` 单元测试：覆盖向后兼容契约、三池分流、对话树门控、墓碑剔除、内存回收与 Stream 事件。

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};

use crate::stream_consumer::apply_stream_fields_map;
use crate::{
    CompactPost, InNetworkStore, LightPost, PostEvent, PostEventProcessor, ThunderConfig,
    ThunderStore, TinyPost, apply_recsys_stream_event,
};

fn make_post(post_id: &str, author_id: &str) -> LightPost {
    LightPost {
        post_id: post_id.to_string(),
        author_id: author_id.to_string(),
        content_preview: "test content".to_string(),
        created_at: Utc::now(),
        has_image: false,
        has_video: false,
        like_count: 10,
        comment_count: 5,
        repost_count: 2,
        view_count: 100,
        recall_source: "FollowingSource".to_string(),
        conversation_id: None,
        is_reply: false,
        is_repost: false,
        original_post_id: None,
        topic_tags: vec!["tech".to_string()],
    }
}

fn make_compact_post(
    post_id: &str,
    author_id: &str,
    created_at_ms: i64,
    is_reply: bool,
    is_repost: bool,
) -> CompactPost {
    CompactPost {
        post_id: post_id.to_string(),
        author_id: author_id.to_string(),
        created_at_ms,
        in_reply_to_post_id: None,
        original_post_id: None,
        conversation_id: None,
        is_reply,
        is_repost,
        has_video: false,
        video_duration_sec: None,
        semantic_ids: None,
    }
}

#[test]
fn upsert_and_get() {
    let store = ThunderStore::default();
    store.upsert(make_post("p1", "a1"));
    assert_eq!(store.len(), 1);
    let post = store.get("p1").unwrap();
    assert_eq!(post.post_id, "p1");
    assert_eq!(post.content_preview, "test content");
}

#[test]
fn delete_removes_post() {
    let store = ThunderStore::default();
    store.upsert(make_post("p1", "a1"));
    let removed = store.delete("p1");
    assert!(removed.is_some());
    assert!(store.get("p1").is_none());
    assert!(store.is_empty());
    assert!(store.is_deleted("p1"));
}

#[test]
fn batch_operations() {
    let store = ThunderStore::default();
    let posts = vec![
        make_post("p1", "a1"),
        make_post("p2", "a1"),
        make_post("p3", "a2"),
    ];
    store.upsert_batch(posts);
    assert_eq!(store.len(), 3);

    let results = store.get_batch(&["p1".to_string(), "p2".to_string(), "p999".to_string()]);
    assert!(results[0].is_some());
    assert!(results[1].is_some());
    assert!(results[2].is_none());

    let map = store.get_batch_map(&["p1".to_string(), "p3".to_string()]);
    assert_eq!(map.len(), 2);
}

#[test]
fn author_query() {
    let store = ThunderStore::default();
    store.upsert(make_post("p1", "a1"));
    store.upsert(make_post("p2", "a1"));
    store.upsert(make_post("p3", "a2"));

    let author_posts = store.get_by_author("a1");
    assert_eq!(author_posts.len(), 2);
}

#[test]
fn topic_query() {
    let store = ThunderStore::default();
    let mut post = make_post("p1", "a1");
    post.topic_tags = vec!["rust".to_string(), "async".to_string()];
    store.upsert(post);

    let mut post2 = make_post("p2", "a2");
    post2.topic_tags = vec!["python".to_string()];
    store.upsert(post2);

    assert_eq!(store.get_by_topic("rust").len(), 1);
    assert_eq!(store.get_by_topic("python").len(), 1);
    assert!(store.get_by_topic("golang").is_empty());
}

#[test]
fn prune_removes_expired() {
    let store = ThunderStore::new(ThunderConfig {
        max_age_days: 1,
        ..Default::default()
    });

    let mut old_post = make_post("old", "a1");
    old_post.created_at = Utc::now() - ChronoDuration::days(10);
    store.upsert(old_post);
    store.upsert(make_post("new", "a2"));

    let result = store.prune();
    assert_eq!(result.pruned_expired, 1);
    assert_eq!(store.len(), 1);
    assert!(store.get("new").is_some());
}

#[test]
fn post_event_processor() {
    let store = ThunderStore::default();
    store.process_event(PostEvent::Created {
        post: make_post("p1", "a1"),
    });
    assert_eq!(store.len(), 1);

    store.process_event(PostEvent::Deleted {
        post_id: "p1".to_string(),
    });
    assert!(store.is_empty());
}

#[test]
fn snapshot_reports_stats() {
    let store = ThunderStore::default();
    store.upsert(make_post("p1", "a1"));
    store.get("p1");

    let snap = store.snapshot();
    assert_eq!(snap.post_count, 1);
    assert_eq!(snap.author_count, 1);
    assert_eq!(snap.total_inserts, 1);
    assert_eq!(snap.total_queries, 1);
}

#[test]
fn compact_and_light_post_bidirectional_conversion() {
    let now = Utc::now();
    let light = LightPost {
        post_id: "p_conv".to_string(),
        author_id: "u_conv".to_string(),
        content_preview: "hello".to_string(),
        created_at: now,
        has_image: true,
        has_video: true,
        like_count: 5,
        comment_count: 2,
        repost_count: 1,
        view_count: 20,
        recall_source: "thunder".to_string(),
        conversation_id: Some("root_1".to_string()),
        is_reply: false,
        is_repost: true,
        original_post_id: Some("orig_1".to_string()),
        topic_tags: vec!["ai".to_string()],
    };

    let compact: CompactPost = light.clone().into();
    assert_eq!(compact.post_id, "p_conv");
    assert_eq!(compact.author_id, "u_conv");
    assert_eq!(compact.created_at_ms, now.timestamp_millis());
    assert_eq!(compact.original_post_id.as_deref(), Some("orig_1"));
    assert_eq!(compact.conversation_id.as_deref(), Some("root_1"));
    assert!(compact.is_repost);
    assert!(compact.has_video);
    assert_eq!(compact.video_duration_sec, None);
    assert_eq!(compact.semantic_ids, None);

    let back: LightPost = compact.into();
    assert_eq!(back.post_id, "p_conv");
    assert_eq!(back.author_id, "u_conv");
    assert_eq!(back.created_at.timestamp_millis(), now.timestamp_millis());
    assert_eq!(back.original_post_id.as_deref(), Some("orig_1"));
    assert_eq!(back.conversation_id.as_deref(), Some("root_1"));
    assert!(back.is_repost);
    assert!(back.has_video);
}

#[test]
fn three_pool_segregation_and_video_only_query() {
    let store = InNetworkStore::default();
    let now_ms = Utc::now().timestamp_millis();

    // 1. 纯原创文本帖 -> 仅进入 original_posts_by_author
    let orig_text = make_compact_post("orig_text", "a1", now_ms - 4_000, false, false);

    // 2. 合格原创长视频帖（>= 5.0 秒且非回复） -> 同时进入 original 与 video 池
    let mut orig_video = make_compact_post("orig_video", "a1", now_ms - 3_000, false, false);
    orig_video.has_video = true;
    orig_video.video_duration_sec = Some(5.0);

    // 3. 短视频帖（< 5.0 秒） -> 仅进入 original，不进入 video 池
    let mut short_video = make_compact_post("short_video", "a1", now_ms - 2_000, false, false);
    short_video.has_video = true;
    short_video.video_duration_sec = Some(4.9);

    // 4. 回复里的视频（即使 >= 5.0 秒） -> 仅进入 secondary，绝不进入 video 池
    let mut reply_video = make_compact_post("reply_video", "a1", now_ms - 1_000, true, false);
    reply_video.has_video = true;
    reply_video.video_duration_sec = Some(30.0);
    reply_video.in_reply_to_post_id = Some("orig_text".to_string());
    reply_video.conversation_id = Some("orig_text".to_string());

    // 5. 转发帖 -> 进入 secondary 池
    let mut repost = make_compact_post("repost_1", "a2", now_ms - 500, false, true);
    repost.original_post_id = Some("orig_text".to_string());

    store.upsert_compact_batch(vec![
        orig_text,
        orig_video,
        short_video,
        reply_video,
        repost,
    ]);

    let pool_stats = store.pool_stats();
    assert_eq!(pool_stats.total_posts, 5);
    assert_eq!(pool_stats.original_pool_entries, 3);
    assert_eq!(pool_stats.secondary_pool_entries, 2);
    assert_eq!(pool_stats.video_pool_entries, 1);

    // video_only = true 仅返回满足条件的视频帖
    let followed = vec!["a1".to_string(), "a2".to_string()];
    let videos = store.query_in_network(&followed, 10, true);
    assert_eq!(videos.len(), 1);
    assert_eq!(videos[0].post_id, "orig_video");

    // 常规查询按时间倒序返回全部合格候选
    let all = store.query_in_network(&followed, 3, false);
    let ids: Vec<&str> = all.iter().map(|p| p.post_id.as_str()).collect();
    assert_eq!(ids, vec!["repost_1", "reply_video", "short_video"]);
}

#[test]
fn conversation_tree_ancestor_gating() {
    let store = ThunderStore::default();
    let now_ms = Utc::now().timestamp_millis();

    // 根帖：非关注作者 u_root 发表原创帖
    let mut root = make_compact_post("root", "u_root", now_ms - 6_000, false, false);
    root.conversation_id = Some("root".to_string());

    // 一级回复 r1：关注作者 a1 回复根帖 -> 放行
    let mut r1 = make_compact_post("r1", "a1", now_ms - 5_000, true, false);
    r1.in_reply_to_post_id = Some("root".to_string());
    r1.conversation_id = Some("root".to_string());

    // 二级回复 r2：关注作者 a2 回复已关注的 a1，且 a1 回复了根帖 -> 放行
    let mut r2 = make_compact_post("r2", "a2", now_ms - 4_000, true, false);
    r2.in_reply_to_post_id = Some("r1".to_string());
    r2.conversation_id = Some("root".to_string());

    // 三级回复 r3：关注作者 a2 回复二级回复 r2 -> 拦截（深度超出 2 级）
    let mut r3 = make_compact_post("r3", "a2", now_ms - 3_000, true, false);
    r3.in_reply_to_post_id = Some("r2".to_string());
    r3.conversation_id = Some("root".to_string());

    // 未关注中间作者的一级回复 r_unfollowed 与对其的二级回复 r_blocked -> 拦截
    let mut r_unfollowed =
        make_compact_post("r_unfollowed", "u_other", now_ms - 4_500, true, false);
    r_unfollowed.in_reply_to_post_id = Some("root".to_string());
    r_unfollowed.conversation_id = Some("root".to_string());

    let mut r_blocked = make_compact_post("r_blocked", "a1", now_ms - 2_000, true, false);
    r_blocked.in_reply_to_post_id = Some("r_unfollowed".to_string());
    r_blocked.conversation_id = Some("root".to_string());

    // 孤儿回复（父帖不在存储中） -> 拦截
    let mut r_orphan = make_compact_post("r_orphan", "a1", now_ms - 1_000, true, false);
    r_orphan.in_reply_to_post_id = Some("missing_parent".to_string());
    r_orphan.conversation_id = Some("root".to_string());

    store.upsert_compact_batch(vec![root, r1, r2, r3, r_unfollowed, r_blocked, r_orphan]);

    let followed = vec!["a1".to_string(), "a2".to_string()];
    let results = store.query_in_network(&followed, 20, false);
    let ids: HashSet<&str> = results.iter().map(|p| p.post_id.as_str()).collect();

    assert!(ids.contains("r1"));
    assert!(ids.contains("r2"));
    assert!(!ids.contains("r3"));
    assert!(!ids.contains("r_blocked"));
    assert!(!ids.contains("r_orphan"));
}

#[test]
fn tombstone_blocks_reinsertion_and_filters_queries() {
    let store = ThunderStore::default();
    let now_ms = Utc::now().timestamp_millis();

    let mut p1 = make_compact_post("p1", "a1", now_ms - 2_000, false, false);
    p1.has_video = true;
    p1.video_duration_sec = Some(10.0);
    assert!(store.upsert_compact(p1.clone()));
    assert_eq!(store.pool_stats().video_pool_entries, 1);

    // 标记删除并摘除三池条目
    assert!(store.mark_deleted("p1", Some("a1"), now_ms));
    assert!(store.is_deleted("p1"));
    assert!(store.get_compact("p1").is_none());
    assert_eq!(store.pool_stats().original_pool_entries, 0);
    assert_eq!(store.pool_stats().video_pool_entries, 0);

    // 墓碑命中期间，即使收到迟到/重放的 post.created 也不允许复活
    assert!(!store.upsert_compact(p1));
    assert!(
        store
            .query_in_network(&["a1".to_string()], 10, false)
            .is_empty()
    );

    // 先收到 delete 墓碑，再收到迟到的 create 也应被拦截
    assert!(store.mark_deleted("p_late", Some("a1"), now_ms));
    let p_late = make_compact_post("p_late", "a1", now_ms - 1_000, false, false);
    assert!(!store.upsert_compact(p_late));
}

#[test]
fn prune_expired_shrinks_deque_and_tombstones() {
    let store = ThunderStore::new(ThunderConfig {
        max_posts: 1000,
        max_age_days: 2,
        prune_interval: Duration::from_secs(60),
        inactive_threshold: Duration::from_secs(3600),
    });

    let now_ms = Utc::now().timestamp_millis();
    let old_ms = now_ms - 5 * 86_400_000;

    // 插入大量过期帖以推高 VecDeque 容量，再保留 1 条新鲜帖
    for i in 0..200 {
        let post = make_compact_post(&format!("old_{i}"), "a1", old_ms + i, false, false);
        assert!(store.upsert_compact(post));
    }
    let fresh = make_compact_post("fresh", "a1", now_ms - 1_000, false, false);
    assert!(store.upsert_compact(fresh));

    // 同时写入一条过期墓碑与一条有效墓碑
    store.mark_deleted("tomb_old", None, old_ms);
    store.mark_deleted("tomb_fresh", None, now_ms - 1_000);

    let cap_before = store
        .original_posts_by_author
        .get("a1")
        .map(|d| d.capacity())
        .unwrap_or(0);
    assert!(cap_before >= 201);

    let prune_res = store.prune_expired();
    assert_eq!(prune_res.pruned_expired, 200);
    assert_eq!(prune_res.final_count, 1);

    let deque_after = store.original_posts_by_author.get("a1").unwrap();
    assert_eq!(deque_after.len(), 1);
    assert!(deque_after.capacity() < cap_before);
    assert!(!store.is_deleted("tomb_old"));
    assert!(store.is_deleted("tomb_fresh"));
}

#[test]
fn recsys_stream_events_create_sid_and_delete() {
    let store = ThunderStore::default();
    let now_ms = Utc::now().timestamp_millis();

    // 1. 消费 post.created（含视频时长，应同步进入原创池与视频池）
    let created_payload = format!(
        r#"{{
            "postId": "stream_p1",
            "authorId": "author_s1",
            "createdAtMs": {},
            "isReply": false,
            "isRepost": false,
            "hasVideo": true,
            "videoDurationSec": 12.5
        }}"#,
        now_ms - 500
    );
    assert!(apply_recsys_stream_event(
        &store,
        "post.created",
        &created_payload
    ));
    assert_eq!(store.len(), 1);
    assert_eq!(store.pool_stats().video_pool_entries, 1);

    // 2. 消费 post.sid_assigned（同时兼容 codes 与 semanticIds 字段）
    let sid_payload = r#"{
        "postId": "stream_p1",
        "codes": [12, 44, 78, 99, 128, 255]
    }"#;
    assert!(apply_recsys_stream_event(
        &store,
        "post.sid_assigned",
        sid_payload
    ));

    let queried = store.query_in_network(&["author_s1".to_string()], 10, true);
    assert_eq!(queried.len(), 1);
    assert_eq!(queried[0].semantic_ids, Some([12, 44, 78, 99, 128, 255]));

    // 3. 测试 Node 端 semanticIds 字段命名也可回填
    let sid_payload_node = r#"{
        "postId": "stream_p1",
        "semanticIds": [1, 2, 3, 4, 5, 6]
    }"#;
    assert!(apply_recsys_stream_event(
        &store,
        "post.sid_assigned",
        sid_payload_node
    ));
    assert_eq!(
        store.get_compact("stream_p1").unwrap().semantic_ids,
        Some([1, 2, 3, 4, 5, 6])
    );

    // 4. 非本模块职责的事件（如 graph.edge_delta）应返回 false 且不破坏状态
    assert!(!apply_recsys_stream_event(
        &store,
        "graph.edge_delta",
        r#"{"sourceUserId":"u1","targetUserId":"u2","edgeOp":"follow"}"#
    ));

    // 5. 测试字段字典直接解析辅助函数
    let mut fields = HashMap::new();
    fields.insert(
        "eventType".to_string(),
        redis::Value::BulkString(b"post.deleted".to_vec()),
    );
    fields.insert(
        "payload".to_string(),
        redis::Value::BulkString(
            format!(r#"{{"postId":"stream_p1","authorId":"author_s1","deletedAtMs":{now_ms}}}"#)
                .into_bytes(),
        ),
    );
    assert!(apply_stream_fields_map(&store, &fields));
    assert!(store.is_empty());
    assert!(store.is_deleted("stream_p1"));
    assert_eq!(store.pool_stats().original_pool_entries, 0);
    assert_eq!(store.pool_stats().video_pool_entries, 0);
}

#[test]
fn tiny_post_sorted_order_on_out_of_order_inserts() {
    let store = ThunderStore::default();
    let base_ms = Utc::now().timestamp_millis();

    store.upsert_compact(make_compact_post("p2", "a1", base_ms - 2_000, false, false));
    store.upsert_compact(make_compact_post("p1", "a1", base_ms - 3_000, false, false));
    store.upsert_compact(make_compact_post("p3", "a1", base_ms - 1_000, false, false));

    let deque = store.original_posts_by_author.get("a1").unwrap();
    let ordered: Vec<&TinyPost> = deque.iter().collect();
    assert_eq!(ordered[0].post_id, "p1");
    assert_eq!(ordered[1].post_id, "p2");
    assert_eq!(ordered[2].post_id, "p3");
}

#[test]
fn prune_enforces_max_posts_and_cleans_pools() {
    let store = ThunderStore::new(ThunderConfig {
        max_posts: 2,
        max_age_days: 7,
        prune_interval: Duration::from_secs(60),
        inactive_threshold: Duration::from_secs(3600),
    });
    let now_ms = Utc::now().timestamp_millis();

    store.upsert_compact(make_compact_post("p1", "a1", now_ms - 3_000, false, false));
    store.upsert_compact(make_compact_post("p2", "a2", now_ms - 2_000, false, false));
    store.upsert_compact(make_compact_post("p3", "a3", now_ms - 1_000, false, false));

    let res = store.prune_expired();
    assert_eq!(res.pruned_inactive, 1);
    assert_eq!(store.len(), 2);
    assert!(store.get_compact("p1").is_none());
    assert!(store.get_compact("p2").is_some());
    assert!(store.get_compact("p3").is_some());
    assert_eq!(store.pool_stats().original_pool_entries, 2);
    assert!(!store.original_posts_by_author.contains_key("a1"));
}

#[test]
fn sid_assigned_validates_bounds_and_respects_tombstone() {
    let store = ThunderStore::default();
    let now_ms = Utc::now().timestamp_millis();

    store.upsert_compact(make_compact_post("p1", "a1", now_ms - 1_000, false, false));

    // 超界或全缺失哨兵值应拒绝写入
    assert!(!apply_recsys_stream_event(
        &store,
        "post.sid_assigned",
        r#"{"postId":"p1","codes":[256,0,0,0,0,0]}"#
    ));
    assert!(!apply_recsys_stream_event(
        &store,
        "post.sid_assigned",
        r#"{"postId":"p1","codes":[-1,-1,-1,-1,-1,-1]}"#
    ));
    assert_eq!(store.get_compact("p1").unwrap().semantic_ids, None);

    // 删帖后迟到的 SID 事件应被墓碑拦截
    assert!(store.mark_deleted("p1", Some("a1"), now_ms));
    assert!(!apply_recsys_stream_event(
        &store,
        "post.sid_assigned",
        r#"{"postId":"p1","codes":[1,2,3,4,5,6]}"#
    ));
}
