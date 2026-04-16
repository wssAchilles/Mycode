use std::collections::BTreeMap;

use serde::Serialize;

use crate::realtime_contracts::RealtimeEventEnvelopeV1;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceSnapshot {
    pub state_counts: BTreeMap<String, usize>,
    pub last_updated_at: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct PresenceRouter {
    states: BTreeMap<String, String>,
    last_updated_at: Option<String>,
}

impl PresenceRouter {
    pub fn apply_presence_update(&mut self, envelope: &RealtimeEventEnvelopeV1) {
        let Some(user_id) = envelope.user_id.as_ref() else {
            return;
        };
        let status = envelope
            .payload
            .get("status")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("unknown");
        if status == "offline" {
            self.states.remove(user_id);
        } else {
            self.states.insert(user_id.clone(), status.to_string());
        }
        self.last_updated_at = Some(envelope.emitted_at.clone());
    }

    pub fn snapshot(&self) -> PresenceSnapshot {
        let mut state_counts = BTreeMap::new();
        for status in self.states.values() {
            *state_counts.entry(status.clone()).or_insert(0) += 1;
        }
        PresenceSnapshot {
            state_counts,
            last_updated_at: self.last_updated_at.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::json;

    use crate::realtime_contracts::{RealtimeEventEnvelopeV1, RealtimeTopic, REALTIME_EVENT_SPEC_VERSION};

    use super::PresenceRouter;

    #[test]
    fn offline_updates_clear_presence_state() {
        let mut router = PresenceRouter::default();
        let online = RealtimeEventEnvelopeV1 {
            spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
            event_id: "evt-presence-online".to_string(),
            topic: RealtimeTopic::PresenceUpdated,
            emitted_at: Utc::now().to_rfc3339(),
            partition_key: "user-1".to_string(),
            trace_id: "trace-1".to_string(),
            source: "node_socket_io_compat".to_string(),
            session_id: "socket-1".to_string(),
            user_id: Some("user-1".to_string()),
            chat_id: None,
            payload: json!({ "status": "online" }),
        };
        router.apply_presence_update(&online);
        assert_eq!(router.snapshot().state_counts.get("online"), Some(&1));

        let offline = RealtimeEventEnvelopeV1 {
            payload: json!({ "status": "offline" }),
            ..online
        };
        router.apply_presence_update(&offline);
        assert!(router.snapshot().state_counts.is_empty());
    }
}
