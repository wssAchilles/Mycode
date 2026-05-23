use anyhow::Result;
use std::sync::Arc;

use super::redis_session_registry::RedisSessionRegistry;
use super::session_registry::{RealtimeRegistrySnapshot, RealtimeSessionRegistry};
use crate::realtime_contracts::RealtimeEventEnvelopeV1;

/// Session registry backend — in-memory or Redis
#[derive(Clone)]
pub enum SessionRegistryBackend {
    InMemory(Arc<tokio::sync::Mutex<RealtimeSessionRegistry>>),
    Redis(RedisSessionRegistry),
}

impl SessionRegistryBackend {
    pub async fn apply_session_opened(&self, envelope: &RealtimeEventEnvelopeV1) {
        match self {
            Self::InMemory(reg) => reg.lock().await.apply_session_opened(envelope),
            Self::Redis(reg) => {
                if let Err(e) = reg.apply_session_opened(envelope).await {
                    tracing::warn!("redis session opened failed: {}", e);
                }
            }
        }
    }

    pub async fn apply_session_closed(&self, envelope: &RealtimeEventEnvelopeV1) {
        match self {
            Self::InMemory(reg) => reg.lock().await.apply_session_closed(envelope),
            Self::Redis(reg) => {
                if let Err(e) = reg.apply_session_closed(envelope).await {
                    tracing::warn!("redis session closed failed: {}", e);
                }
            }
        }
    }

    pub async fn apply_session_heartbeat(&self, envelope: &RealtimeEventEnvelopeV1) {
        match self {
            Self::InMemory(reg) => reg.lock().await.apply_session_heartbeat(envelope),
            Self::Redis(reg) => {
                if let Err(e) = reg.apply_session_heartbeat(envelope).await {
                    tracing::warn!("redis session heartbeat failed: {}", e);
                }
            }
        }
    }

    pub async fn resolve_socket_targets(
        &self,
        target: &crate::realtime_contracts::RealtimeDeliveryTarget,
        stale_after_secs: u64,
    ) -> Vec<String> {
        match self {
            Self::InMemory(reg) => reg
                .lock()
                .await
                .resolve_socket_targets(target, stale_after_secs),
            Self::Redis(reg) => reg.resolve_socket_targets(target).await.unwrap_or_default(),
        }
    }

    pub async fn snapshot(&self, stale_after_secs: u64) -> RealtimeRegistrySnapshot {
        match self {
            Self::InMemory(reg) => reg.lock().await.snapshot(stale_after_secs),
            Self::Redis(reg) => reg
                .snapshot()
                .await
                .unwrap_or_else(|_| RealtimeRegistrySnapshot {
                    totals: super::session_registry::RealtimeRegistryTotals {
                        connected_sessions: 0,
                        authenticated_sessions: 0,
                        room_subscriptions: 0,
                    },
                    users: vec![],
                }),
        }
    }
}
