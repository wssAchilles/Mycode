use std::{
    collections::{BTreeMap, VecDeque},
    net::IpAddr,
};

use chrono::Utc;
use serde::Serialize;

use crate::traffic_policy::TrafficClass;

const MAX_RECENT_EVENTS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IngressEventKind {
    Proxied,
    RateLimited,
    Unauthorized,
    UpstreamUnavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngressEvent {
    pub at: String,
    pub request_id: String,
    pub chat_trace_id: Option<String>,
    pub client_ip: String,
    pub method: String,
    pub path: String,
    pub route_class: TrafficClass,
    pub kind: IngressEventKind,
    pub status_code: Option<u16>,
    pub latency_ms: u64,
    pub detail: Option<String>,
}

#[derive(Debug, Clone)]
pub struct IngressEventInput {
    pub request_id: String,
    pub chat_trace_id: Option<String>,
    pub client_ip: IpAddr,
    pub method: String,
    pub path: String,
    pub route_class: TrafficClass,
    pub kind: IngressEventKind,
    pub status_code: Option<u16>,
    pub latency_ms: u64,
    pub detail: Option<String>,
}

#[derive(Debug, Default, Clone)]
struct RouteTrafficState {
    total_requests: u64,
    proxied_requests: u64,
    rate_limited_requests: u64,
    unauthorized_requests: u64,
    upstream_unavailable_requests: u64,
    cumulative_latency_ms: u64,
    max_latency_ms: u64,
    last_status_code: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteTrafficSummary {
    pub route_class: TrafficClass,
    pub total_requests: u64,
    pub proxied_requests: u64,
    pub rate_limited_requests: u64,
    pub unauthorized_requests: u64,
    pub upstream_unavailable_requests: u64,
    pub avg_latency_ms: u64,
    pub max_latency_ms: u64,
    pub last_status_code: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngressTotals {
    pub total_requests: u64,
    pub proxied_requests: u64,
    pub rate_limited_requests: u64,
    pub unauthorized_requests: u64,
    pub upstream_unavailable_requests: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngressAuditSnapshot {
    pub generated_at: String,
    pub totals: IngressTotals,
    pub routes: Vec<RouteTrafficSummary>,
    pub recent_events: Vec<IngressEvent>,
}

#[derive(Debug, Default)]
pub struct IngressAuditTrail {
    recent_events: VecDeque<IngressEvent>,
    routes: BTreeMap<String, RouteTrafficState>,
}

impl IngressAuditTrail {
    pub fn new() -> Self {
        Self {
            recent_events: VecDeque::with_capacity(MAX_RECENT_EVENTS),
            routes: BTreeMap::new(),
        }
    }

    pub fn record(&mut self, input: IngressEventInput) {
        let event = IngressEvent {
            at: now_iso(),
            request_id: input.request_id,
            chat_trace_id: input.chat_trace_id,
            client_ip: input.client_ip.to_string(),
            method: input.method,
            path: input.path,
            route_class: input.route_class,
            kind: input.kind,
            status_code: input.status_code,
            latency_ms: input.latency_ms,
            detail: input.detail,
        };

        if self.recent_events.len() == MAX_RECENT_EVENTS {
            self.recent_events.pop_front();
        }
        self.recent_events.push_back(event.clone());

        let route_state = self
            .routes
            .entry(event.route_class.as_str().to_string())
            .or_default();
        route_state.total_requests += 1;
        route_state.cumulative_latency_ms += event.latency_ms;
        route_state.max_latency_ms = route_state.max_latency_ms.max(event.latency_ms);
        route_state.last_status_code = event.status_code;

        match event.kind {
            IngressEventKind::Proxied => route_state.proxied_requests += 1,
            IngressEventKind::RateLimited => route_state.rate_limited_requests += 1,
            IngressEventKind::Unauthorized => route_state.unauthorized_requests += 1,
            IngressEventKind::UpstreamUnavailable => route_state.upstream_unavailable_requests += 1,
        }
    }

    pub fn snapshot(&self) -> IngressAuditSnapshot {
        let mut totals = IngressTotals {
            total_requests: 0,
            proxied_requests: 0,
            rate_limited_requests: 0,
            unauthorized_requests: 0,
            upstream_unavailable_requests: 0,
        };

        let routes = self
            .routes
            .iter()
            .filter_map(|(route_key, state)| {
                let route_class = TrafficClass::from_key(route_key)?;
                totals.total_requests += state.total_requests;
                totals.proxied_requests += state.proxied_requests;
                totals.rate_limited_requests += state.rate_limited_requests;
                totals.unauthorized_requests += state.unauthorized_requests;
                totals.upstream_unavailable_requests += state.upstream_unavailable_requests;

                Some(RouteTrafficSummary {
                    route_class,
                    total_requests: state.total_requests,
                    proxied_requests: state.proxied_requests,
                    rate_limited_requests: state.rate_limited_requests,
                    unauthorized_requests: state.unauthorized_requests,
                    upstream_unavailable_requests: state.upstream_unavailable_requests,
                    avg_latency_ms: average_latency_ms(
                        state.cumulative_latency_ms,
                        state.total_requests,
                    ),
                    max_latency_ms: state.max_latency_ms,
                    last_status_code: state.last_status_code,
                })
            })
            .collect::<Vec<_>>();

        IngressAuditSnapshot {
            generated_at: now_iso(),
            totals,
            routes,
            recent_events: self.recent_events.iter().cloned().collect(),
        }
    }
}

fn average_latency_ms(total_latency_ms: u64, total_requests: u64) -> u64 {
    if total_requests == 0 {
        0
    } else {
        total_latency_ms / total_requests
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use super::{IngressAuditTrail, IngressEventInput, IngressEventKind};
    use crate::traffic_policy::TrafficClass;

    #[test]
    fn aggregates_route_stats_and_recent_events() {
        let mut trail = IngressAuditTrail::new();
        trail.record(IngressEventInput {
            request_id: "req-1".to_string(),
            chat_trace_id: Some("trace-1".to_string()),
            client_ip: IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
            method: "GET".to_string(),
            path: "/api/messages/chat/room-1".to_string(),
            route_class: TrafficClass::DefaultApi,
            kind: IngressEventKind::Proxied,
            status_code: Some(200),
            latency_ms: 42,
            detail: None,
        });
        trail.record(IngressEventInput {
            request_id: "req-2".to_string(),
            chat_trace_id: None,
            client_ip: IpAddr::V4(Ipv4Addr::new(127, 0, 0, 2)),
            method: "GET".to_string(),
            path: "/api/messages/chat/room-1".to_string(),
            route_class: TrafficClass::DefaultApi,
            kind: IngressEventKind::RateLimited,
            status_code: Some(429),
            latency_ms: 3,
            detail: Some("retry later".to_string()),
        });

        let snapshot = trail.snapshot();
        assert_eq!(snapshot.totals.total_requests, 2);
        assert_eq!(snapshot.totals.proxied_requests, 1);
        assert_eq!(snapshot.totals.rate_limited_requests, 1);
        assert_eq!(snapshot.recent_events.len(), 2);

        let route = snapshot
            .routes
            .iter()
            .find(|route| route.route_class == TrafficClass::DefaultApi)
            .expect("default api summary missing");
        assert_eq!(route.total_requests, 2);
        assert_eq!(route.avg_latency_ms, 22);
        assert_eq!(route.max_latency_ms, 42);
        assert_eq!(route.last_status_code, Some(429));
    }
}
