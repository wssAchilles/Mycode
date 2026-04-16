use std::collections::{BTreeSet, HashMap};

use chrono::Utc;
use serde::Serialize;
use serde_json::Value;

use crate::realtime_contracts::RealtimeEventEnvelopeV1;

#[derive(Debug, Clone)]
struct SessionRecord {
    session_id: String,
    user_id: Option<String>,
    authenticated: bool,
    rooms: BTreeSet<String>,
    last_heartbeat_at: String,
    last_event_at: String,
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
}

#[derive(Debug, Default, Clone)]
pub struct RealtimeSessionRegistry {
    sessions: HashMap<String, SessionRecord>,
}

impl RealtimeSessionRegistry {
    pub fn apply_session_opened(&mut self, envelope: &RealtimeEventEnvelopeV1) {
        let record = self.sessions.entry(envelope.session_id.clone()).or_insert(SessionRecord {
            session_id: envelope.session_id.clone(),
            user_id: envelope.user_id.clone(),
            authenticated: envelope.user_id.is_some(),
            rooms: BTreeSet::new(),
            last_heartbeat_at: envelope.emitted_at.clone(),
            last_event_at: envelope.emitted_at.clone(),
            source: envelope.source.clone(),
        });
        record.user_id = envelope.user_id.clone().or_else(|| record.user_id.clone());
        record.authenticated = record.user_id.is_some();
        record.last_event_at = envelope.emitted_at.clone();
        record.last_heartbeat_at = envelope.emitted_at.clone();
        record.source = envelope.source.clone();
    }

    pub fn apply_session_closed(&mut self, envelope: &RealtimeEventEnvelopeV1) {
        self.sessions.remove(&envelope.session_id);
    }

    pub fn apply_session_heartbeat(&mut self, envelope: &RealtimeEventEnvelopeV1) {
        let record = self.sessions.entry(envelope.session_id.clone()).or_insert(SessionRecord {
            session_id: envelope.session_id.clone(),
            user_id: envelope.user_id.clone(),
            authenticated: envelope.user_id.is_some(),
            rooms: BTreeSet::new(),
            last_heartbeat_at: envelope.emitted_at.clone(),
            last_event_at: envelope.emitted_at.clone(),
            source: envelope.source.clone(),
        });
        record.user_id = envelope.user_id.clone().or_else(|| record.user_id.clone());
        record.authenticated = record.user_id.is_some();
        record.last_event_at = envelope.emitted_at.clone();
        record.last_heartbeat_at = envelope.emitted_at.clone();
        if let Some(room_id) = read_payload_string(&envelope.payload, "roomId") {
            match read_payload_string(&envelope.payload, "activity").as_deref() {
                Some("room_left") => {
                    record.rooms.remove(&room_id);
                }
                _ => {
                    record.rooms.insert(room_id);
                }
            }
        }
    }

    pub fn snapshot(&self, stale_after_secs: u64) -> RealtimeRegistrySnapshot {
        let users = self
            .sessions
            .values()
            .filter_map(|session| session.user_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(|user_id| self.user_snapshot(&user_id, stale_after_secs))
            .collect::<Vec<_>>();

        let totals = self.sessions.values().fold(
            RealtimeRegistryTotals {
                connected_sessions: 0,
                authenticated_sessions: 0,
                room_subscriptions: 0,
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
        self.sessions.values().map(|session| session.rooms.len()).sum()
    }
}

fn is_stale(session: &SessionRecord, stale_after_secs: u64) -> bool {
    let now = Utc::now();
    let Ok(last_heartbeat) = chrono::DateTime::parse_from_rfc3339(&session.last_heartbeat_at) else {
        return false;
    };
    let stale_threshold = chrono::Duration::seconds(stale_after_secs as i64);
    now.signed_duration_since(last_heartbeat.with_timezone(&Utc)) > stale_threshold
}

fn read_payload_string(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

impl RealtimeSessionRegistry {
    fn user_snapshot(&self, user_id: &str, stale_after_secs: u64) -> RealtimeUserSessionSnapshot {
        let mut session_ids = Vec::new();
        let mut rooms = BTreeSet::new();
        let mut authenticated_sessions = 0usize;

        for session in self.sessions.values() {
            if session.user_id.as_deref() != Some(user_id) || is_stale(session, stale_after_secs) {
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
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::json;

    use crate::realtime_contracts::{RealtimeEventEnvelopeV1, RealtimeTopic, REALTIME_EVENT_SPEC_VERSION};

    use super::RealtimeSessionRegistry;

    fn session_heartbeat(activity: &str, room_id: Option<&str>) -> RealtimeEventEnvelopeV1 {
        RealtimeEventEnvelopeV1 {
            spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
            event_id: "evt-1".to_string(),
            topic: RealtimeTopic::SessionHeartbeat,
            emitted_at: Utc::now().to_rfc3339(),
            partition_key: "user-1".to_string(),
            trace_id: "trace-1".to_string(),
            source: "node_socket_io_compat".to_string(),
            session_id: "socket-1".to_string(),
            user_id: Some("user-1".to_string()),
            chat_id: None,
            payload: json!({
                "activity": activity,
                "roomId": room_id,
            }),
        }
    }

    #[test]
    fn room_membership_tracks_join_and_leave() {
        let mut registry = RealtimeSessionRegistry::default();
        registry.apply_session_opened(&RealtimeEventEnvelopeV1 {
            spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
            event_id: "evt-open".to_string(),
            topic: RealtimeTopic::SessionOpened,
            emitted_at: Utc::now().to_rfc3339(),
            partition_key: "socket-1".to_string(),
            trace_id: "trace-open".to_string(),
            source: "node_socket_io_compat".to_string(),
            session_id: "socket-1".to_string(),
            user_id: Some("user-1".to_string()),
            chat_id: None,
            payload: json!({ "connectedAt": Utc::now().to_rfc3339() }),
        });

        registry.apply_session_heartbeat(&session_heartbeat("room_joined", Some("room:group-1")));
        let joined = registry.snapshot(120);
        assert_eq!(joined.totals.room_subscriptions, 1);

        registry.apply_session_heartbeat(&session_heartbeat("room_left", Some("room:group-1")));
        let left = registry.snapshot(120);
        assert_eq!(left.totals.room_subscriptions, 0);
    }
}
