use std::time::Instant;

use chrono::Utc;
use serde::Serialize;
use serde_json::json;

use crate::realtime_contracts::{
    REALTIME_EVENT_SPEC_VERSION, RealtimeDeliveryTarget, RealtimeDeliveryTargetKind,
    RealtimeEventEnvelopeV1, RealtimeTopic,
};
use crate::session_registry::RealtimeSessionRegistry;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MetricRow {
    name: &'static str,
    iterations: usize,
    request_count: usize,
    batch_size: Option<usize>,
    queue_depth: Option<usize>,
    p50_us: u128,
    p95_us: u128,
    p99_us: u128,
    timeouts: usize,
    fallback: bool,
    budget_exhausted: bool,
    cache_hit: Option<usize>,
    cache_miss: Option<usize>,
    session_index_size: usize,
    resolved_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FixturePayload {
    schema_version: &'static str,
    service: &'static str,
    suite: &'static str,
    summary: MetricRow,
    results: Vec<MetricRow>,
}

pub fn run() -> anyhow::Result<()> {
    let iterations = read_usize_env("GATEWAY_PERF_ITERATIONS", 500);
    let sessions = read_usize_env("GATEWAY_PERF_SESSIONS", 10_000);
    let rooms = read_usize_env("GATEWAY_PERF_ROOMS", 10);
    let resolve_batch = read_usize_env("GATEWAY_PERF_RESOLVE_BATCH", 8);

    let mut registry = RealtimeSessionRegistry::default();
    let now = Utc::now().to_rfc3339();
    for index in 0..sessions {
        let session_id = format!("socket-{index}");
        let user_id = format!("user-{}", index % (sessions / 4).max(1));
        registry.apply_session_opened(&session_opened(&session_id, &user_id, &now));
        registry.apply_session_heartbeat(&session_heartbeat(
            &session_id,
            &user_id,
            &format!("group-{}", index % rooms.max(1)),
            &now,
        ));
    }

    let targets = (0..resolve_batch)
        .map(|index| RealtimeDeliveryTarget {
            kind: RealtimeDeliveryTargetKind::Room,
            id: Some(format!("room:group-{}", index % rooms.max(1))),
            exclude_socket_ids: Vec::new(),
        })
        .collect::<Vec<_>>();
    let mut samples = Vec::with_capacity(iterations);
    let mut resolved_count = 0usize;
    for _ in 0..iterations {
        let started = Instant::now();
        let resolved = targets
            .iter()
            .map(|target| registry.resolve_socket_targets(target, 120).len())
            .sum::<usize>();
        samples.push(started.elapsed().as_micros());
        resolved_count = resolved;
    }
    let snapshot = registry.snapshot(120);
    let row = MetricRow {
        name: "session_registry_room_resolve",
        iterations,
        request_count: iterations * resolve_batch,
        batch_size: Some(resolve_batch),
        queue_depth: Some(snapshot.totals.session_index_size),
        p50_us: percentile(&samples, 50),
        p95_us: percentile(&samples, 95),
        p99_us: percentile(&samples, 99),
        timeouts: 0,
        fallback: false,
        budget_exhausted: false,
        cache_hit: None,
        cache_miss: None,
        session_index_size: snapshot.totals.session_index_size,
        resolved_count,
    };

    let payload = FixturePayload {
        schema_version: "telegram_perf_fixture_v1",
        service: "rust_gateway",
        suite: "realtime_session_registry_local_hot_path",
        summary: row.clone(),
        results: vec![row],
    };
    println!("{}", serde_json::to_string_pretty(&payload)?);
    Ok(())
}

fn session_opened(session_id: &str, user_id: &str, emitted_at: &str) -> RealtimeEventEnvelopeV1 {
    RealtimeEventEnvelopeV1 {
        spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
        event_id: format!("evt-open-{session_id}"),
        topic: RealtimeTopic::SessionOpened,
        emitted_at: emitted_at.to_string(),
        partition_key: user_id.to_string(),
        trace_id: format!("trace-{session_id}"),
        source: "perf_fixture".to_string(),
        session_id: session_id.to_string(),
        user_id: Some(user_id.to_string()),
        chat_id: None,
        payload: json!({ "connectedAt": emitted_at }),
    }
}

fn session_heartbeat(
    session_id: &str,
    user_id: &str,
    room_id: &str,
    emitted_at: &str,
) -> RealtimeEventEnvelopeV1 {
    RealtimeEventEnvelopeV1 {
        spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
        event_id: format!("evt-heartbeat-{session_id}"),
        topic: RealtimeTopic::SessionHeartbeat,
        emitted_at: emitted_at.to_string(),
        partition_key: user_id.to_string(),
        trace_id: format!("trace-{session_id}"),
        source: "perf_fixture".to_string(),
        session_id: session_id.to_string(),
        user_id: Some(user_id.to_string()),
        chat_id: None,
        payload: json!({
            "activity": "room_joined",
            "roomId": room_id,
        }),
    }
}

fn percentile(values: &[u128], pct: usize) -> u128 {
    if values.is_empty() {
        return 0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let index = ((sorted.len() - 1) * pct.min(100)) / 100;
    sorted[index]
}

fn read_usize_env(key: &str, default: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(default)
}
