use std::sync::Arc;

use super::redis_session_registry::RedisSessionRegistry;
use super::session_registry::{RealtimeRegistrySnapshot, RealtimeSessionRegistry};
use crate::realtime_contracts::RealtimeEventEnvelopeV1;

/// 会话注册表后端抽象（内存版或 Redis 共享版）
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

    pub async fn touch_session_activity(&self, envelope: &RealtimeEventEnvelopeV1) {
        match self {
            Self::InMemory(reg) => reg.lock().await.touch_session_activity(envelope),
            Self::Redis(reg) => {
                if let Err(e) = reg.touch_session_activity(envelope).await {
                    tracing::warn!("redis touch session activity failed: {}", e);
                }
            }
        }
    }

    pub async fn renew_session_lease(
        &self,
        session_id: &str,
        user_id: Option<&str>,
        rooms: &[String],
        source: &str,
    ) {
        match self {
            Self::InMemory(reg) => reg
                .lock()
                .await
                .renew_session_lease(session_id, user_id, rooms, source),
            Self::Redis(reg) => {
                if let Err(e) = reg
                    .renew_session_lease(session_id, user_id, rooms, source)
                    .await
                {
                    tracing::warn!(session_id = %session_id, "redis renew session lease failed: {}", e);
                }
            }
        }
    }

    pub async fn remove_user_session(&self, session_id: &str, old_user_id: &str) {
        match self {
            Self::InMemory(reg) => reg
                .lock()
                .await
                .remove_user_session(session_id, old_user_id),
            Self::Redis(reg) => {
                if let Err(e) = reg.remove_user_session(session_id, old_user_id).await {
                    tracing::warn!(session_id = %session_id, "redis remove old user session failed: {}", e);
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
                        session_index_size: 0,
                    },
                    users: vec![],
                }),
        }
    }
}
