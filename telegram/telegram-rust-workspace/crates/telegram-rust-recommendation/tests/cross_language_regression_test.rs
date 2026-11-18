//! 跨语言推荐主引擎高杠杆回归测试集（覆盖 RECSYS-BUG-01 / 02 / 03 及 C++ 图核鉴权头）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use chrono::Utc;
use serde_json::{Value, json};
use telegram_component_primitives::candidate_hydrators::REMOTE_CANDIDATE_HYDRATOR_NAMES;
use telegram_pipeline_primitives::{
    RANKING_MODE_PHOENIX_STANDARDIZED, RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2,
    RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2,
};
use telegram_rust_http_types::SuccessEnvelope;
use telegram_rust_recommendation::clients::deadline::RECOMMENDATION_DEADLINE_HEADER;
use telegram_rust_recommendation::clients::graph::GraphClient;
use telegram_rust_recommendation::clients::graph::http_client::HttpGraphClient;
use telegram_rust_recommendation::clients::graph_kernel_client::{
    GRAPH_KERNEL_INTERNAL_TOKEN_HEADER, GraphKernelClient,
};
use telegram_rust_recommendation::config::RecommendationConfig;
use telegram_rust_recommendation::contracts::{
    CandidateMediaPayload, MediaType, RecommendationCandidatePayload, RecommendationQueryPayload,
    RecommendationResultPayload,
};
use telegram_rust_recommendation::server::app::{build_app_state, build_router};
use telegram_rust_recommendation::server::state::AppState;
use telegram_thunder_store::{LightPost, apply_recsys_stream_event_with_hook};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Clone, Default)]
struct MockNodeState {
    hydrate_components_seen: Arc<Mutex<Vec<Vec<String>>>>,
    source_batch_calls: Arc<AtomicUsize>,
}

fn build_test_config(backend_url: String) -> RecommendationConfig {
    RecommendationConfig {
        bind_addr: "127.0.0.1:0".to_string(),
        backend_url,
        redis_url: String::new(),
        internal_token: Some("test-internal-secret".to_string()),
        internal_token_required: true,
        timeout_ms: 9_000,
        graph_kernel_enabled: false,
        graph_kernel_url: "http://127.0.0.1:59998".to_string(),
        graph_kernel_timeout_ms: 500,
        graph_materializer_limit_per_author: 2,
        graph_materializer_lookback_days: 7,
        stage: RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2.to_string(),
        retrieval_mode: RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2.to_string(),
        ranking_mode: RANKING_MODE_PHOENIX_STANDARDIZED.to_string(),
        selector_oversample_factor: 5,
        selector_max_size: 200,
        recent_per_user_capacity: 32,
        recent_global_capacity: 64,
        recent_hot_shard_count: 4,
        recent_source_enabled: true,
        source_order: vec!["FollowingSource".to_string(), "PopularSource".to_string()],
        graph_source_enabled: false,
        serve_cache_enabled: true,
        serve_cache_ttl_secs: 45,
        serve_cache_prefix: "test:serve:v1".to_string(),
        cache_singleflight_enabled: false,
        cache_local_capacity: 128,
        serving_author_soft_cap: 2,
        news_trends_cache_enabled: false,
        news_trends_cache_ttl_secs: 60,
        news_trends_cache_prefix: "test:news:v1".to_string(),
        source_cache_enabled: true,
        source_cache_ttl_secs: 300,
        source_cache_prefix: "test:source:v1".to_string(),
    }
}

async fn spawn_strict_mock_node_backend(state: MockNodeState) -> String {
    let router = Router::new()
        .route(
            "/internal/recommendation/query-hydrators/batch",
            post(|Json(body): Json<Value>| async move {
                let names = body["hydratorNames"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                let items = names
                    .into_iter()
                    .filter_map(|val| val.as_str().map(str::to_string))
                    .map(|name| {
                        // 复现 Node UserFeaturesQueryHydrator 返回不含 videoPreference/isSubscriber 的补丁
                        let patch = if name == "UserFeaturesQueryHydrator" {
                            json!({
                                "userFeatures": {
                                    "followedUserIds": ["author-100"],
                                    "blockedUserIds": [],
                                    "mutedUserIds": []
                                }
                            })
                        } else if name == "UserStateQueryHydrator" {
                            json!({
                                "userStateContext": {
                                    "state": "warm",
                                    "reason": "active_follows",
                                    "followedCount": 12,
                                    "recentActionCount": 25,
                                    "recentPositiveActionCount": 10,
                                    "usableEmbedding": false
                                }
                            })
                        } else {
                            json!({})
                        };
                        json!({
                            "hydratorName": name,
                            "stage": {
                                "name": name,
                                "enabled": true,
                                "durationMs": 1,
                                "inputCount": 1,
                                "outputCount": 1
                            },
                            "queryPatch": patch,
                            "providerCalls": { format!("query_hydrator:{name}"): 1 }
                        })
                    })
                    .collect::<Vec<_>>();
                Json(SuccessEnvelope {
                    success: true,
                    data: json!({
                        "items": items,
                        "providerCalls": {}
                    }),
                })
            }),
        )
        .route(
            "/internal/recommendation/sources/batch",
            post(
                |State(mock): State<MockNodeState>, Json(body): Json<Value>| async move {
                    mock.source_batch_calls.fetch_add(1, Ordering::SeqCst);
                    let names = body["sourceNames"].as_array().cloned().unwrap_or_default();
                    let now = Utc::now().to_rfc3339();
                    let items = names
                        .into_iter()
                        .filter_map(|val| val.as_str().map(str::to_string))
                        .map(|source_name| {
                            json!({
                                "sourceName": source_name,
                                "timedOut": false,
                                "timeoutMs": 1500,
                                "stage": {
                                    "name": source_name,
                                    "enabled": true,
                                    "durationMs": 2,
                                    "inputCount": 0,
                                    "outputCount": 1
                                },
                                "candidates": [
                                    {
                                        "postId": format!("post-from-{source_name}"),
                                        "authorId": "author-100",
                                        "content": "跨语言推荐端到端验证帖子",
                                        "createdAt": now,
                                        "isReply": false,
                                        "isRepost": false,
                                        "inNetwork": source_name == "FollowingSource",
                                        "media": [
                                            {
                                                "type": "image",
                                                "url": "https://cdn.example.com/pic.jpg"
                                            }
                                        ]
                                    }
                                ]
                            })
                        })
                        .collect::<Vec<_>>();
                    Json(SuccessEnvelope {
                        success: true,
                        data: json!({
                            "items": items,
                            "providerCalls": { "sources_batch": 1 }
                        }),
                    })
                },
            ),
        )
        .route(
            "/internal/recommendation/hydrate",
            post(
                |State(mock): State<MockNodeState>, Json(body): Json<Value>| async move {
                    let components = body["componentNames"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default()
                        .into_iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect::<Vec<_>>();
                    mock.hydrate_components_seen
                        .lock()
                        .unwrap()
                        .push(components.clone());

                    // 严格复现 Node adapterService.resolveHydrators：一旦出现非远端水合器立即返回 500
                    let unknown = components
                        .iter()
                        .filter(|name| !REMOTE_CANDIDATE_HYDRATOR_NAMES.contains(&name.as_str()))
                        .cloned()
                        .collect::<Vec<_>>();
                    if !unknown.is_empty() {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({
                                "success": false,
                                "error": format!("unknown_hydrator:{}", unknown.join(","))
                            })),
                        );
                    }

                    let candidates = body["candidates"].as_array().cloned().unwrap_or_default();
                    let count = candidates.len();
                    let stages = components
                        .iter()
                        .map(|name| {
                            json!({
                                "name": name,
                                "enabled": true,
                                "durationMs": 1,
                                "inputCount": count,
                                "outputCount": count
                            })
                        })
                        .collect::<Vec<_>>();
                    (
                        StatusCode::OK,
                        Json(json!({
                            "success": true,
                            "data": {
                                "candidates": candidates,
                                "stages": stages,
                                "providerCalls": { "hydrate": 1 }
                            }
                        })),
                    )
                },
            ),
        )
        .route(
            "/internal/recommendation/score",
            post(|Json(body): Json<Value>| async move {
                let candidates = body["candidates"].as_array().cloned().unwrap_or_default();
                let count = candidates.len();
                Json(SuccessEnvelope {
                    success: true,
                    data: json!({
                        "candidates": candidates,
                        "stages": [{
                            "name": "PhoenixScorer",
                            "enabled": true,
                            "durationMs": 1,
                            "inputCount": count,
                            "outputCount": count
                        }],
                        "providerCalls": { "score": 1 }
                    }),
                })
            }),
        )
        .route(
            "/internal/recommendation/post-selection/hydrate",
            post(|Json(body): Json<Value>| async move {
                let candidates = body["candidates"].as_array().cloned().unwrap_or_default();
                let count = candidates.len();
                Json(SuccessEnvelope {
                    success: true,
                    data: json!({
                        "candidates": candidates,
                        "stages": [{
                            "name": "VFCandidateHydrator",
                            "enabled": true,
                            "durationMs": 1,
                            "inputCount": count,
                            "outputCount": count
                        }],
                        "providerCalls": { "post_selection_hydrate": 1 }
                    }),
                })
            }),
        )
        .with_state(state);

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("绑定测试监听端口");
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    format!("http://{addr}/internal/recommendation")
}

async fn spawn_recommendation_server(app_state: AppState) -> String {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("绑定推荐测试服务监听端口");
    let addr = listener.local_addr().unwrap();
    let router = build_router(app_state);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn primary_pipeline_splits_remote_and_local_hydrators_and_records_422_metrics() {
    let mock_state = MockNodeState::default();
    let backend_url = spawn_strict_mock_node_backend(mock_state.clone()).await;
    let app_state = build_app_state(build_test_config(backend_url)).expect("构建 AppState");
    let service_url = spawn_recommendation_server(app_state.clone()).await;
    let http = reqwest::Client::new();

    // 1. 先发送非法载荷（缺失 decisionId）验证 422 拒绝会被计入失败指标
    let invalid_resp = http
        .post(format!("{service_url}/recommendation/candidates"))
        .header("content-type", "application/json")
        .header("x-recommendation-internal-token", "test-internal-secret")
        .header("x-request-id", "req-invalid-422")
        .body(r#"{"requestId":"req-invalid-422"}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(invalid_resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    {
        let snapshot = app_state
            .metrics
            .lock()
            .await
            .build_summary("test", app_state.recent_store.snapshot());
        assert_eq!(snapshot.total_failures, 1);
        assert_eq!(snapshot.last_request_id.as_deref(), Some("req-invalid-422"));
    }

    // 2. 发送真实 Node createFeedQuery 形态请求（userFeatures 缺失 videoPreference/isSubscriber）
    let valid_payload = json!({
        "requestId": "req-primary-ok",
        "decisionId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "userId": "viewer-primary-1",
        "limit": 10,
        "inNetworkOnly": false,
        "seenIds": [],
        "servedIds": [],
        "isBottomRequest": false,
        "userFeatures": {
            "followedUserIds": ["author-100"],
            "blockedUserIds": [],
            "mutedUserIds": [],
            "mutedKeywords": [],
            "mutedTopicIds": [],
            "seenPostIds": [],
            "subscribedUserIds": []
        }
    });

    let resp = http
        .post(format!("{service_url}/recommendation/candidates"))
        .header("x-recommendation-internal-token", "test-internal-secret")
        .json(&valid_payload)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let result: RecommendationResultPayload = resp.json().await.expect("解码推荐响应");
    assert!(!result.candidates.is_empty());

    // 确认远端 Node /hydrate 仅收到了 3 个注册组件
    let seen = mock_state.hydrate_components_seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 1);
    assert_eq!(
        seen[0],
        REMOTE_CANDIDATE_HYDRATOR_NAMES
            .iter()
            .map(|s| (*s).to_string())
            .collect::<Vec<_>>()
    );

    // 确认本地 HasMediaCandidateHydrator 已执行并将 media 注解为 has_media=true, Photo
    assert!(result.candidates[0].has_media);
    assert_eq!(result.candidates[0].media_type, MediaType::Photo);
    assert!(
        result
            .summary
            .stages
            .iter()
            .any(|stage| stage.name == "HasMediaCandidateHydrator" && stage.enabled)
    );
}

#[tokio::test]
async fn tight_deadline_header_short_circuits_backend_callbacks() {
    let mock_state = MockNodeState::default();
    let backend_url = spawn_strict_mock_node_backend(mock_state.clone()).await;
    let app_state = build_app_state(build_test_config(backend_url)).expect("构建 AppState");
    let service_url = spawn_recommendation_server(app_state).await;
    let http = reqwest::Client::new();

    let expired_epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        + 50; // 剩余预算 < 150ms 触发快速短路

    let req_payload = json!({
        "requestId": "req-tight-deadline",
        "decisionId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "userId": "viewer-deadline-1",
        "limit": 10,
        "inNetworkOnly": false,
        "seenIds": [],
        "servedIds": [],
        "isBottomRequest": false
    });

    let resp = http
        .post(format!("{service_url}/recommendation/candidates"))
        .header("x-recommendation-internal-token", "test-internal-secret")
        .header(RECOMMENDATION_DEADLINE_HEADER, expired_epoch_ms.to_string())
        .json(&req_payload)
        .send()
        .await
        .unwrap();
    // QueryHydrator 在 <150ms 下立即短路触发 safety_context_unavailable 快速安全弃权返回，0 次后端召回调用
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(mock_state.source_batch_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn post_deleted_event_evicts_across_thunder_recent_serve_and_source_caches() {
    let mock_state = MockNodeState::default();
    let backend_url = spawn_strict_mock_node_backend(mock_state).await;
    let app_state = build_app_state(build_test_config(backend_url)).expect("构建 AppState");
    let service_url = spawn_recommendation_server(app_state.clone()).await;
    let http = reqwest::Client::new();

    let deleted_post_id = "post-from-FollowingSource";

    // 预先写入 ThunderStore 与 RecentHotStore
    app_state.thunder_store.upsert(LightPost {
        post_id: deleted_post_id.to_string(),
        author_id: "author-100".to_string(),
        content_preview: "待删除帖子".to_string(),
        created_at: Utc::now(),
        has_image: true,
        has_video: false,
        like_count: 1,
        comment_count: 0,
        repost_count: 0,
        view_count: 5,
        recall_source: "thunder".to_string(),
        conversation_id: None,
        is_reply: false,
        is_repost: false,
        original_post_id: None,
        topic_tags: Vec::new(),
    });
    app_state.recent_store.record(
        "author-100",
        &[RecommendationCandidatePayload {
            post_id: deleted_post_id.to_string(),
            author_id: "author-100".to_string(),
            content: "待删除热帖".to_string(),
            created_at: Utc::now(),
            media: Some(vec![CandidateMediaPayload {
                type_: "image".to_string(),
                url: "https://cdn.example.com/a.jpg".to_string(),
                thumbnail_url: None,
            }]),
            ..Default::default()
        }],
    );

    // 跑一次请求让 ServeCache 与 SourceCache 写入缓存
    let query_payload = json!({
        "requestId": "req-cache-seed",
        "decisionId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "userId": "viewer-evict-1",
        "limit": 10,
        "inNetworkOnly": false,
        "seenIds": [],
        "servedIds": [],
        "isBottomRequest": false
    });
    let first_resp = http
        .post(format!("{service_url}/recommendation/candidates"))
        .header("x-recommendation-internal-token", "test-internal-secret")
        .json(&query_payload)
        .send()
        .await
        .unwrap();
    assert_eq!(first_resp.status(), StatusCode::OK);

    // 模拟消费 recsys:events:v1 的 post.deleted 事件并执行全栈缓存驱逐
    let deleted_json = json!({
        "postId": deleted_post_id,
        "authorId": "author-100",
        "deletedAtMs": Utc::now().timestamp_millis()
    })
    .to_string();
    assert!(apply_recsys_stream_event_with_hook(
        &app_state.thunder_store,
        "post.deleted",
        &deleted_json,
        None,
    ));
    app_state
        .pipeline
        .evict_deleted_post(deleted_post_id, Some("author-100"))
        .await;

    // 断言 ThunderStore 墓碑已生效且 RecentHotStore 已清空该帖
    assert!(app_state.thunder_store.is_deleted(deleted_post_id));
    assert!(app_state.thunder_store.get(deleted_post_id).is_none());
    let probe_query = RecommendationQueryPayload {
        user_id: "another-viewer".to_string(),
        limit: 10,
        ..Default::default()
    };
    assert!(
        app_state
            .recent_store
            .recent_hot_candidates(&probe_query, &Default::default())
            .iter()
            .all(|c| c.post_id != deleted_post_id)
    );

    // 再次请求同一用户的推荐流：已删帖绝不能从 ServeCache / SourceCache / 回源结果中漏出
    let second_resp = http
        .post(format!("{service_url}/recommendation/candidates"))
        .header("x-recommendation-internal-token", "test-internal-secret")
        .json(&query_payload)
        .send()
        .await
        .unwrap();
    assert_eq!(second_resp.status(), StatusCode::OK);
    let second_result: RecommendationResultPayload =
        second_resp.json().await.expect("解码二次推荐响应");
    assert!(
        second_result
            .candidates
            .iter()
            .all(|candidate| candidate.post_id != deleted_post_id)
    );
}

#[tokio::test]
async fn graph_kernel_clients_inject_internal_token_header_when_configured() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("绑定测试图核监听端口");
    let addr = listener.local_addr().unwrap();
    let captured_headers = Arc::new(Mutex::new(Vec::<HashMap<String, String>>::new()));
    let captured_clone = Arc::clone(&captured_headers);

    tokio::spawn(async move {
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().await.expect("接收图核请求");
            let mut buf = vec![0_u8; 4096];
            let n = socket.read(&mut buf).await.unwrap_or(0);
            let raw = String::from_utf8_lossy(&buf[..n]);
            let mut map = HashMap::new();
            for line in raw.lines().skip(1) {
                if line.trim().is_empty() {
                    break;
                }
                if let Some((k, v)) = line.split_once(':') {
                    map.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
                }
            }
            captured_clone.lock().unwrap().push(map);

            let body = r#"{"success":true,"data":{"candidates":[]}}"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = socket.write_all(resp.as_bytes()).await;
        }
    });

    let base_url = format!("http://{addr}");
    let mut cfg = build_test_config("http://127.0.0.1:59999".to_string());
    cfg.graph_kernel_enabled = true;
    cfg.graph_kernel_url = base_url.clone();

    let kernel_client = GraphKernelClient::from_config(&cfg)
        .expect("启用 GraphKernelClient")
        .with_internal_token(Some("cpp-secret-token-2026".to_string()));
    let _ = kernel_client
        .social_neighbors("u1", 10, &[])
        .await
        .expect("GraphKernelClient 请求成功");

    let http_graph_client = HttpGraphClient::new(base_url, 1_000)
        .with_internal_token(Some("cpp-secret-token-2026".to_string()));
    let _ = http_graph_client
        .social_neighbors("u1", 10, &[])
        .await
        .expect("HttpGraphClient 请求成功");

    let recorded = captured_headers.lock().unwrap();
    assert_eq!(recorded.len(), 2);
    for headers in recorded.iter() {
        assert_eq!(
            headers
                .get(GRAPH_KERNEL_INTERNAL_TOKEN_HEADER)
                .map(String::as_str),
            Some("cpp-secret-token-2026")
        );
    }
}
