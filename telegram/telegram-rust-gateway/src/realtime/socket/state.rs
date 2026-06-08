use std::collections::{BTreeSet, HashMap};

use serde::Serialize;

use super::contracts::{normalize_group_room, session_room, user_room};

#[derive(Debug, Clone)]
pub struct RustSocketSessionRecord {
    pub session_id: String,
    pub user_id: Option<String>,
    pub username: Option<String>,
    pub access_token: Option<String>,
    pub joined_rooms: BTreeSet<String>,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RustSocketBackpressureSnapshot {
    pub outbound_queue_size: usize,
    pub max_outbound_queue_size: usize,
    pub dropped_event_count: u64,
    pub resume_gap_count: u64,
}

#[derive(Debug, Default, Clone)]
pub struct RustSocketSessionStore {
    sessions: HashMap<String, RustSocketSessionRecord>,
    backpressure: RustSocketBackpressureSnapshot,
}

impl RustSocketSessionStore {
    pub fn register_connection(&mut self, session_id: &str) {
        self.sessions
            .entry(session_id.to_string())
            .or_insert_with(|| RustSocketSessionRecord {
                session_id: session_id.to_string(),
                user_id: None,
                username: None,
                access_token: None,
                joined_rooms: BTreeSet::from([session_room(session_id)]),
            });
    }

    pub fn authenticate(
        &mut self,
        session_id: &str,
        user_id: &str,
        username: &str,
        access_token: &str,
        group_ids: &[String],
    ) -> Vec<String> {
        let record = self
            .sessions
            .entry(session_id.to_string())
            .or_insert_with(|| RustSocketSessionRecord {
                session_id: session_id.to_string(),
                user_id: None,
                username: None,
                access_token: None,
                joined_rooms: BTreeSet::from([session_room(session_id)]),
            });
        record.user_id = Some(user_id.to_string());
        record.username = Some(username.to_string());
        record.access_token = Some(access_token.to_string());
        record
            .joined_rooms
            .retain(|room| room == &session_room(session_id));
        record.joined_rooms.insert(user_room(user_id));
        for group_id in group_ids {
            record.joined_rooms.insert(normalize_group_room(group_id));
        }
        record.joined_rooms.iter().cloned().collect()
    }

    pub fn join_room(&mut self, session_id: &str, room_id: &str) -> Option<String> {
        let record = self.sessions.get_mut(session_id)?;
        let room = normalize_group_room(room_id);
        record.joined_rooms.insert(room.clone());
        Some(room)
    }

    pub fn leave_room(&mut self, session_id: &str, room_id: &str) -> Option<String> {
        let record = self.sessions.get_mut(session_id)?;
        let room = normalize_group_room(room_id);
        record.joined_rooms.remove(&room);
        Some(room)
    }

    pub fn access_token(&self, session_id: &str) -> Option<String> {
        self.sessions
            .get(session_id)
            .and_then(|record| record.access_token.clone())
    }

    pub fn username(&self, session_id: &str) -> Option<String> {
        self.sessions
            .get(session_id)
            .and_then(|record| record.username.clone())
    }

    pub fn user_id(&self, session_id: &str) -> Option<String> {
        self.sessions
            .get(session_id)
            .and_then(|record| record.user_id.clone())
    }

    pub fn joined_rooms(&self, session_id: &str) -> Vec<String> {
        self.sessions
            .get(session_id)
            .map(|record| record.joined_rooms.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn remove(&mut self, session_id: &str) -> Option<RustSocketSessionRecord> {
        self.sessions.remove(session_id)
    }

    pub fn record_outbound_queue_size(&mut self, queue_size: usize) {
        self.backpressure.outbound_queue_size = queue_size;
        self.backpressure.max_outbound_queue_size =
            self.backpressure.max_outbound_queue_size.max(queue_size);
    }

    pub fn record_dropped_event(&mut self) {
        self.backpressure.dropped_event_count += 1;
    }

    pub fn record_resume_gap(&mut self) {
        self.backpressure.resume_gap_count += 1;
    }

    pub fn backpressure_snapshot(&self) -> RustSocketBackpressureSnapshot {
        self.backpressure.clone()
    }

    pub fn local_authenticated_sessions_for_user(&self, user_id: &str) -> usize {
        self.sessions
            .values()
            .filter(|record| record.user_id.as_deref() == Some(user_id))
            .count()
    }
}

#[cfg(test)]
mod tests {
    use super::RustSocketSessionStore;

    #[test]
    fn authenticate_replaces_group_membership_and_keeps_sid_room() {
        let mut store = RustSocketSessionStore::default();
        store.register_connection("sid-1");
        let rooms = store.authenticate(
            "sid-1",
            "user-1",
            "alice",
            "token-1",
            &["group-1".to_string(), "group-2".to_string()],
        );

        assert!(rooms.contains(&"sid:sid-1".to_string()));
        assert!(rooms.contains(&"user:user-1".to_string()));
        assert!(rooms.contains(&"room:group-1".to_string()));
        assert!(rooms.contains(&"room:group-2".to_string()));
    }

    #[test]
    fn backpressure_snapshot_tracks_queue_drops_and_resume_gaps() {
        let mut store = RustSocketSessionStore::default();

        store.record_outbound_queue_size(3);
        store.record_outbound_queue_size(1);
        store.record_dropped_event();
        store.record_resume_gap();

        let snapshot = store.backpressure_snapshot();
        assert_eq!(snapshot.outbound_queue_size, 1);
        assert_eq!(snapshot.max_outbound_queue_size, 3);
        assert_eq!(snapshot.dropped_event_count, 1);
        assert_eq!(snapshot.resume_gap_count, 1);
    }
}
