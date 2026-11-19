use std::collections::{BTreeSet, HashMap};

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;

use crate::realtime_contracts::{
    RealtimeDeliveryTarget, RealtimeDeliveryTargetKind, RealtimeEventEnvelopeV1,
};

#[derive(Debug, Clone)]
struct SessionRecord {
    session_id: String,
    user_id: Option<String>,
    authenticated: bool,
    rooms: BTreeSet<String>,
    last_heartbeat_at: String,
    last_event_at: String,
    last_heartbeat_epoch_ms: i64,
    last_event_epoch_ms: i64,
    source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeUserSessionSnapshot {
    pub user_id: String,
    pub connected_sessions: usize,
    pub authenticated_sessions: usize,
    pub room_subscriptions: usize,
    pub session_ids: Vec<String>,
    pub rooms: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeRegistrySnapshot {
    pub totals: RealtimeRegistryTotals,
    pub users: Vec<RealtimeUserSessionSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeRegistryTotals {
    pub connected_sessions: usize,
    pub authenticated_sessions: usize,
    pub room_subscriptions: usize,
    pub session_index_size: usize,
}

#[derive(Debug, Default, Clone)]
pub struct RealtimeSessionRegistry {
    session_by_id: HashMap<String, SessionRecord>,
    sessions_by_user: HashMap<String, BTreeSet<String>>,
    sessions_by_room: HashMap<String, BTreeSet<String>>,
}

impl RealtimeSessionRegistry {
    pub fn apply_session_opened(&mut self, envelope: &RealtimeEventEnvelopeV1) {
        let emitted_at_epoch_ms = parse_epoch_ms(&envelope.emitted_at);
        let session_id = envelope.session_id.clone();
        let incoming_user_id = envelope.user_id.clone();
        let new_record = SessionRecord {
            session_id: envelope.session_id.clone(),
            user_id: incoming_user_id.clone(),
            authenticated: incoming_user_id.is_some(),
            rooms: BTreeSet::new(),
            last_heartbeat_at: envelope.emitted_at.clone(),
            last_event_at: envelope.emitted_at.clone(),
            last_heartbeat_epoch_ms: emitted_at_epoch_ms,
            last_event_epoch_ms: emitted_at_epoch_ms,
            source: envelope.source.clone(),
        };
        let previous = self
            .session_by_id
            .insert(session_id.clone(), new_record.clone());

        if let Some(mut record) = previous {
            self.remove_indexes(&record);
            record.user_id = incoming_user_id.or(record.user_id);
            record.authenticated = record.user_id.is_some();
            record.last_event_at = envelope.emitted_at.clone();
            record.last_heartbeat_at = envelope.emitted_at.clone();
            record.last_event_epoch_ms = emitted_at_epoch_ms;
            record.last_heartbeat_epoch_ms = emitted_at_epoch_ms;
            record.source = envelope.source.clone();
            self.insert_indexes(&record);
            self.session_by_id.insert(session_id, record);
            return;
        }

        self.insert_indexes(&new_record);
    }

    pub fn apply_session_closed(&mut self, envelope: &RealtimeEventEnvelopeV1) {
        if let Some(record) = self.session_by_id.remove(&envelope.session_id) {
            self.remove_indexes(&record);
        }
    }

    pub fn apply_session_heartbeat(&mut self, envelope: &RealtimeEventEnvelopeV1) {
        let emitted_at_epoch_ms = parse_epoch_ms(&envelope.emitted_at);
        let session_id = envelope.session_id.clone();
        let incoming_user_id = envelope.user_id.clone();
        let mut record = self
            .session_by_id
            .remove(&session_id)
            .unwrap_or(SessionRecord {
                session_id: envelope.session_id.clone(),
                user_id: incoming_user_id.clone(),
                authenticated: incoming_user_id.is_some(),
                rooms: BTreeSet::new(),
                last_heartbeat_at: envelope.emitted_at.clone(),
                last_event_at: envelope.emitted_at.clone(),
                last_heartbeat_epoch_ms: emitted_at_epoch_ms,
                last_event_epoch_ms: emitted_at_epoch_ms,
                source: envelope.source.clone(),
            });
        self.remove_indexes(&record);
        record.user_id = incoming_user_id.or(record.user_id);
        record.authenticated = record.user_id.is_some();
        record.last_event_at = envelope.emitted_at.clone();
        record.last_heartbeat_at = envelope.emitted_at.clone();
        record.last_event_epoch_ms = emitted_at_epoch_ms;
        record.last_heartbeat_epoch_ms = emitted_at_epoch_ms;
        if let Some(room_id) = read_payload_string(&envelope.payload, "roomId") {
            match read_payload_string(&envelope.payload, "activity").as_deref() {
                Some("room_left") => {
                    record.rooms.remove(&normalize_room_target(&room_id));
                }
                _ => {
                    record.rooms.insert(normalize_room_target(&room_id));
                }
            }
        }
        self.insert_indexes(&record);
        self.session_by_id.insert(session_id, record);
    }

    /// 收到活跃事件（如发消息、已读、输入状态）时刷新心跳时间戳，避免连接静默过期
    pub fn touch_session_activity(&mut self, envelope: &RealtimeEventEnvelopeV1) {
        let emitted_at_epoch_ms = parse_epoch_ms(&envelope.emitted_at);
        if let Some(mut record) = self.session_by_id.remove(&envelope.session_id) {
            self.remove_indexes(&record);
            if let Some(incoming_user) = &envelope.user_id {
                record.user_id = Some(incoming_user.clone());
                record.authenticated = true;
            }
            record.last_event_at = envelope.emitted_at.clone();
            record.last_heartbeat_at = envelope.emitted_at.clone();
            record.last_event_epoch_ms = emitted_at_epoch_ms;
            record.last_heartbeat_epoch_ms = emitted_at_epoch_ms;
            self.insert_indexes(&record);
            self.session_by_id
                .insert(envelope.session_id.clone(), record);
        }
    }

    /// 供周期续租任务刷新内存会话存活时间戳与房间集合
    pub fn renew_session_lease(
        &mut self,
        session_id: &str,
        user_id: Option<&str>,
        rooms: &[String],
        source: &str,
    ) {
        let now = Utc::now();
        let now_iso = now.to_rfc3339();
        let now_ms = now.timestamp_millis();
        let mut record = self
            .session_by_id
            .remove(session_id)
            .unwrap_or_else(|| SessionRecord {
                session_id: session_id.to_string(),
                user_id: user_id.map(ToString::to_string),
                authenticated: user_id.is_some(),
                rooms: BTreeSet::new(),
                last_heartbeat_at: now_iso.clone(),
                last_event_at: now_iso.clone(),
                last_heartbeat_epoch_ms: now_ms,
                last_event_epoch_ms: now_ms,
                source: source.to_string(),
            });
        self.remove_indexes(&record);
        if let Some(uid) = user_id {
            record.user_id = Some(uid.to_string());
            record.authenticated = true;
        }
        for room in rooms {
            let trimmed = room.trim();
            if !trimmed.is_empty() && !trimmed.starts_with("sid:") && !trimmed.starts_with("user:")
            {
                record.rooms.insert(normalize_room_target(trimmed));
            }
        }
        record.last_heartbeat_at = now_iso;
        record.last_heartbeat_epoch_ms = now_ms;
        self.insert_indexes(&record);
        self.session_by_id.insert(session_id.to_string(), record);
    }

    /// 切号重认证时从旧用户索引移除当前会话
    pub fn remove_user_session(&mut self, session_id: &str, old_user_id: &str) {
        remove_index_entry(&mut self.sessions_by_user, old_user_id, session_id);
    }

    /// 判断指定用户当前是否至少存在一个未过期的已认证会话
    pub fn is_user_online(&self, user_id: &str, stale_after_secs: u64) -> bool {
        let Some(user_sessions) = self.sessions_by_user.get(user_id) else {
            return false;
        };
        user_sessions.iter().any(|session_id| {
            self.session_by_id
                .get(session_id)
                .map(|session| session.authenticated && !is_stale(session, stale_after_secs))
                .unwrap_or(false)
        })
    }

    /// 批量点查目标用户列表的在线状态
    pub fn query_users_online(
        &self,
        user_ids: &[String],
        stale_after_secs: u64,
    ) -> HashMap<String, bool> {
        let mut status_map = HashMap::with_capacity(user_ids.len());
        for user_id in user_ids {
            let clean = user_id.trim();
            if clean.is_empty() {
                continue;
            }
            status_map
                .entry(clean.to_string())
                .or_insert_with(|| self.is_user_online(clean, stale_after_secs));
        }
        status_map
    }

    pub fn snapshot(&self, stale_after_secs: u64) -> RealtimeRegistrySnapshot {
        let users = self
            .sessions_by_user
            .keys()
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .map(|user_id| self.user_snapshot(&user_id, stale_after_secs))
            .filter(|snapshot| snapshot.connected_sessions > 0)
            .collect::<Vec<_>>();

        let totals = self.session_by_id.values().fold(
            RealtimeRegistryTotals {
                connected_sessions: 0,
                authenticated_sessions: 0,
                room_subscriptions: 0,
                session_index_size: self.session_by_id.len(),
            },
            |mut acc, session| {
                if !is_stale(session, stale_after_secs) {
                    acc.connected_sessions += 1;
                    if session.authenticated {
                        acc.authenticated_sessions += 1;
                    }
                    acc.room_subscriptions += session.rooms.len();
                }
                acc
            },
        );

        RealtimeRegistrySnapshot { totals, users }
    }

    pub fn total_room_targets(&self) -> usize {
        self.session_by_id
            .values()
            .map(|session| session.rooms.len())
            .sum()
    }

    pub fn resolve_socket_targets(
        &self,
        target: &RealtimeDeliveryTarget,
        stale_after_secs: u64,
    ) -> Vec<String> {
        let candidate_ids = self.resolve_candidate_session_ids(target);
        let mut socket_ids = candidate_ids
            .into_iter()
            .filter_map(|session_id| self.session_by_id.get(&session_id))
            .filter(|session| !is_stale(session, stale_after_secs))
            .filter(|session| match target.kind {
                RealtimeDeliveryTargetKind::Socket => {
                    target.id.as_deref() == Some(session.session_id.as_str())
                }
                RealtimeDeliveryTargetKind::User => session.authenticated,
                RealtimeDeliveryTargetKind::Room => true,
                RealtimeDeliveryTargetKind::Broadcast => true,
            })
            .map(|session| session.session_id.clone())
            .collect::<Vec<_>>();

        if !target.exclude_socket_ids.is_empty() {
            socket_ids.retain(|socket_id| !target.exclude_socket_ids.contains(socket_id));
        }
        socket_ids.sort();
        socket_ids.dedup();
        socket_ids
    }

    fn user_snapshot(&self, user_id: &str, stale_after_secs: u64) -> RealtimeUserSessionSnapshot {
        let mut session_ids = Vec::new();
        let mut rooms = BTreeSet::new();
        let mut authenticated_sessions = 0usize;

        if let Some(user_sessions) = self.sessions_by_user.get(user_id) {
            for session_id in user_sessions {
                let Some(session) = self.session_by_id.get(session_id) else {
                    continue;
                };
                if is_stale(session, stale_after_secs) {
                    continue;
                }
                session_ids.push(session.session_id.clone());
                if session.authenticated {
                    authenticated_sessions += 1;
                }
                for room in &session.rooms {
                    rooms.insert(room.clone());
                }
            }
        }

        session_ids.sort();

        RealtimeUserSessionSnapshot {
            user_id: user_id.to_string(),
            connected_sessions: session_ids.len(),
            authenticated_sessions,
            room_subscriptions: rooms.len(),
            session_ids,
            rooms: rooms.into_iter().collect(),
        }
    }

    fn resolve_candidate_session_ids(&self, target: &RealtimeDeliveryTarget) -> Vec<String> {
        match target.kind {
            RealtimeDeliveryTargetKind::Socket => target
                .id
                .as_deref()
                .filter(|session_id| self.session_by_id.contains_key(*session_id))
                .into_iter()
                .map(ToString::to_string)
                .collect(),
            RealtimeDeliveryTargetKind::User => target
                .id
                .as_deref()
                .and_then(|user_id| self.sessions_by_user.get(user_id))
                .map(|sessions| sessions.iter().cloned().collect())
                .unwrap_or_default(),
            RealtimeDeliveryTargetKind::Room => target
                .id
                .as_deref()
                .map(normalize_room_target)
                .and_then(|room_id| self.sessions_by_room.get(&room_id))
                .map(|sessions| sessions.iter().cloned().collect())
                .unwrap_or_default(),
            RealtimeDeliveryTargetKind::Broadcast => self.session_by_id.keys().cloned().collect(),
        }
    }

    fn insert_indexes(&mut self, record: &SessionRecord) {
        if let Some(user_id) = &record.user_id {
            self.sessions_by_user
                .entry(user_id.clone())
                .or_default()
                .insert(record.session_id.clone());
        }
        for room_id in &record.rooms {
            self.sessions_by_room
                .entry(room_id.clone())
                .or_default()
                .insert(record.session_id.clone());
        }
    }

    fn remove_indexes(&mut self, record: &SessionRecord) {
        if let Some(user_id) = &record.user_id {
            remove_index_entry(&mut self.sessions_by_user, user_id, &record.session_id);
        }
        for room_id in &record.rooms {
            remove_index_entry(&mut self.sessions_by_room, room_id, &record.session_id);
        }
    }
}

fn is_stale(session: &SessionRecord, stale_after_secs: u64) -> bool {
    let now_epoch_ms = Utc::now().timestamp_millis();
    let stale_threshold_ms = stale_after_secs.saturating_mul(1000) as i64;
    now_epoch_ms.saturating_sub(session.last_heartbeat_epoch_ms) > stale_threshold_ms
}

fn parse_epoch_ms(timestamp: &str) -> i64 {
    DateTime::parse_from_rfc3339(timestamp)
        .map(|ts| ts.timestamp_millis())
        .unwrap_or_else(|_| Utc::now().timestamp_millis())
}

fn remove_index_entry(index: &mut HashMap<String, BTreeSet<String>>, key: &str, session_id: &str) {
    let should_remove = if let Some(entries) = index.get_mut(key) {
        entries.remove(session_id);
        entries.is_empty()
    } else {
        false
    };
    if should_remove {
        index.remove(key);
    }
}

fn read_payload_string(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_room_target(room_id: &str) -> String {
    let normalized = room_id.trim();
    if normalized.starts_with("room:") {
        normalized.to_string()
    } else {
        format!("room:{normalized}")
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};
    use serde_json::json;

    use crate::realtime_contracts::{
        REALTIME_DELIVERY_SPEC_VERSION, REALTIME_EVENT_SPEC_VERSION, RealtimeDeliveryTarget,
        RealtimeDeliveryTargetKind, RealtimeEventEnvelopeV1, RealtimeTopic,
    };

    use super::RealtimeSessionRegistry;

    fn session_heartbeat(
        session_id: &str,
        user_id: Option<&str>,
        activity: &str,
        room_id: Option<&str>,
        emitted_at: String,
    ) -> RealtimeEventEnvelopeV1 {
        RealtimeEventEnvelopeV1 {
            spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
            event_id: "evt-1".to_string(),
            topic: RealtimeTopic::SessionHeartbeat,
            emitted_at,
            partition_key: user_id.unwrap_or(session_id).to_string(),
            trace_id: "trace-1".to_string(),
            source: "node_socket_io_compat".to_string(),
            session_id: session_id.to_string(),
            user_id: user_id.map(ToString::to_string),
            chat_id: None,
            payload: json!({
                "activity": activity,
                "roomId": room_id,
            }),
        }
    }

    fn session_opened(
        session_id: &str,
        user_id: Option<&str>,
        emitted_at: String,
    ) -> RealtimeEventEnvelopeV1 {
        RealtimeEventEnvelopeV1 {
            spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
            event_id: format!("evt-open-{session_id}"),
            topic: RealtimeTopic::SessionOpened,
            emitted_at: emitted_at.clone(),
            partition_key: user_id.unwrap_or(session_id).to_string(),
            trace_id: format!("trace-{session_id}"),
            source: "node_socket_io_compat".to_string(),
            session_id: session_id.to_string(),
            user_id: user_id.map(ToString::to_string),
            chat_id: None,
            payload: json!({ "connectedAt": emitted_at }),
        }
    }

    #[test]
    fn room_membership_tracks_join_and_leave() {
        let mut registry = RealtimeSessionRegistry::default();
        let now = Utc::now().to_rfc3339();
        registry.apply_session_opened(&session_opened("socket-1", Some("user-1"), now.clone()));
        registry.apply_session_heartbeat(&session_heartbeat(
            "socket-1",
            Some("user-1"),
            "room_joined",
            Some("room:group-1"),
            now.clone(),
        ));
        let joined = registry.snapshot(120);
        assert_eq!(joined.totals.room_subscriptions, 1);

        registry.apply_session_heartbeat(&session_heartbeat(
            "socket-1",
            Some("user-1"),
            "room_left",
            Some("room:group-1"),
            now,
        ));
        let left = registry.snapshot(120);
        assert_eq!(left.totals.room_subscriptions, 0);
    }

    #[test]
    fn resolves_user_room_and_socket_targets_with_exclusions() {
        let mut registry = RealtimeSessionRegistry::default();
        let now = Utc::now().to_rfc3339();
        for session_id in ["socket-1", "socket-2"] {
            registry.apply_session_opened(&session_opened(session_id, Some("user-1"), now.clone()));
            registry.apply_session_heartbeat(&session_heartbeat(
                session_id,
                Some("user-1"),
                "room_joined",
                Some("group-1"),
                now.clone(),
            ));
        }

        let room_target = RealtimeDeliveryTarget {
            kind: RealtimeDeliveryTargetKind::Room,
            id: Some("group-1".to_string()),
            exclude_socket_ids: vec!["socket-1".to_string()],
        };
        let user_target = RealtimeDeliveryTarget {
            kind: RealtimeDeliveryTargetKind::User,
            id: Some("user-1".to_string()),
            exclude_socket_ids: Vec::new(),
        };
        let socket_target = RealtimeDeliveryTarget {
            kind: RealtimeDeliveryTargetKind::Socket,
            id: Some("socket-2".to_string()),
            exclude_socket_ids: Vec::new(),
        };

        assert_eq!(
            registry.resolve_socket_targets(&room_target, 120),
            vec!["socket-2"]
        );
        assert_eq!(
            registry.resolve_socket_targets(&user_target, 120),
            vec!["socket-1", "socket-2"]
        );
        assert_eq!(
            registry.resolve_socket_targets(&socket_target, 120),
            vec!["socket-2"]
        );
        assert_eq!(REALTIME_DELIVERY_SPEC_VERSION, "realtime.delivery.v1");
    }

    #[test]
    fn stale_and_exclude_filters_apply_after_index_lookup() {
        let mut registry = RealtimeSessionRegistry::default();
        let fresh = Utc::now().to_rfc3339();
        let stale = (Utc::now() - Duration::seconds(300)).to_rfc3339();

        registry.apply_session_opened(&session_opened(
            "socket-fresh",
            Some("user-1"),
            fresh.clone(),
        ));
        registry.apply_session_heartbeat(&session_heartbeat(
            "socket-fresh",
            Some("user-1"),
            "room_joined",
            Some("room-a"),
            fresh,
        ));

        registry.apply_session_opened(&session_opened(
            "socket-stale",
            Some("user-1"),
            stale.clone(),
        ));
        registry.apply_session_heartbeat(&session_heartbeat(
            "socket-stale",
            Some("user-1"),
            "room_joined",
            Some("room-a"),
            stale,
        ));

        let room_target = RealtimeDeliveryTarget {
            kind: RealtimeDeliveryTargetKind::Room,
            id: Some("room-a".to_string()),
            exclude_socket_ids: vec!["socket-fresh".to_string()],
        };

        assert!(
            registry
                .resolve_socket_targets(&room_target, 120)
                .is_empty()
        );
    }

    #[test]
    fn snapshot_uses_user_index_and_preserves_totals_and_dedup() {
        let mut registry = RealtimeSessionRegistry::default();
        let now = Utc::now().to_rfc3339();

        registry.apply_session_opened(&session_opened("socket-1", Some("user-1"), now.clone()));
        registry.apply_session_heartbeat(&session_heartbeat(
            "socket-1",
            Some("user-1"),
            "room_joined",
            Some("room-a"),
            now.clone(),
        ));
        registry.apply_session_heartbeat(&session_heartbeat(
            "socket-1",
            Some("user-1"),
            "room_joined",
            Some("room-b"),
            now.clone(),
        ));

        registry.apply_session_opened(&session_opened("socket-2", Some("user-1"), now.clone()));
        registry.apply_session_heartbeat(&session_heartbeat(
            "socket-2",
            Some("user-1"),
            "room_joined",
            Some("room-a"),
            now.clone(),
        ));

        registry.apply_session_opened(&session_opened("socket-3", Some("user-2"), now.clone()));
        registry.apply_session_heartbeat(&session_heartbeat(
            "socket-3",
            Some("user-2"),
            "room_joined",
            Some("room-c"),
            now,
        ));

        let snapshot = registry.snapshot(120);
        assert_eq!(snapshot.totals.connected_sessions, 3);
        assert_eq!(snapshot.totals.authenticated_sessions, 3);
        assert_eq!(snapshot.totals.room_subscriptions, 4);

        let user_1 = snapshot
            .users
            .iter()
            .find(|user| user.user_id == "user-1")
            .unwrap();
        assert_eq!(user_1.connected_sessions, 2);
        assert_eq!(user_1.authenticated_sessions, 2);
        assert_eq!(user_1.room_subscriptions, 2);
        assert_eq!(user_1.session_ids, vec!["socket-1", "socket-2"]);
        assert_eq!(user_1.rooms, vec!["room:room-a", "room:room-b"]);
    }

    #[test]
    fn room_left_removes_room_index_membership() {
        let mut registry = RealtimeSessionRegistry::default();
        let now = Utc::now().to_rfc3339();

        registry.apply_session_opened(&session_opened("socket-1", Some("user-1"), now.clone()));
        registry.apply_session_heartbeat(&session_heartbeat(
            "socket-1",
            Some("user-1"),
            "room_joined",
            Some("room-z"),
            now.clone(),
        ));
        registry.apply_session_heartbeat(&session_heartbeat(
            "socket-1",
            Some("user-1"),
            "room_left",
            Some("room-z"),
            now,
        ));

        let room_target = RealtimeDeliveryTarget {
            kind: RealtimeDeliveryTargetKind::Room,
            id: Some("room-z".to_string()),
            exclude_socket_ids: Vec::new(),
        };
        assert!(
            registry
                .resolve_socket_targets(&room_target, 120)
                .is_empty()
        );
    }

    #[test]
    fn query_users_online_filters_unauthenticated_and_stale_sessions() {
        let mut registry = RealtimeSessionRegistry::default();
        let now = Utc::now().to_rfc3339();
        let stale_ts = (Utc::now() - Duration::seconds(200)).to_rfc3339();

        // 在线且已认证用户
        registry.apply_session_opened(&session_opened("s-online", Some("u-online"), now.clone()));
        // 仅连接但未认证用户
        registry.apply_session_opened(&session_opened("s-unauth", None, now));
        // 心跳已超时的陈旧会话
        registry.apply_session_opened(&session_opened("s-stale", Some("u-stale"), stale_ts));

        assert!(registry.is_user_online("u-online", 120));
        assert!(!registry.is_user_online("u-stale", 120));
        assert!(!registry.is_user_online("u-missing", 120));

        let batch = registry.query_users_online(
            &[
                "u-online".to_string(),
                "u-stale".to_string(),
                "u-missing".to_string(),
            ],
            120,
        );
        assert_eq!(batch.get("u-online"), Some(&true));
        assert_eq!(batch.get("u-stale"), Some(&false));
        assert_eq!(batch.get("u-missing"), Some(&false));
    }
}
