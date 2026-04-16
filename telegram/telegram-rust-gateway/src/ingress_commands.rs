use serde::Serialize;

use crate::realtime_contracts::{RealtimeEventEnvelopeV1, RealtimeTopic};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngressCommandDescriptor {
    pub command: String,
    pub session_id: String,
    pub user_id: Option<String>,
    pub chat_id: Option<String>,
    pub event_id: String,
}

pub fn normalize_ingress_command(envelope: &RealtimeEventEnvelopeV1) -> Option<IngressCommandDescriptor> {
    let command = match envelope.topic {
        RealtimeTopic::TypingUpdated => "typing_updated",
        RealtimeTopic::MessageCommandRequested => "message_command_requested",
        RealtimeTopic::ReadAckRequested => "read_ack_requested",
        _ => return None,
    };

    Some(IngressCommandDescriptor {
        command: command.to_string(),
        session_id: envelope.session_id.clone(),
        user_id: envelope.user_id.clone(),
        chat_id: envelope.chat_id.clone(),
        event_id: envelope.event_id.clone(),
    })
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::json;

    use super::normalize_ingress_command;
    use crate::realtime_contracts::{
        RealtimeEventEnvelopeV1, RealtimeTopic, REALTIME_EVENT_SPEC_VERSION,
    };

    #[test]
    fn normalizes_message_command_events() {
        let envelope = RealtimeEventEnvelopeV1 {
            spec_version: REALTIME_EVENT_SPEC_VERSION.to_string(),
            event_id: "evt-msg-1".to_string(),
            topic: RealtimeTopic::MessageCommandRequested,
            emitted_at: Utc::now().to_rfc3339(),
            partition_key: "chat-1".to_string(),
            trace_id: "trace-1".to_string(),
            source: "node_socket_io_compat".to_string(),
            session_id: "socket-1".to_string(),
            user_id: Some("user-1".to_string()),
            chat_id: Some("chat-1".to_string()),
            payload: json!({ "chatType": "private" }),
        };

        let descriptor = normalize_ingress_command(&envelope).expect("descriptor");
        assert_eq!(descriptor.command, "message_command_requested");
        assert_eq!(descriptor.chat_id.as_deref(), Some("chat-1"));
    }
}
