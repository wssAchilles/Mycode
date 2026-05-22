use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use super::session_registry::{
    RealtimeRegistrySnapshot, RealtimeRegistryTotals, RealtimeUserSessionSnapshot,
};
use crate::realtime_contracts::{
    RealtimeDeliveryTarget, RealtimeDeliveryTargetKind, RealtimeEventEnvelopeV1,
};

const SESSION_KEY_PREFIX: &str = "rt:session:";
const USER_SESSIONS_KEY_PREFIX: &str = "rt:user_sessions:";
const ROOM_MEMBERS_KEY_PREFIX: &str = "rt:room:";
const REGISTRY_SET_KEY: &str = "rt:registry:sessions";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RedisSessionRecord {
    session_id: String,
    user_id: Option<String>,
    authenticated: bool,
    rooms: Vec<String>,
    last_heartbeat_at: String,
    last_event_at: String,
    source: String,
    gateway_id: String,
}

#[derive(Debug, Clone)]
pub struct RedisSessionRegistry {
    redis: redis::Client,
    gateway_id: String,
    local_cache: Arc<RwLock<HashMap<String, RedisSessionRecord>>>,
}

impl RedisSessionRegistry {
    pub fn new(redis: redis::Client, gateway_id: String) -> Self {
        Self {
            redis,
            gateway_id,
            local_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    async fn get_conn(&self) -> Result<redis::aio::MultiplexedConnection> {
        self.redis.get_multiplexed_async_connection().await.map_err(|e| anyhow::anyhow!(e))
    }

    fn session_key(session_id: &str) -> String {
        format!("{}{}", SESSION_KEY_PREFIX, session_id)
    }

    fn user_sessions_key(user_id: &str) -> String {
        format!("{}{}", USER_SESSIONS_KEY_PREFIX, user_id)
    }

    fn room_key(room: &str) -> String {
        format!("{}{}", ROOM_MEMBERS_KEY_PREFIX, room)
    }

    pub async fn apply_session_opened(&self, envelope: &RealtimeEventEnvelopeV1) -> Result<()> {
        let record = RedisSessionRecord {
            session_id: envelope.session_id.clone(),
            user_id: envelope.user_id.clone(),
            authenticated: envelope.user_id.is_some(),
            rooms: Vec::new(),
            last_heartbeat_at: envelope.emitted_at.clone(),
            last_event_at: envelope.emitted_at.clone(),
            source: envelope.source.clone(),
            gateway_id: self.gateway_id.clone(),
        };

        let session_key = Self::session_key(&envelope.session_id);
        let record_json = serde_json::to_string(&record)?;

        let mut conn = self.get_conn().await?;
        conn.set_ex::<_, _, ()>(&session_key, &record_json, 3600).await?;
        conn.sadd::<_, _, ()>(REGISTRY_SET_KEY, &envelope.session_id).await?;

        if let Some(user_id) = &envelope.user_id {
            let user_key = Self::user_sessions_key(user_id);
            conn.sadd::<_, _, ()>(&user_key, &envelope.session_id).await?;
            conn.expire::<_, ()>(&user_key, 3600).await?;
        }

        let mut cache = self.local_cache.write().await;
        cache.insert(envelope.session_id.clone(), record);

        Ok(())
    }

    pub async fn apply_session_closed(&self, envelope: &RealtimeEventEnvelopeV1) -> Result<()> {
        let session_key = Self::session_key(&envelope.session_id);
        let mut conn = self.get_conn().await?;

        let record_json: Option<String> = conn.get(&session_key).await?;
        if let Some(json) = record_json {
            if let Ok(record) = serde_json::from_str::<RedisSessionRecord>(&json) {
                for room in &record.rooms {
                    let room_key = Self::room_key(room);
                    conn.srem::<_, _, ()>(&room_key, &envelope.session_id).await?;
                }
                if let Some(user_id) = &record.user_id {
                    let user_key = Self::user_sessions_key(user_id);
                    conn.srem::<_, _, ()>(&user_key, &envelope.session_id).await?;
                }
            }
        }

        conn.del::<_, ()>(&session_key).await?;
        conn.srem::<_, _, ()>(REGISTRY_SET_KEY, &envelope.session_id).await?;

        let mut cache = self.local_cache.write().await;
        cache.remove(&envelope.session_id);

        Ok(())
    }

    pub async fn apply_session_heartbeat(&self, envelope: &RealtimeEventEnvelopeV1) -> Result<()> {
        let session_key = Self::session_key(&envelope.session_id);
        let mut conn = self.get_conn().await?;

        let record_json: Option<String> = conn.get(&session_key).await?;
        if let Some(json) = record_json {
            if let Ok(mut record) = serde_json::from_str::<RedisSessionRecord>(&json) {
                record.last_heartbeat_at = envelope.emitted_at.clone();
                record.last_event_at = envelope.emitted_at.clone();
                let updated_json = serde_json::to_string(&record)?;
                conn.set_ex::<_, _, ()>(&session_key, &updated_json, 3600).await?;

                let mut cache = self.local_cache.write().await;
                cache.insert(envelope.session_id.clone(), record);
            }
        }

        Ok(())
    }

    pub async fn apply_room_joined(&self, session_id: &str, room: &str) -> Result<()> {
        let session_key = Self::session_key(session_id);
        let room_key = Self::room_key(room);
        let mut conn = self.get_conn().await?;

        let record_json: Option<String> = conn.get(&session_key).await?;
        if let Some(json) = record_json {
            if let Ok(mut record) = serde_json::from_str::<RedisSessionRecord>(&json) {
                if !record.rooms.contains(&room.to_string()) {
                    record.rooms.push(room.to_string());
                }
                let updated_json = serde_json::to_string(&record)?;
                conn.set_ex::<_, _, ()>(&session_key, &updated_json, 3600).await?;

                let mut cache = self.local_cache.write().await;
                cache.insert(session_id.to_string(), record);
            }
        }

        conn.sadd::<_, _, ()>(&room_key, session_id).await?;

        Ok(())
    }

    pub async fn apply_room_left(&self, session_id: &str, room: &str) -> Result<()> {
        let session_key = Self::session_key(session_id);
        let room_key = Self::room_key(room);
        let mut conn = self.get_conn().await?;

        let record_json: Option<String> = conn.get(&session_key).await?;
        if let Some(json) = record_json {
            if let Ok(mut record) = serde_json::from_str::<RedisSessionRecord>(&json) {
                record.rooms.retain(|r| r != room);
                let updated_json = serde_json::to_string(&record)?;
                conn.set_ex::<_, _, ()>(&session_key, &updated_json, 3600).await?;

                let mut cache = self.local_cache.write().await;
                cache.insert(session_id.to_string(), record);
            }
        }

        conn.srem::<_, _, ()>(&room_key, session_id).await?;

        Ok(())
    }

    pub async fn resolve_socket_targets(
        &self,
        target: &RealtimeDeliveryTarget,
    ) -> Result<Vec<String>> {
        let mut conn = self.get_conn().await?;
        let mut session_ids = Vec::new();

        match target.kind {
            RealtimeDeliveryTargetKind::User => {
                if let Some(user_id) = &target.id {
                    let user_key = Self::user_sessions_key(user_id);
                    let sessions: Vec<String> = conn.smembers(&user_key).await?;
                    session_ids = sessions;
                }
            }
            RealtimeDeliveryTargetKind::Room => {
                if let Some(room) = &target.id {
                    let room_key = Self::room_key(room);
                    let sessions: Vec<String> = conn.smembers(&room_key).await?;
                    session_ids = sessions;
                }
            }
            RealtimeDeliveryTargetKind::Socket => {
                if let Some(session_id) = &target.id {
                    session_ids.push(session_id.clone());
                }
            }
            RealtimeDeliveryTargetKind::Broadcast => {
                let sessions: Vec<String> = conn.smembers(REGISTRY_SET_KEY).await?;
                session_ids = sessions;
            }
        }

        let cache = self.local_cache.read().await;
        let local_sessions: Vec<String> = session_ids
            .into_iter()
            .filter(|id| cache.contains_key(id))
            .collect();

        Ok(local_sessions)
    }

    pub async fn snapshot(&self) -> Result<RealtimeRegistrySnapshot> {
        let cache = self.local_cache.read().await;
        
        let mut users: HashMap<String, RealtimeUserSessionSnapshot> = HashMap::new();
        let mut total_connected = 0;
        let mut total_authenticated = 0;
        let mut total_rooms = 0;

        for record in cache.values() {
            total_connected += 1;
            if record.authenticated {
                total_authenticated += 1;
            }
            total_rooms += record.rooms.len();

            if let Some(user_id) = &record.user_id {
                let user = users.entry(user_id.clone()).or_insert_with(|| {
                    RealtimeUserSessionSnapshot {
                        user_id: user_id.clone(),
                        connected_sessions: 0,
                        authenticated_sessions: 0,
                        room_subscriptions: 0,
                        session_ids: Vec::new(),
                        rooms: Vec::new(),
                    }
                });
                user.connected_sessions += 1;
                if record.authenticated {
                    user.authenticated_sessions += 1;
                }
                user.session_ids.push(record.session_id.clone());
                for room in &record.rooms {
                    if !user.rooms.contains(room) {
                        user.rooms.push(room.clone());
                    }
                }
            }
        }

        Ok(RealtimeRegistrySnapshot {
            totals: RealtimeRegistryTotals {
                connected_sessions: total_connected,
                authenticated_sessions: total_authenticated,
                room_subscriptions: total_rooms,
            },
            users: users.into_values().collect(),
        })
    }
}
