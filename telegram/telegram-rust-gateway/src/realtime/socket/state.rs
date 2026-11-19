use std::collections::{BTreeSet, HashMap};

use serde::Serialize;

use super::contracts::{normalize_group_room, presence_room, session_room, user_room};

const MAX_PRESENCE_SUBSCRIPTIONS_PER_SESSION: usize = 1000;

#[derive(Debug, Clone)]
pub struct RustSocketSessionRecord {
    pub session_id: String,
    pub user_id: Option<String>,
    pub username: Option<String>,
    pub access_token: Option<String>,
    pub joined_rooms: BTreeSet<String>,
    pub subscribed_presence_users: BTreeSet<String>,
}

/// 记录重认证前后房间订阅与用户归属的变化，用于驱动旧房间 `leave` 清理
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticateTransition {
    pub joined_rooms: Vec<String>,
    pub removed_rooms: Vec<String>,
    pub previous_user_id: Option<String>,
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
                subscribed_presence_users: BTreeSet::new(),
            });
    }

    /// 执行首次认证或重认证，更新缓存 `access_token` 并计算需要退出的旧房间集合
    pub fn authenticate_session(
        &mut self,
        session_id: &str,
        user_id: &str,
        username: &str,
        access_token: &str,
        group_ids: &[String],
    ) -> AuthenticateTransition {
        let sid_room = session_room(session_id);
        let record = self
            .sessions
            .entry(session_id.to_string())
            .or_insert_with(|| RustSocketSessionRecord {
                session_id: session_id.to_string(),
                user_id: None,
                username: None,
                access_token: None,
                joined_rooms: BTreeSet::from([sid_room.clone()]),
                subscribed_presence_users: BTreeSet::new(),
            });

        let previous_user_id = record.user_id.clone();
        let previous_rooms = record.joined_rooms.clone();

        let mut desired_rooms = BTreeSet::from([sid_room, user_room(user_id)]);
        for group_id in group_ids {
            let trimmed = group_id.trim();
            if !trimmed.is_empty() {
                desired_rooms.insert(normalize_group_room(trimmed));
            }
        }

        let mut removed_rooms = previous_rooms
            .difference(&desired_rooms)
            .cloned()
            .collect::<Vec<_>>();

        // 同连接切换账号重认证时，撤回旧账号登记过的所有在线状态订阅房间
        if let Some(prev_uid) = previous_user_id.as_deref()
            && prev_uid != user_id
        {
            for target_uid in std::mem::take(&mut record.subscribed_presence_users) {
                removed_rooms.push(presence_room(&target_uid));
            }
        }

        record.user_id = Some(user_id.to_string());
        record.username = Some(username.to_string());
        record.access_token = Some(access_token.to_string());
        record.joined_rooms = desired_rooms;

        AuthenticateTransition {
            joined_rooms: record.joined_rooms.iter().cloned().collect(),
            removed_rooms,
            previous_user_id,
        }
    }

    /// 记录会话新增订阅的在线状态目标，返回本次需 join 的 `presence:<user_id>` 房间列表
    pub fn add_presence_subscriptions(
        &mut self,
        session_id: &str,
        target_user_ids: &[String],
    ) -> Vec<String> {
        let Some(record) = self.sessions.get_mut(session_id) else {
            return Vec::new();
        };

        let mut newly_joined = Vec::new();
        for raw_uid in target_user_ids {
            if record.subscribed_presence_users.len() >= MAX_PRESENCE_SUBSCRIPTIONS_PER_SESSION {
                break;
            }
            let uid = raw_uid.trim();
            if uid.is_empty() {
                continue;
            }
            if record.subscribed_presence_users.insert(uid.to_string()) {
                newly_joined.push(presence_room(uid));
            }
        }
        newly_joined
    }

    pub fn authenticate(
        &mut self,
        session_id: &str,
        user_id: &str,
        username: &str,
        access_token: &str,
        group_ids: &[String],
    ) -> Vec<String> {
        self.authenticate_session(session_id, user_id, username, access_token, group_ids)
            .joined_rooms
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

    /// 检查当前连接是否已加入指定房间（用于输入状态等房间内广播门控）
    pub fn is_in_room(&self, session_id: &str, room: &str) -> bool {
        self.sessions
            .get(session_id)
            .map(|record| record.joined_rooms.contains(room))
            .unwrap_or(false)
    }

    /// 当令牌失效收到 401 时清理本地缓存的过期令牌
    pub fn clear_access_token(&mut self, session_id: &str) {
        if let Some(record) = self.sessions.get_mut(session_id) {
            record.access_token = None;
        }
    }

    /// 导出当前本机活跃连接快照，供后台周期续租循环刷新 Redis 租约
    pub fn active_sessions_snapshot(&self) -> Vec<(String, Option<String>, Vec<String>)> {
        self.sessions
            .values()
            .map(|record| {
                (
                    record.session_id.clone(),
                    record.user_id.clone(),
                    record.joined_rooms.iter().cloned().collect(),
                )
            })
            .collect()
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
    fn authenticate_replaces_group_membership_and_reports_removed_rooms() {
        let mut store = RustSocketSessionStore::default();
        store.register_connection("sid-1");
        let first = store.authenticate_session(
            "sid-1",
            "user-1",
            "alice",
            "token-1",
            &["group-1".to_string(), "group-2".to_string()],
        );

        assert!(first.removed_rooms.is_empty());
        assert!(first.joined_rooms.contains(&"sid:sid-1".to_string()));
        assert!(first.joined_rooms.contains(&"user:user-1".to_string()));
        assert!(first.joined_rooms.contains(&"room:group-1".to_string()));
        assert!(first.joined_rooms.contains(&"room:group-2".to_string()));
        assert!(store.is_in_room("sid-1", "room:group-1"));

        // 重发 authenticate 更新 token 并移除已退出的 group-2
        let second = store.authenticate_session(
            "sid-1",
            "user-1",
            "alice",
            "token-2",
            &["group-1".to_string()],
        );
        assert_eq!(second.removed_rooms, vec!["room:group-2".to_string()]);
        assert_eq!(store.access_token("sid-1").as_deref(), Some("token-2"));
        assert!(!store.is_in_room("sid-1", "room:group-2"));
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

    #[test]
    fn presence_subscriptions_deduplicate_and_clear_on_account_switch() {
        let mut store = RustSocketSessionStore::default();
        store.register_connection("sid-1");
        store.authenticate_session("sid-1", "user-1", "alice", "tok-1", &[]);

        let first_rooms = store.add_presence_subscriptions(
            "sid-1",
            &["u-a".to_string(), "u-b".to_string(), "u-a".to_string()],
        );
        assert_eq!(
            first_rooms,
            vec!["presence:u-a".to_string(), "presence:u-b".to_string()]
        );
        // 不得混入 active_sessions_snapshot 的群组房间集合
        let snapshot = store.active_sessions_snapshot();
        assert!(!snapshot[0].2.iter().any(|r| r.starts_with("presence:")));

        // 同账号刷新令牌保留订阅
        let same_user = store.authenticate_session("sid-1", "user-1", "alice", "tok-2", &[]);
        assert!(same_user.removed_rooms.is_empty());
        let repeat_rooms = store.add_presence_subscriptions("sid-1", &["u-a".to_string()]);
        assert!(repeat_rooms.is_empty());

        // 切换账号重认证清理旧订阅并返回 removed_rooms
        let switch_user = store.authenticate_session("sid-1", "user-2", "bob", "tok-3", &[]);
        assert!(
            switch_user
                .removed_rooms
                .contains(&"presence:u-a".to_string())
        );
        assert!(
            switch_user
                .removed_rooms
                .contains(&"presence:u-b".to_string())
        );
        let readd_rooms = store.add_presence_subscriptions("sid-1", &["u-a".to_string()]);
        assert_eq!(readd_rooms, vec!["presence:u-a".to_string()]);
    }
}
