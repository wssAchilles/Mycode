use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use chrono::Utc;
use serde_json::json;

use telegram_rust_gateway::{
    config::{GatewayConfig, GatewayRealtimeRolloutStage, GatewayRealtimeSocketTerminator},
    control_plane::RuntimeControlPlane,
    fanout_bridge::FanoutBridge,
    ingress_audit::IngressAuditTrail,
    presence_router::PresenceRouter,
    rate_limit::RateLimiter,
    realtime::{
        realtime_contracts::{
            REALTIME_EVENT_SPEC_VERSION, RealtimeDeliveryTarget, RealtimeDeliveryTargetKind,
            RealtimeEventEnvelopeV1, RealtimeTopic,
        },
        socket::state::RustSocketSessionStore,
        state::{
            session_registry::RealtimeSessionRegistry, SessionRegistryBackend,
        },
    },
    realtime_consumer::apply_ingress_envelope,
    realtime_ops::RealtimeOpsState,
    state::AppState,
};

fn create_test_state(terminator: GatewayRealtimeSocketTerminator) -> AppState {
    AppState {
        config: GatewayConfig {
            bind_addr: SocketAddr::from((Ipv4Addr::LOCALHOST, 4000)),
            upstream_http: "http://backend:5000".to_string(),
            ops_token: None,
            jwt_secret: Some("secret".to_string()),
            validate_access_tokens: true,
            trust_x_forwarded_for: true,
            rate_limit_capacity: 120.0,
            rate_limit_refill_per_sec: 2.0,
            request_timeout_secs: 30,
            sync_request_timeout_secs: 45,
            cors_extra_origins: vec![],
            realtime_redis_url: "redis://redis:6379/0".to_string(),
            realtime_stream_key: "realtime:ingress:v1".to_string(),
            realtime_delivery_stream_key: "realtime:delivery:v1".to_string(),
            realtime_dlq_stream_key: "realtime:dlq:v1".to_string(),
            realtime_consumer_group: "gateway-realtime-boundary".to_string(),
            realtime_consumer_name: "gateway-realtime-consumer".to_string(),
            realtime_delivery_consumer_group: "gateway-realtime-delivery".to_string(),
            realtime_delivery_consumer_name: "gateway-realtime-delivery-consumer".to_string(),
            realtime_compat_dispatch_channel: "realtime:compat:dispatch:v1".to_string(),
            realtime_rollout_stage: GatewayRealtimeRolloutStage::RustEdgePrimary,
            realtime_socket_terminator: terminator,
            realtime_heartbeat_stale_secs: 120,
            realtime_session_lease_ttl_secs: 100,
        },
        client: reqwest::Client::new(),
        limiter: RateLimiter::new(120.0, 2.0),
        control_plane: Arc::new(Mutex::new(RuntimeControlPlane::new())),
        ingress_audit: Arc::new(Mutex::new(IngressAuditTrail::new())),
        jwt_validator: None,
        session_registry: SessionRegistryBackend::InMemory(Arc::new(tokio::sync::Mutex::new(
            RealtimeSessionRegistry::default(),
        ))),
        realtime_presence: Arc::new(Mutex::new(PresenceRouter::default())),
        realtime_ops: Arc::new(Mutex::new(RealtimeOpsState::default())),
        realtime_fanout_bridge: Arc::new(Mutex::new(FanoutBridge::default())),
        realtime_socket_state: Arc::new(Mutex::new(RustSocketSessionStore::default())),
        realtime_socket_io: None,
    }
}

/// 契约测试 1: 验证 Socket 连接与认证事件确切写入 SessionRegistry（防止未 await 导致事件丢失）
#[tokio::test]
async fn test_socket_ingress_event_pipeline_integrity() {
    let state = create_test_state(GatewayRealtimeSocketTerminator::Rust);
    let session_id = "test-session-1001";
    let user_id = "user-alice-42";
    let now = Utc::now().to_rfc3339();

    // 1. 发送 SessionOpened 事件
    let opened_event = RealtimeEventEnvelopeV1 {
        spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
        event_id: "evt-1".to_string(),
        topic: RealtimeTopic::SessionOpened,
        emitted_at: now.clone(),
        partition_key: session_id.to_string(),
        trace_id: "trace-1".to_string(),
        source: "rust_socket".to_string(),
        session_id: session_id.to_string(),
        user_id: None,
        chat_id: None,
        payload: json!({ "transport": "socket_io_compat" }),
    };
    apply_ingress_envelope(&state, &opened_event).await;

    // 2. 发送 SessionHeartbeat (认证成功并绑定用户)
    let auth_heartbeat_event = RealtimeEventEnvelopeV1 {
        spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
        event_id: "evt-2".to_string(),
        topic: RealtimeTopic::SessionHeartbeat,
        emitted_at: now.clone(),
        partition_key: session_id.to_string(),
        trace_id: "trace-2".to_string(),
        source: "rust_socket".to_string(),
        session_id: session_id.to_string(),
        user_id: Some(user_id.to_string()),
        chat_id: None,
        payload: json!({
            "activity": "authenticate_success",
            "status": "online"
        }),
    };
    apply_ingress_envelope(&state, &auth_heartbeat_event).await;

    // 3. 验证 SessionRegistry 中能够依据 user_id 精准解析出 session_id
    let target = RealtimeDeliveryTarget {
        kind: RealtimeDeliveryTargetKind::User,
        id: Some(user_id.to_string()),
        exclude_socket_ids: vec![],
    };
    let targets = state
        .session_registry
        .resolve_socket_targets(&target, 120)
        .await;

    assert_eq!(
        targets,
        vec![session_id.to_string()],
        "认证事件处理后必须能通过 user_id 寻址到 session_id，证明 Ingress 管道执行完整"
    );
}

/// 契约测试 2: 验证房间订阅（join/leave）在心跳与 Ingress 事件中维护索引
#[tokio::test]
async fn test_socket_room_subscription_and_leave_indexing() {
    let state = create_test_state(GatewayRealtimeSocketTerminator::Rust);
    let session_id = "test-session-2002";
    let user_id = "user-bob-99";
    let room_id = "group:tech-channel";
    let now = Utc::now().to_rfc3339();

    // 1. 初始化并加入房间
    let join_event = RealtimeEventEnvelopeV1 {
        spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
        event_id: "evt-join".to_string(),
        topic: RealtimeTopic::SessionHeartbeat,
        emitted_at: now.clone(),
        partition_key: session_id.to_string(),
        trace_id: "trace-join".to_string(),
        source: "rust_socket".to_string(),
        session_id: session_id.to_string(),
        user_id: Some(user_id.to_string()),
        chat_id: None,
        payload: json!({
            "activity": "room_joined",
            "roomId": room_id
        }),
    };
    apply_ingress_envelope(&state, &join_event).await;

    // 验证房间目标解析
    let room_target = RealtimeDeliveryTarget {
        kind: RealtimeDeliveryTargetKind::Room,
        id: Some(room_id.to_string()),
        exclude_socket_ids: vec![],
    };
    let room_targets = state
        .session_registry
        .resolve_socket_targets(&room_target, 120)
        .await;
    assert_eq!(room_targets, vec![session_id.to_string()]);

    // 2. 离开房间
    let leave_event = RealtimeEventEnvelopeV1 {
        spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
        event_id: "evt-leave".to_string(),
        topic: RealtimeTopic::SessionHeartbeat,
        emitted_at: Utc::now().to_rfc3339(),
        partition_key: session_id.to_string(),
        trace_id: "trace-leave".to_string(),
        source: "rust_socket".to_string(),
        session_id: session_id.to_string(),
        user_id: Some(user_id.to_string()),
        chat_id: None,
        payload: json!({
            "activity": "room_left",
            "roomId": room_id
        }),
    };
    apply_ingress_envelope(&state, &leave_event).await;

    // 验证离开后解析为空
    let empty_targets = state
        .session_registry
        .resolve_socket_targets(&room_target, 120)
        .await;
    assert!(empty_targets.is_empty(), "离开房间后必须不再出现在 room_targets 中");
}

/// 契约测试 3: 验证 2B 模式下配置与终止者语义
#[test]
fn test_config_terminator_contract_for_2b_phase() {
    let config = GatewayConfig {
        bind_addr: SocketAddr::from((Ipv4Addr::LOCALHOST, 4000)),
        upstream_http: "http://backend:5000".to_string(),
        ops_token: None,
        jwt_secret: Some("secret".to_string()),
        validate_access_tokens: true,
        trust_x_forwarded_for: true,
        rate_limit_capacity: 120.0,
        rate_limit_refill_per_sec: 2.0,
        request_timeout_secs: 30,
        sync_request_timeout_secs: 45,
        cors_extra_origins: vec![],
        realtime_redis_url: "redis://redis:6379/0".to_string(),
        realtime_stream_key: "realtime:ingress:v1".to_string(),
        realtime_delivery_stream_key: "realtime:delivery:v1".to_string(),
        realtime_dlq_stream_key: "realtime:dlq:v1".to_string(),
        realtime_consumer_group: "gateway-realtime-boundary".to_string(),
        realtime_consumer_name: "gateway-realtime-consumer".to_string(),
        realtime_delivery_consumer_group: "gateway-realtime-delivery".to_string(),
        realtime_delivery_consumer_name: "gateway-realtime-delivery-consumer".to_string(),
        realtime_compat_dispatch_channel: "realtime:compat:dispatch:v1".to_string(),
        realtime_rollout_stage: GatewayRealtimeRolloutStage::RustEdgePrimary,
        realtime_socket_terminator: GatewayRealtimeSocketTerminator::Rust,
        realtime_heartbeat_stale_secs: 120,
        realtime_session_lease_ttl_secs: 100,
    };

    assert_eq!(config.realtime_socket_terminator_owner(), "rust");
    assert_eq!(config.realtime_session_lease_ttl_secs, 100);
}

/// 契约测试 4: 验证 RedisSessionRegistry 租约 TTL 构造完整性
#[test]
fn test_redis_session_registry_lease_ttl_configured() {
    let client = redis::Client::open("redis://127.0.0.1:6379/0").unwrap();
    let registry = telegram_rust_gateway::realtime::state::redis_session_registry::RedisSessionRegistry::new(
        client,
        "gateway-test".to_string(),
        100,
    );
    // 确保通过编译且类型匹配
    let _backend = telegram_rust_gateway::realtime::state::SessionRegistryBackend::Redis(registry);
}

