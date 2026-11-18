use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use redis::AsyncCommands;
use redis::Pipeline;
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
const USER_KEY_PREFIX: &str = "rt:user:";
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
    lease_ttl_secs: u64,
    local_cache: Arc<RwLock<HashMap<String, RedisSessionRecord>>>,
}

impl RedisSessionRegistry {
    pub fn new(redis: redis::Client, gateway_id: String, lease_ttl_secs: u64) -> Self {
        Self {
            redis,
            gateway_id,
            lease_ttl_secs,
            local_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    async fn get_conn(&self) -> Result<redis::aio::MultiplexedConnection> {
        self.redis
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| anyhow::anyhow!(e))
    }

    pub fn session_key(session_id: &str) -> String {
        format!("{}{}", SESSION_KEY_PREFIX, session_id.trim())
    }

    pub fn user_sessions_key(user_id: &str) -> String {
        format!("{}{}", USER_SESSIONS_KEY_PREFIX, user_id.trim())
    }

    pub fn user_key(user_id: &str) -> String {
        format!("{}{}", USER_KEY_PREFIX, user_id.trim())
    }

    /// 统一剥离可选的 `room:` 前缀，确保写入 `"room:<groupId>"` 与查询 `"<groupId>"` 命中同一裸房间标识
    pub fn normalize_room_id(room: &str) -> &str {
        let mut clean = room.trim();
        while let Some(stripped) = clean.strip_prefix("room:") {
            clean = stripped.trim();
        }
        clean
    }

    /// 生成规范化的 Redis 房间成员集合键 `rt:room:<groupId>`
    pub fn room_key(room: &str) -> String {
        let clean = Self::normalize_room_id(room);
        format!("{}{}", ROOM_MEMBERS_KEY_PREFIX, clean)
    }

    fn normalize_room_list(rooms: &[String]) -> Vec<String> {
        let mut normalized = BTreeSet::new();
        for room in rooms {
            let trimmed = room.trim();
            if trimmed.is_empty() || trimmed.starts_with("sid:") || trimmed.starts_with("user:") {
                continue;
            }
            let clean = Self::normalize_room_id(trimmed);
            if !clean.is_empty() {
                normalized.insert(clean.to_string());
            }
        }
        normalized.into_iter().collect()
    }

    fn add_user_membership_ops(pipe: &mut Pipeline, user_id: &str, session_id: &str, ttl: i64) {
        let legacy_key = Self::user_sessions_key(user_id);
        let short_key = Self::user_key(user_id);
        pipe.sadd(&legacy_key, session_id)
            .expire(&legacy_key, ttl)
            .sadd(&short_key, session_id)
            .expire(&short_key, ttl);
    }

    fn remove_user_membership_ops(pipe: &mut Pipeline, user_id: &str, session_id: &str) {
        let legacy_key = Self::user_sessions_key(user_id);
        let short_key = Self::user_key(user_id);
        pipe.srem(&legacy_key, session_id)
            .srem(&short_key, session_id);
    }

    pub async fn apply_session_opened(&self, envelope: &RealtimeEventEnvelopeV1) -> Result<()> {
        let session_key = Self::session_key(&envelope.session_id);
        let mut conn = self.get_conn().await?;

        // 若已存在认证记录（如 authenticate 早于 SessionOpened 落库），合并保留 user_id / authenticated / rooms
        let existing_record: Option<RedisSessionRecord> = conn
            .get::<_, Option<String>>(&session_key)
            .await?
            .and_then(|json| serde_json::from_str::<RedisSessionRecord>(&json).ok());

        let merged_user_id = envelope.user_id.clone().or_else(|| {
            existing_record
                .as_ref()
                .and_then(|existing| existing.user_id.clone())
        });
        let merged_authenticated = merged_user_id.is_some()
            || existing_record
                .as_ref()
                .map(|existing| existing.authenticated)
                .unwrap_or(false);
        let merged_rooms = existing_record
            .as_ref()
            .map(|existing| Self::normalize_room_list(&existing.rooms))
            .unwrap_or_default();

        let record = RedisSessionRecord {
            session_id: envelope.session_id.clone(),
            user_id: merged_user_id.clone(),
            authenticated: merged_authenticated,
            rooms: merged_rooms.clone(),
            last_heartbeat_at: envelope.emitted_at.clone(),
            last_event_at: envelope.emitted_at.clone(),
            source: envelope.source.clone(),
            gateway_id: self.gateway_id.clone(),
        };

        let record_json = serde_json::to_string(&record)?;
        let ttl = self.lease_ttl_secs as i64;

        let mut pipe = Pipeline::new();
        pipe.set_ex(&session_key, &record_json, self.lease_ttl_secs)
            .sadd(REGISTRY_SET_KEY, &envelope.session_id);

        if let Some(user_id) = &merged_user_id {
            Self::add_user_membership_ops(&mut pipe, user_id, &envelope.session_id, ttl);
        }
        for room in &merged_rooms {
            let rk = Self::room_key(room);
            pipe.sadd(&rk, &envelope.session_id).expire(&rk, ttl);
        }

        pipe.query_async::<()>(&mut conn).await?;

        let mut cache = self.local_cache.write().await;
        cache.insert(envelope.session_id.clone(), record);

        Ok(())
    }

    pub async fn apply_session_closed(&self, envelope: &RealtimeEventEnvelopeV1) -> Result<()> {
        let session_key = Self::session_key(&envelope.session_id);
        let mut conn = self.get_conn().await?;

        let record_json: Option<String> = conn.get(&session_key).await?;
        let cached_fallback = {
            let mut cache = self.local_cache.write().await;
            cache.remove(&envelope.session_id)
        };

        let parsed_record = record_json
            .as_deref()
            .and_then(|json| serde_json::from_str::<RedisSessionRecord>(json).ok())
            .or(cached_fallback);

        let mut cleanup_pipe = Pipeline::new();
        if let Some(record) = parsed_record {
            for room in &record.rooms {
                let room_key = Self::room_key(room);
                cleanup_pipe.srem(&room_key, &envelope.session_id);
            }
            if let Some(user_id) = record.user_id.as_deref().or(envelope.user_id.as_deref()) {
                Self::remove_user_membership_ops(&mut cleanup_pipe, user_id, &envelope.session_id);
            }
        } else if let Some(user_id) = envelope.user_id.as_deref() {
            Self::remove_user_membership_ops(&mut cleanup_pipe, user_id, &envelope.session_id);
        }
        cleanup_pipe.del(&session_key);
        cleanup_pipe.srem(REGISTRY_SET_KEY, &envelope.session_id);
        cleanup_pipe.query_async::<()>(&mut conn).await?;

        Ok(())
    }

    pub async fn apply_session_heartbeat(&self, envelope: &RealtimeEventEnvelopeV1) -> Result<()> {
        let session_key = Self::session_key(&envelope.session_id);
        let mut conn = self.get_conn().await?;

        let record_json: Option<String> = conn.get(&session_key).await?;
        // 若 SessionHeartbeat 早于 SessionOpened 到达或租约曾短暂过期，自动自建记录而非静默丢弃
        let mut record = record_json
            .as_deref()
            .and_then(|json| serde_json::from_str::<RedisSessionRecord>(json).ok())
            .unwrap_or_else(|| RedisSessionRecord {
                session_id: envelope.session_id.clone(),
                user_id: envelope.user_id.clone(),
                authenticated: envelope.user_id.is_some(),
                rooms: Vec::new(),
                last_heartbeat_at: envelope.emitted_at.clone(),
                last_event_at: envelope.emitted_at.clone(),
                source: envelope.source.clone(),
                gateway_id: self.gateway_id.clone(),
            });

        record.rooms = Self::normalize_room_list(&record.rooms);
        record.last_heartbeat_at = envelope.emitted_at.clone();
        record.last_event_at = envelope.emitted_at.clone();

        let ttl = self.lease_ttl_secs as i64;
        let mut pipe = Pipeline::new();
        pipe.sadd(REGISTRY_SET_KEY, &envelope.session_id);

        if let Some(incoming_user) = &envelope.user_id {
            if let Some(prev_user) = record.user_id.as_deref()
                && prev_user != incoming_user
            {
                Self::remove_user_membership_ops(&mut pipe, prev_user, &envelope.session_id);
            }
            record.user_id = Some(incoming_user.clone());
            record.authenticated = true;
        }
        if let Some(active_user) = record.user_id.as_deref() {
            Self::add_user_membership_ops(&mut pipe, active_user, &envelope.session_id, ttl);
        }

        if let Some(raw_room_id) = envelope.payload.get("roomId").and_then(|v| v.as_str()) {
            let clean_room = Self::normalize_room_id(raw_room_id);
            if !clean_room.is_empty() {
                let room_key = Self::room_key(clean_room);
                let activity = envelope.payload.get("activity").and_then(|v| v.as_str());
                if activity == Some("room_left") {
                    record
                        .rooms
                        .retain(|existing| Self::normalize_room_id(existing) != clean_room);
                    pipe.srem(&room_key, &envelope.session_id);
                } else if !clean_room.starts_with("sid:") && !clean_room.starts_with("user:") {
                    if !record
                        .rooms
                        .iter()
                        .any(|existing| Self::normalize_room_id(existing) == clean_room)
                    {
                        record.rooms.push(clean_room.to_string());
                    }
                    pipe.sadd(&room_key, &envelope.session_id)
                        .expire(&room_key, ttl);
                }
            }
        }

        // 同步刷新当前会话已加入的所有房间集合 TTL
        for joined_room in &record.rooms {
            let rk = Self::room_key(joined_room);
            pipe.sadd(&rk, &envelope.session_id).expire(&rk, ttl);
        }

        let updated_json = serde_json::to_string(&record)?;
        pipe.set_ex(&session_key, &updated_json, self.lease_ttl_secs);
        pipe.query_async::<()>(&mut conn).await?;

        let mut cache = self.local_cache.write().await;
        cache.insert(envelope.session_id.clone(), record);

        Ok(())
    }

    /// 在收到 `sendMessage` / `readChat` / `typing` 等活跃事件时同步延长会话与房间订阅 TTL
    pub async fn touch_session_activity(&self, envelope: &RealtimeEventEnvelopeV1) -> Result<()> {
        let session_key = Self::session_key(&envelope.session_id);
        let mut conn = self.get_conn().await?;

        let record_json: Option<String> = conn.get(&session_key).await?;
        let Some(mut record) = record_json
            .as_deref()
            .and_then(|json| serde_json::from_str::<RedisSessionRecord>(json).ok())
        else {
            return Ok(());
        };

        record.rooms = Self::normalize_room_list(&record.rooms);
        record.last_heartbeat_at = envelope.emitted_at.clone();
        record.last_event_at = envelope.emitted_at.clone();
        if let Some(uid) = &envelope.user_id {
            record.user_id = Some(uid.clone());
            record.authenticated = true;
        }

        let ttl = self.lease_ttl_secs as i64;
        let updated_json = serde_json::to_string(&record)?;
        let mut pipe = Pipeline::new();
        pipe.set_ex(&session_key, &updated_json, self.lease_ttl_secs)
            .sadd(REGISTRY_SET_KEY, &envelope.session_id);
        if let Some(uid) = record.user_id.as_deref() {
            Self::add_user_membership_ops(&mut pipe, uid, &envelope.session_id, ttl);
        }
        for room in &record.rooms {
            let rk = Self::room_key(room);
            pipe.sadd(&rk, &envelope.session_id).expire(&rk, ttl);
        }
        pipe.query_async::<()>(&mut conn).await?;

        let mut cache = self.local_cache.write().await;
        cache.insert(envelope.session_id.clone(), record);
        Ok(())
    }

    /// 供周期后台任务为本机活跃 Socket 会话续期 Redis 租约（若键被驱逐则自动自愈写回）
    pub async fn renew_session_lease(
        &self,
        session_id: &str,
        user_id: Option<&str>,
        rooms: &[String],
        source: &str,
    ) -> Result<()> {
        let session_key = Self::session_key(session_id);
        let mut conn = self.get_conn().await?;
        let now_iso = Utc::now().to_rfc3339();
        let clean_rooms = Self::normalize_room_list(rooms);

        let existing: Option<RedisSessionRecord> = conn
            .get::<_, Option<String>>(&session_key)
            .await?
            .and_then(|json| serde_json::from_str::<RedisSessionRecord>(&json).ok());

        let effective_user = user_id
            .map(ToString::to_string)
            .or_else(|| existing.as_ref().and_then(|rec| rec.user_id.clone()));
        let effective_rooms = if !clean_rooms.is_empty() {
            clean_rooms
        } else {
            existing
                .as_ref()
                .map(|rec| Self::normalize_room_list(&rec.rooms))
                .unwrap_or_default()
        };

        let record = RedisSessionRecord {
            session_id: session_id.to_string(),
            user_id: effective_user.clone(),
            authenticated: effective_user.is_some(),
            rooms: effective_rooms.clone(),
            last_heartbeat_at: now_iso.clone(),
            last_event_at: existing
                .map(|rec| rec.last_event_at)
                .unwrap_or_else(|| now_iso.clone()),
            source: source.to_string(),
            gateway_id: self.gateway_id.clone(),
        };

        let ttl = self.lease_ttl_secs as i64;
        let record_json = serde_json::to_string(&record)?;
        let mut pipe = Pipeline::new();
        pipe.set_ex(&session_key, &record_json, self.lease_ttl_secs)
            .sadd(REGISTRY_SET_KEY, session_id);
        if let Some(uid) = effective_user.as_deref() {
            Self::add_user_membership_ops(&mut pipe, uid, session_id, ttl);
        }
        for room in &effective_rooms {
            let rk = Self::room_key(room);
            pipe.sadd(&rk, session_id).expire(&rk, ttl);
        }
        pipe.query_async::<()>(&mut conn).await?;

        let mut cache = self.local_cache.write().await;
        cache.insert(session_id.to_string(), record);
        Ok(())
    }

    /// 切换账号重认证时从旧用户的会话集合中移除当前 Socket
    pub async fn remove_user_session(&self, session_id: &str, old_user_id: &str) -> Result<()> {
        let mut conn = self.get_conn().await?;
        let mut pipe = Pipeline::new();
        Self::remove_user_membership_ops(&mut pipe, old_user_id, session_id);
        pipe.query_async::<()>(&mut conn).await?;
        Ok(())
    }

    pub async fn apply_room_joined(&self, session_id: &str, room: &str) -> Result<()> {
        let clean_room = Self::normalize_room_id(room);
        if clean_room.is_empty() {
            return Ok(());
        }
        let session_key = Self::session_key(session_id);
        let room_key = Self::room_key(clean_room);
        let mut conn = self.get_conn().await?;

        let record_json: Option<String> = conn.get(&session_key).await?;
        if let Some(json) = record_json
            && let Ok(mut record) = serde_json::from_str::<RedisSessionRecord>(&json)
        {
            record.rooms = Self::normalize_room_list(&record.rooms);
            if !record.rooms.iter().any(|r| r == clean_room) {
                record.rooms.push(clean_room.to_string());
            }
            let updated_json = serde_json::to_string(&record)?;

            let mut pipe = Pipeline::new();
            pipe.set_ex(&session_key, &updated_json, self.lease_ttl_secs);
            pipe.sadd(&room_key, session_id)
                .expire(&room_key, self.lease_ttl_secs as i64);
            pipe.query_async::<()>(&mut conn).await?;

            let mut cache = self.local_cache.write().await;
            cache.insert(session_id.to_string(), record);
        }

        Ok(())
    }

    pub async fn apply_room_left(&self, session_id: &str, room: &str) -> Result<()> {
        let clean_room = Self::normalize_room_id(room);
        if clean_room.is_empty() {
            return Ok(());
        }
        let session_key = Self::session_key(session_id);
        let room_key = Self::room_key(clean_room);
        let mut conn = self.get_conn().await?;

        let record_json: Option<String> = conn.get(&session_key).await?;
        if let Some(json) = record_json
            && let Ok(mut record) = serde_json::from_str::<RedisSessionRecord>(&json)
        {
            record
                .rooms
                .retain(|existing| Self::normalize_room_id(existing) != clean_room);
            let updated_json = serde_json::to_string(&record)?;

            let mut pipe = Pipeline::new();
            pipe.set_ex(&session_key, &updated_json, self.lease_ttl_secs);
            pipe.srem(&room_key, session_id);
            pipe.query_async::<()>(&mut conn).await?;

            let mut cache = self.local_cache.write().await;
            cache.insert(session_id.to_string(), record);
        }

        Ok(())
    }

    pub async fn resolve_socket_targets(
        &self,
        target: &RealtimeDeliveryTarget,
    ) -> Result<Vec<String>> {
        let mut conn = self.get_conn().await?;
        let mut candidate_ids: Vec<String> = Vec::new();
        let mut source_set_keys: Vec<String> = Vec::new();

        match target.kind {
            RealtimeDeliveryTargetKind::User => {
                if let Some(user_id) = &target.id {
                    let legacy_key = Self::user_sessions_key(user_id);
                    let short_key = Self::user_key(user_id);
                    let sessions: Vec<String> = redis::cmd("SUNION")
                        .arg(&legacy_key)
                        .arg(&short_key)
                        .query_async(&mut conn)
                        .await?;
                    candidate_ids = sessions;
                    source_set_keys.push(legacy_key);
                    source_set_keys.push(short_key);
                }
            }
            RealtimeDeliveryTargetKind::Room => {
                if let Some(room) = &target.id {
                    let room_key = Self::room_key(room);
                    let sessions: Vec<String> = conn.smembers(&room_key).await?;
                    candidate_ids = sessions;
                    source_set_keys.push(room_key);
                }
            }
            RealtimeDeliveryTargetKind::Socket => {
                if let Some(session_id) = &target.id {
                    candidate_ids.push(session_id.clone());
                }
            }
            RealtimeDeliveryTargetKind::Broadcast => {
                let sessions: Vec<String> = conn.smembers(REGISTRY_SET_KEY).await?;
                candidate_ids = sessions;
                source_set_keys.push(REGISTRY_SET_KEY.to_string());
            }
        }

        candidate_ids.sort();
        candidate_ids.dedup();
        if candidate_ids.is_empty() {
            return Ok(Vec::new());
        }

        // 通过 Redis `MGET` 校验真实活跃会话，避免按本机 `local_cache` 误过滤导致重启或多实例丢消息
        let session_keys = candidate_ids
            .iter()
            .map(|sid| Self::session_key(sid))
            .collect::<Vec<_>>();
        let raw_records: Vec<Option<String>> = conn.mget(&session_keys).await?;

        let mut active_sessions = Vec::with_capacity(candidate_ids.len());
        let mut expired_ids = Vec::new();

        for (sid, raw_opt) in candidate_ids.into_iter().zip(raw_records.into_iter()) {
            match raw_opt
                .as_deref()
                .and_then(|raw| serde_json::from_str::<RedisSessionRecord>(raw).ok())
            {
                Some(record) => {
                    if matches!(target.kind, RealtimeDeliveryTargetKind::User)
                        && !record.authenticated
                    {
                        continue;
                    }
                    if !target.exclude_socket_ids.contains(&sid) {
                        active_sessions.push(sid);
                    }
                }
                None => {
                    expired_ids.push(sid);
                }
            }
        }

        // 惰性清理集合中已过期的残留会话 ID
        if !expired_ids.is_empty() && !source_set_keys.is_empty() {
            let mut cleanup_pipe = Pipeline::new();
            for sid in &expired_ids {
                for set_key in &source_set_keys {
                    cleanup_pipe.srem(set_key, sid);
                }
                cleanup_pipe.srem(REGISTRY_SET_KEY, sid);
            }
            let _ = cleanup_pipe.query_async::<()>(&mut conn).await;
            let mut cache = self.local_cache.write().await;
            for sid in &expired_ids {
                cache.remove(sid);
            }
        }

        active_sessions.sort();
        active_sessions.dedup();
        Ok(active_sessions)
    }

    pub async fn snapshot(&self) -> Result<RealtimeRegistrySnapshot> {
        let active_records = match self.fetch_active_records_from_redis().await {
            Ok(records) => records,
            Err(_) => {
                let cache = self.local_cache.read().await;
                cache.values().cloned().collect::<Vec<_>>()
            }
        };

        let mut users: HashMap<String, RealtimeUserSessionSnapshot> = HashMap::new();
        let mut total_connected = 0;
        let mut total_authenticated = 0;
        let mut total_rooms = 0;
        let index_size = active_records.len();

        for record in active_records {
            let normalized_rooms = Self::normalize_room_list(&record.rooms);
            total_connected += 1;
            if record.authenticated {
                total_authenticated += 1;
            }
            total_rooms += normalized_rooms.len();

            if let Some(user_id) = &record.user_id {
                let user =
                    users
                        .entry(user_id.clone())
                        .or_insert_with(|| RealtimeUserSessionSnapshot {
                            user_id: user_id.clone(),
                            connected_sessions: 0,
                            authenticated_sessions: 0,
                            room_subscriptions: 0,
                            session_ids: Vec::new(),
                            rooms: Vec::new(),
                        });
                user.connected_sessions += 1;
                if record.authenticated {
                    user.authenticated_sessions += 1;
                }
                user.session_ids.push(record.session_id.clone());
                for room in normalized_rooms {
                    let canonical = format!("room:{room}");
                    if !user.rooms.contains(&canonical) {
                        user.rooms.push(canonical);
                    }
                }
                user.room_subscriptions = user.rooms.len();
            }
        }

        Ok(RealtimeRegistrySnapshot {
            totals: RealtimeRegistryTotals {
                connected_sessions: total_connected,
                authenticated_sessions: total_authenticated,
                room_subscriptions: total_rooms,
                session_index_size: index_size,
            },
            users: users.into_values().collect(),
        })
    }

    async fn fetch_active_records_from_redis(&self) -> Result<Vec<RedisSessionRecord>> {
        let mut conn = self.get_conn().await?;
        let mut session_ids: Vec<String> = conn.smembers(REGISTRY_SET_KEY).await?;
        session_ids.sort();
        session_ids.dedup();
        if session_ids.is_empty() {
            return Ok(Vec::new());
        }

        let keys = session_ids
            .iter()
            .map(|sid| Self::session_key(sid))
            .collect::<Vec<_>>();
        let raw_values: Vec<Option<String>> = conn.mget(&keys).await?;

        let mut records = Vec::with_capacity(session_ids.len());
        let mut stale_ids = Vec::new();
        for (sid, raw_opt) in session_ids.into_iter().zip(raw_values.into_iter()) {
            match raw_opt
                .as_deref()
                .and_then(|raw| serde_json::from_str::<RedisSessionRecord>(raw).ok())
            {
                Some(rec) => records.push(rec),
                None => stale_ids.push(sid),
            }
        }

        if !stale_ids.is_empty() {
            let mut pipe = Pipeline::new();
            for sid in &stale_ids {
                pipe.srem(REGISTRY_SET_KEY, sid);
            }
            let _ = pipe.query_async::<()>(&mut conn).await;
        }

        Ok(records)
    }
}

#[cfg(test)]
mod tests {
    use super::RedisSessionRegistry;

    #[test]
    fn room_key_strips_optional_prefix_consistently() {
        assert_eq!(
            RedisSessionRegistry::room_key("room:15776659-176c-4a97-8146-c6a24d85fb96"),
            "rt:room:15776659-176c-4a97-8146-c6a24d85fb96"
        );
        assert_eq!(
            RedisSessionRegistry::room_key("15776659-176c-4a97-8146-c6a24d85fb96"),
            "rt:room:15776659-176c-4a97-8146-c6a24d85fb96"
        );
        assert_eq!(
            RedisSessionRegistry::room_key("room:room:nested-group"),
            "rt:room:nested-group"
        );
        assert_eq!(
            RedisSessionRegistry::normalize_room_id("room:group-alpha"),
            "group-alpha"
        );
    }

    #[test]
    fn user_keys_cover_both_legacy_and_compact_namespaces() {
        assert_eq!(
            RedisSessionRegistry::user_sessions_key("u-1"),
            "rt:user_sessions:u-1"
        );
        assert_eq!(RedisSessionRegistry::user_key("u-1"), "rt:user:u-1");
    }
}
