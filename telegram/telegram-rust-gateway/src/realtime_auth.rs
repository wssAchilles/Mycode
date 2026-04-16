use crate::realtime_contracts::RealtimeEventEnvelopeV1;

pub fn detect_auth_failure_class(envelope: &RealtimeEventEnvelopeV1) -> Option<String> {
    let failure_class = envelope
        .payload
        .get("authFailureClass")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    match failure_class {
        "auth_failed" | "expired" | "forbidden" | "degraded_accept" | "unknown" => {
            Some(failure_class.to_string())
        }
        _ => Some("unknown".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::json;

    use super::detect_auth_failure_class;
    use crate::realtime_contracts::{
        RealtimeEventEnvelopeV1, RealtimeTopic, REALTIME_EVENT_SPEC_VERSION,
    };

    #[test]
    fn maps_unknown_auth_failure_values_to_unknown() {
        let envelope = RealtimeEventEnvelopeV1 {
            spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
            event_id: "evt-auth-1".to_string(),
            topic: RealtimeTopic::SessionHeartbeat,
            emitted_at: Utc::now().to_rfc3339(),
            partition_key: "user-1".to_string(),
            trace_id: "trace-1".to_string(),
            source: "node_socket_io_compat".to_string(),
            session_id: "socket-1".to_string(),
            user_id: Some("user-1".to_string()),
            chat_id: None,
            payload: json!({ "authFailureClass": "totally_new_failure" }),
        };

        assert_eq!(
            detect_auth_failure_class(&envelope).as_deref(),
            Some("unknown")
        );
    }
}
