use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;

use axum::{
    Router,
    body::Body,
    extract::Request,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::Response,
    routing::{any, get},
};
use chrono::{Duration as ChronoDuration, Utc};
use hyper_util::rt::TokioIo;
use serde_json::json;
use telegram_rust_gateway::{
    bootstrap::{mark_gateway_online, seed_control_plane},
    build_router,
    config::{GatewayConfig, GatewayRealtimeRolloutStage, GatewayRealtimeSocketTerminator},
    control_plane::RuntimeControlPlane,
    fanout_bridge::FanoutBridge,
    ingress_audit::IngressAuditTrail,
    jwt::JwtPrevalidator,
    presence_router::PresenceRouter,
    probes::prime_dependency_probes,
    rate_limit::RateLimiter,
    realtime::{
        realtime_contracts::{
            REALTIME_EVENT_SPEC_VERSION, RealtimeDeliveryTarget, RealtimeDeliveryTargetKind,
            RealtimeEventEnvelopeV1, RealtimeTopic,
        },
        socket::state::RustSocketSessionStore,
        state::{
            SessionRegistryBackend, lease_renewer::renew_local_active_sessions,
            redis_session_registry::RedisSessionRegistry,
            session_registry::RealtimeSessionRegistry,
        },
    },
    realtime_consumer::apply_ingress_envelope,
    realtime_ops::RealtimeOpsState,
    state::AppState,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

const TEST_JWT_SECRET: &str = "0123456789abcdef0123456789abcdef";

fn build_gateway_state(upstream_http: String, ops_token: Option<String>) -> AppState {
    let config = GatewayConfig {
        bind_addr: SocketAddr::from((Ipv4Addr::LOCALHOST, 0)),
        upstream_http,
        ops_token,
        jwt_secret: Some(TEST_JWT_SECRET.to_string()),
        validate_access_tokens: true,
        trust_x_forwarded_for: true,
        rate_limit_capacity: 120.0,
        rate_limit_refill_per_sec: 2.0,
        request_timeout_secs: 2,
        sync_request_timeout_secs: 65,
        cors_extra_origins: Vec::new(),
        realtime_redis_url: "redis://127.0.0.1:6379/0".to_string(),
        realtime_stream_key: "realtime:ingress:v1".to_string(),
        realtime_delivery_stream_key: "realtime:delivery:v1".to_string(),
        realtime_dlq_stream_key: "realtime:dlq:v1".to_string(),
        realtime_consumer_group: "gateway-realtime-boundary".to_string(),
        realtime_consumer_name: "gateway-realtime-consumer".to_string(),
        realtime_delivery_consumer_group: "gateway-realtime-delivery".to_string(),
        realtime_delivery_consumer_name: "gateway-realtime-delivery-consumer".to_string(),
        realtime_compat_dispatch_channel: "realtime:compat:dispatch:v1".to_string(),
        realtime_rollout_stage: GatewayRealtimeRolloutStage::CompatPrimary,
        realtime_socket_terminator: GatewayRealtimeSocketTerminator::Node,
        realtime_heartbeat_stale_secs: 120,
        realtime_session_lease_ttl_secs: 100,
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(config.request_timeout_secs))
        .pool_idle_timeout(Duration::from_secs(4))
        .build()
        .expect("build reqwest client");

    let mut plane = RuntimeControlPlane::new();
    seed_control_plane(&mut plane, &config);

    AppState {
        jwt_validator: Some(JwtPrevalidator::new(TEST_JWT_SECRET)),
        limiter: RateLimiter::new(config.rate_limit_capacity, config.rate_limit_refill_per_sec),
        client,
        control_plane: Arc::new(Mutex::new(plane)),
        ingress_audit: Arc::new(Mutex::new(IngressAuditTrail::new())),
        session_registry: SessionRegistryBackend::InMemory(Arc::new(tokio::sync::Mutex::new(
            RealtimeSessionRegistry::default(),
        ))),
        realtime_presence: Arc::new(Mutex::new(PresenceRouter::default())),
        realtime_ops: Arc::new(Mutex::new(RealtimeOpsState::default())),
        realtime_fanout_bridge: Arc::new(Mutex::new(FanoutBridge::default())),
        realtime_socket_state: Arc::new(Mutex::new(RustSocketSessionStore::default())),
        realtime_socket_io: None,
        config,
    }
}

async fn spawn_gateway(state: AppState) -> SocketAddr {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind gateway listener");
    let addr = listener.local_addr().expect("gateway local addr");
    mark_gateway_online(&state);
    let app = build_router(state, None);
    tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await;
    });
    addr
}

/// 端到端契约测试 1：阻断 `/internal/*` 与 `/ready`、拦截原始 TCP `..` 绕过、以及 `/gateway/ops/*` 缺省 Fail-Closed
#[tokio::test]
async fn blocks_internal_endpoints_and_prevents_dotdot_policy_bypass() {
    let upstream_hits = Arc::new(AtomicUsize::new(0));
    let hits_clone = upstream_hits.clone();

    let upstream_app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .fallback(any(move || {
            let hits = hits_clone.clone();
            async move {
                hits.fetch_add(1, Ordering::SeqCst);
                "unexpected upstream hit"
            }
        }));
    let upstream_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind upstream");
    let upstream_addr = upstream_listener.local_addr().expect("upstream addr");
    tokio::spawn(async move {
        let _ = axum::serve(upstream_listener, upstream_app).await;
    });

    let state = build_gateway_state(format!("http://{upstream_addr}"), None);
    let gw_addr = spawn_gateway(state).await;
    let client = reqwest::Client::new();

    // 1. 外部访问 /internal/* 与 /ready 必须在边缘网关层直接被 403 拦截，绝不触达上游
    let res_internal = client
        .get(format!("http://{gw_addr}/internal/recommendation/health"))
        .send()
        .await
        .expect("request /internal");
    assert_eq!(res_internal.status(), StatusCode::FORBIDDEN);

    let res_ready = client
        .get(format!("http://{gw_addr}/ready"))
        .send()
        .await
        .expect("request /ready");
    assert_eq!(res_ready.status(), StatusCode::FORBIDDEN);

    // 2. 未配置 ops_token 时访问 /gateway/ops/* 必须 Fail-Closed 返回 401
    let res_ops = client
        .get(format!(
            "http://{gw_addr}/gateway/ops/control-plane/summary"
        ))
        .send()
        .await
        .expect("request /gateway/ops");
    assert_eq!(res_ops.status(), StatusCode::UNAUTHORIZED);

    // 3. 使用原始 TCP 模拟 `curl --path-as-is /gateway/ops/../../api/messages/send` 携带非法 Bearer Token
    let mut stream = TcpStream::connect(gw_addr).await.expect("connect raw tcp");
    stream
        .write_all(
            b"GET /gateway/ops/../../api/messages/send HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer forged-invalid-jwt\r\nConnection: close\r\n\r\n",
        )
        .await
        .expect("write raw request");
    let mut raw_resp = String::new();
    stream
        .read_to_string(&mut raw_resp)
        .await
        .expect("read raw response");
    assert!(
        raw_resp.starts_with("HTTP/1.1 401"),
        "路径折叠后必须命中 DefaultApi 预检并返回 401，实际响应: {raw_resp}"
    );

    // 4. 试图向上越出根路径 `/../../etc/passwd` 必须返回 400 BAD_REQUEST
    let mut traversal_stream = TcpStream::connect(gw_addr).await.expect("connect raw tcp");
    traversal_stream
        .write_all(
            b"GET /../../etc/passwd HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .await
        .expect("write traversal request");
    let mut traversal_resp = String::new();
    traversal_stream
        .read_to_string(&mut traversal_resp)
        .await
        .expect("read traversal response");
    assert!(
        traversal_resp.starts_with("HTTP/1.1 400"),
        "越出根路径必须返回 400，实际响应: {traversal_resp}"
    );

    assert_eq!(
        upstream_hits.load(Ordering::SeqCst),
        0,
        "所有被网关阻断或预检拦截的请求均不得穿透至上游"
    );
}

/// 端到端契约测试 2：剥离内部特权头、取最右 XFF、消除 `x-request-id` 与 `x-chat-trace-id` 重复响应头、以及单请求超时不污染 `/health`
#[tokio::test]
async fn sanitizes_headers_extracts_rightmost_xff_deduplicates_response_headers_and_preserves_health()
 {
    let captured_headers: Arc<Mutex<Option<HeaderMap>>> = Arc::new(Mutex::new(None));
    let captured_clone = captured_headers.clone();

    let upstream_app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route(
            "/api/public/echo",
            get(move |req: Request| {
                let store = captured_clone.clone();
                async move {
                    *store.lock().expect("lock captured headers") = Some(req.headers().clone());
                    let mut resp = Response::new(Body::from("ok"));
                    // 模拟上游 Node requestTrace 回显同名追踪头
                    resp.headers_mut()
                        .append("x-request-id", HeaderValue::from_static("req-live-001"));
                    resp.headers_mut().append(
                        "x-chat-trace-id",
                        HeaderValue::from_static("cw-live-trace-001, cw-live-trace-001"),
                    );
                    resp
                }
            }),
        )
        .route(
            "/api/public/slow",
            get(|| async {
                tokio::time::sleep(Duration::from_secs(4)).await;
                "too slow"
            }),
        );

    let upstream_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind upstream");
    let upstream_addr = upstream_listener.local_addr().expect("upstream addr");
    tokio::spawn(async move {
        let _ = axum::serve(upstream_listener, upstream_app).await;
    });

    let state = build_gateway_state(
        format!("http://{upstream_addr}"),
        Some("ops-token-1".to_string()),
    );
    prime_dependency_probes(&state).await;
    let gw_addr = spawn_gateway(state).await;
    let client = reqwest::Client::new();

    let res = client
        .get(format!("http://{gw_addr}/api/public/echo"))
        .header("x-recommendation-internal-token", "spoofed-rec")
        .header("x-graph-kernel-internal-token", "spoofed-graph")
        .header("x-cron-secret", "spoofed-cron")
        .header("x-internal-token", "spoofed-internal")
        .header("x-ops-token", "legit-ops-token")
        .header("x-forwarded-for", "198.51.100.88, 203.0.113.9")
        .header("x-request-id", "req-live-001")
        .header("x-chat-trace-id", "cw-live-trace-001")
        .send()
        .await
        .expect("send echo request");

    assert_eq!(res.status(), StatusCode::OK);
    let resp_headers = res.headers();

    // 验证响应头唯一出现 1 次且不含重复逗号拼接
    assert_eq!(resp_headers.get_all("x-request-id").iter().count(), 1);
    assert_eq!(
        resp_headers.get("x-request-id").unwrap().to_str().unwrap(),
        "req-live-001"
    );
    assert_eq!(resp_headers.get_all("x-chat-trace-id").iter().count(), 1);
    assert_eq!(
        resp_headers
            .get("x-chat-trace-id")
            .unwrap()
            .to_str()
            .unwrap(),
        "cw-live-trace-001"
    );
    assert_eq!(resp_headers.get_all("x-gateway-ingress").iter().count(), 1);

    // 验证上游收到的请求头已剥离内部特权头并正确采用最右侧 XFF IP
    let upstream_seen = captured_headers
        .lock()
        .expect("lock captured")
        .clone()
        .expect("captured headers present");
    assert!(!upstream_seen.contains_key("x-recommendation-internal-token"));
    assert!(!upstream_seen.contains_key("x-graph-kernel-internal-token"));
    assert!(!upstream_seen.contains_key("x-cron-secret"));
    assert!(!upstream_seen.contains_key("x-internal-token"));
    assert_eq!(
        upstream_seen.get("x-ops-token").unwrap().to_str().unwrap(),
        "legit-ops-token"
    );
    assert_eq!(
        upstream_seen.get("x-real-ip").unwrap().to_str().unwrap(),
        "203.0.113.9"
    );
    assert_eq!(upstream_seen.get_all("x-request-id").iter().count(), 1);
    assert_eq!(upstream_seen.get_all("x-chat-trace-id").iter().count(), 1);

    // 触发单次慢请求代理超时（502），验证不会将全局 `/health` 污染为 503
    let slow_res = client
        .get(format!("http://{gw_addr}/api/public/slow"))
        .send()
        .await
        .expect("send slow request");
    assert_eq!(slow_res.status(), StatusCode::BAD_GATEWAY);

    let health_res = client
        .get(format!("http://{gw_addr}/health"))
        .send()
        .await
        .expect("send health request");
    assert_eq!(
        health_res.status(),
        StatusCode::OK,
        "单次代理超时不得将网关全局 /health 污染为不健康"
    );
}

/// 端到端契约测试 3：验证 `socketTerminator=node` 下 `/socket.io/` WebSocket `101 Switching Protocols` 双向字节流透传
#[tokio::test]
async fn proxies_websocket_101_upgrade_bidirectionally_in_node_terminator_mode() {
    let upstream_app = Router::new().route(
        "/socket.io/",
        get(|mut req: Request| async move {
            let upgrade_hdr = req
                .headers()
                .get(header::UPGRADE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            assert!(
                upgrade_hdr.eq_ignore_ascii_case("websocket"),
                "上游必须收到保留的 Upgrade: websocket 头"
            );

            let on_upgrade = hyper::upgrade::on(&mut req);
            tokio::spawn(async move {
                if let Ok(upgraded) = on_upgrade.await {
                    let mut io = TokioIo::new(upgraded);
                    let mut buf = [0u8; 64];
                    if let Ok(n) = io.read(&mut buf).await
                        && n > 0
                    {
                        let mut reply = b"echo:".to_vec();
                        reply.extend_from_slice(&buf[..n]);
                        let _ = io.write_all(&reply).await;
                        let _ = io.flush().await;
                    }
                }
            });

            Response::builder()
                .status(StatusCode::SWITCHING_PROTOCOLS)
                .header(header::CONNECTION, "Upgrade")
                .header(header::UPGRADE, "websocket")
                .header("sec-websocket-accept", "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
                .body(Body::empty())
                .expect("build 101 response")
        }),
    );

    let upstream_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind ws upstream");
    let upstream_addr = upstream_listener.local_addr().expect("ws upstream addr");
    tokio::spawn(async move {
        let _ = axum::serve(upstream_listener, upstream_app).await;
    });

    let state = build_gateway_state(format!("http://{upstream_addr}"), None);
    let gw_addr = spawn_gateway(state).await;

    let tcp = TcpStream::connect(gw_addr).await.expect("connect gateway");
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(tcp))
        .await
        .expect("client handshake");
    tokio::spawn(async move {
        let _ = conn.with_upgrades().await;
    });

    let req = http::Request::builder()
        .method("GET")
        .uri("/socket.io/?EIO=4&transport=websocket")
        .header(header::HOST, "localhost")
        .header(header::CONNECTION, "Upgrade")
        .header(header::UPGRADE, "websocket")
        .header("sec-websocket-version", "13")
        .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
        .body(http_body_util::Empty::<bytes::Bytes>::new())
        .expect("build upgrade req");

    let mut res = sender.send_request(req).await.expect("send upgrade req");
    assert_eq!(res.status(), StatusCode::SWITCHING_PROTOCOLS);
    assert_eq!(
        res.headers()
            .get(header::UPGRADE)
            .and_then(|v| v.to_str().ok()),
        Some("websocket")
    );
    assert_eq!(
        res.headers()
            .get("sec-websocket-accept")
            .and_then(|v| v.to_str().ok()),
        Some("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
    );

    let upgraded = hyper::upgrade::on(&mut res).await.expect("client upgraded");
    let mut client_io = TokioIo::new(upgraded);
    client_io
        .write_all(b"socket-io-frame")
        .await
        .expect("write ws frame");
    client_io.flush().await.expect("flush ws frame");

    let mut reply_buf = [0u8; 64];
    let n = client_io
        .read(&mut reply_buf)
        .await
        .expect("read echoed frame");
    assert_eq!(&reply_buf[..n], b"echo:socket-io-frame");
}

/// 端到端契约测试 4：验证 `room_key` 归一化与活跃事件/后台续租防止会话过期蒸发
#[tokio::test]
async fn normalizes_room_keys_and_renews_session_leases_on_activity_and_background_tick() {
    assert_eq!(
        RedisSessionRegistry::room_key("room:group-uuid-1"),
        "rt:room:group-uuid-1"
    );
    assert_eq!(
        RedisSessionRegistry::room_key("group-uuid-1"),
        "rt:room:group-uuid-1"
    );

    let state = build_gateway_state("http://127.0.0.1:59999".to_string(), None);
    let session_id = "sid-lease-1";
    let user_id = "user-lease-1";
    let past = (Utc::now() - ChronoDuration::seconds(200)).to_rfc3339();

    // 写入一条初始时间戳已超过 120s 阈值的旧会话与房间订阅
    apply_ingress_envelope(
        &state,
        &RealtimeEventEnvelopeV1 {
            spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
            event_id: "evt-old-open".to_string(),
            topic: RealtimeTopic::SessionOpened,
            emitted_at: past.clone(),
            partition_key: session_id.to_string(),
            trace_id: "trace-open".to_string(),
            source: "rust_socket_io_compat".to_string(),
            session_id: session_id.to_string(),
            user_id: Some(user_id.to_string()),
            chat_id: None,
            payload: json!({}),
        },
    )
    .await;
    apply_ingress_envelope(
        &state,
        &RealtimeEventEnvelopeV1 {
            spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
            event_id: "evt-old-join".to_string(),
            topic: RealtimeTopic::SessionHeartbeat,
            emitted_at: past,
            partition_key: session_id.to_string(),
            trace_id: "trace-join".to_string(),
            source: "rust_socket_io_compat".to_string(),
            session_id: session_id.to_string(),
            user_id: Some(user_id.to_string()),
            chat_id: None,
            payload: json!({ "activity": "room_joined", "roomId": "room:group-live-1" }),
        },
    )
    .await;

    let room_target = RealtimeDeliveryTarget {
        kind: RealtimeDeliveryTargetKind::Room,
        id: Some("group-live-1".to_string()),
        exclude_socket_ids: Vec::new(),
    };
    assert!(
        state
            .session_registry
            .resolve_socket_targets(&room_target, 120)
            .await
            .is_empty(),
        "续期前超时会话应被视为 stale"
    );

    // 1. 发送活跃业务事件（如 sendMessage 对应的 MessageCommandRequested）应立即续期激活会话
    apply_ingress_envelope(
        &state,
        &RealtimeEventEnvelopeV1 {
            spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
            event_id: "evt-msg-active".to_string(),
            topic: RealtimeTopic::MessageCommandRequested,
            emitted_at: Utc::now().to_rfc3339(),
            partition_key: session_id.to_string(),
            trace_id: "trace-msg".to_string(),
            source: "rust_socket_io_compat".to_string(),
            session_id: session_id.to_string(),
            user_id: Some(user_id.to_string()),
            chat_id: Some("g:group-live-1".to_string()),
            payload: json!({ "chatType": "group" }),
        },
    )
    .await;

    assert_eq!(
        state
            .session_registry
            .resolve_socket_targets(&room_target, 120)
            .await,
        vec![session_id.to_string()],
        "活跃业务事件必须刷新会话心跳使裸 groupId 投递重新命中"
    );

    // 2. 验证后台周期续租函数 `renew_local_active_sessions` 能同步本机 Socket 状态至注册表
    {
        let mut socket_store = state
            .realtime_socket_state
            .lock()
            .expect("lock socket store");
        socket_store.authenticate(
            "sid-bg-2",
            "user-bg-2",
            "bob",
            "token-bg",
            &["group-live-1".to_string()],
        );
    }
    renew_local_active_sessions(&state).await;

    let resolved_after_bg = state
        .session_registry
        .resolve_socket_targets(&room_target, 120)
        .await;
    assert!(resolved_after_bg.contains(&"sid-bg-2".to_string()));
}
