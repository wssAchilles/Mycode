use anyhow::{Result, anyhow};
use chrono::Utc;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    realtime::socket::contracts::{
        ROOM_MESSAGE_SCHEMA_VERSION, TypingServerPayload, normalize_group_room, session_room,
        user_room,
    },
    realtime_contracts::{
        REALTIME_COMPAT_DISPATCH_SPEC_VERSION, RealtimeCompatDispatchEnvelopeV1,
        RealtimeCompatDispatchTarget, RealtimeDeliveryEnvelopeV1, RealtimeDeliveryTopic,
    },
    state::AppState,
};

pub async fn emit_direct_delivery(
    state: &AppState,
    envelope: &RealtimeDeliveryEnvelopeV1,
    resolved_count: usize,
) -> Result<RealtimeCompatDispatchEnvelopeV1> {
    let io = state
        .realtime_socket_io
        .as_ref()
        .ok_or_else(|| anyhow!("rust socket terminator unavailable"))?;
    let emitted_at = Utc::now().to_rfc3339();

    match envelope.topic {
        RealtimeDeliveryTopic::Typing => {
            let is_typing = envelope
                .payload
                .get("isTyping")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let event_name = if is_typing {
                "typingStart"
            } else {
                "typingStop"
            };
            let payload = TypingServerPayload {
                user_id: read_string(&envelope.payload, "userId").unwrap_or_default(),
                username: read_string(&envelope.payload, "username")
                    .unwrap_or_else(|| "Unknown".to_string()),
                group_id: read_string(&envelope.payload, "groupId"),
            };
            emit_named_event(io, envelope, event_name, &payload).await?;
        }
        _ => {
            let batch_payload = vec![json!({
                "type": batch_event_name(envelope.topic),
                "payload": translate_delivery_payload(&envelope.payload, envelope.topic),
            })];
            emit_named_event(io, envelope, "realtimeBatch", &batch_payload).await?;
        }
    }

    Ok(RealtimeCompatDispatchEnvelopeV1 {
        spec_version: REALTIME_COMPAT_DISPATCH_SPEC_VERSION.to_string(),
        dispatch_id: Uuid::new_v4().to_string(),
        emitted_at,
        trace_id: envelope.trace_id.clone(),
        source: "rust_socket_io_compat".to_string(),
        topic: envelope.topic,
        target: RealtimeCompatDispatchTarget {
            requested_kind: envelope.target.kind,
            requested_id: envelope.target.id.clone(),
            resolved_count,
            socket_ids: Vec::new(),
        },
        payload: envelope.payload.clone(),
    })
}

async fn emit_named_event<T: serde::Serialize>(
    io: &socketioxide::SocketIo,
    envelope: &RealtimeDeliveryEnvelopeV1,
    event_name: &str,
    payload: &T,
) -> Result<()> {
    match envelope.target.kind {
        crate::realtime_contracts::RealtimeDeliveryTargetKind::Socket => {
            if let Some(target_id) = envelope.target.id.as_deref() {
                io.within(session_room(target_id))
                    .emit(event_name, payload)
                    .await
                    .map_err(|err| anyhow!(err.to_string()))?;
            }
        }
        crate::realtime_contracts::RealtimeDeliveryTargetKind::User => {
            if let Some(target_id) = envelope.target.id.as_deref() {
                io.within(user_room(target_id))
                    .emit(event_name, payload)
                    .await
                    .map_err(|err| anyhow!(err.to_string()))?;
            }
        }
        crate::realtime_contracts::RealtimeDeliveryTargetKind::Room => {
            if let Some(target_id) = envelope.target.id.as_deref() {
                let mut operator = io.within(normalize_group_room(target_id));
                for socket_id in &envelope.target.exclude_socket_ids {
                    operator = operator.except(session_room(socket_id));
                }
                operator
                    .emit(event_name, payload)
                    .await
                    .map_err(|err| anyhow!(err.to_string()))?;
            }
        }
        crate::realtime_contracts::RealtimeDeliveryTargetKind::Broadcast => {
            if envelope.target.exclude_socket_ids.is_empty() {
                io.emit(event_name, payload)
                    .await
                    .map_err(|err| anyhow!(err.to_string()))?;
            } else {
                let rooms = envelope
                    .target
                    .exclude_socket_ids
                    .iter()
                    .map(|socket_id| session_room(socket_id))
                    .collect::<Vec<_>>();
                io.except(rooms)
                    .emit(event_name, payload)
                    .await
                    .map_err(|err| anyhow!(err.to_string()))?;
            }
        }
    }

    Ok(())
}

fn batch_event_name(topic: RealtimeDeliveryTopic) -> &'static str {
    match topic {
        RealtimeDeliveryTopic::Message => "message",
        RealtimeDeliveryTopic::Presence => "presence",
        RealtimeDeliveryTopic::Typing => "typing",
        RealtimeDeliveryTopic::ReadReceipt => "readReceipt",
        RealtimeDeliveryTopic::GroupUpdate => "groupUpdate",
    }
}

fn translate_delivery_payload(payload: &Value, topic: RealtimeDeliveryTopic) -> Value {
    if matches!(topic, RealtimeDeliveryTopic::Message)
        && payload.get("schemaVersion").and_then(Value::as_str) == Some(ROOM_MESSAGE_SCHEMA_VERSION)
    {
        return translate_room_message_payload(payload);
    }
    payload.clone()
}

fn translate_room_message_payload(payload: &Value) -> Value {
    let display = payload
        .get("displayEnvelope")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let chat_type = read_string(payload, "chatType").unwrap_or_else(|| "private".to_string());
    let media_type = read_nested_string(&display, &["type"])
        .or_else(|| read_nested_string(&display, &["mediaMetaLite", "type"]))
        .unwrap_or_else(|| "text".to_string());
    let status = read_nested_string(&display, &["status"])
        .or_else(|| read_nested_string(&display, &["serviceFlags", "status"]))
        .unwrap_or_else(|| "delivered".to_string());

    json!({
        "id": read_string(payload, "messageId"),
        "chatId": read_string(payload, "chatId"),
        "chatType": chat_type,
        "groupId": read_nested_string(&display, &["groupId"]),
        "seq": payload.get("seq").cloned().unwrap_or_else(|| json!(0)),
        "content": read_nested_string(&display, &["text"]).unwrap_or_default(),
        "senderId": read_string(payload, "senderId"),
        "senderUsername": read_string(payload, "senderUsername").unwrap_or_else(|| "未知用户".to_string()),
        "userId": read_string(payload, "senderId"),
        "username": read_string(payload, "senderUsername").unwrap_or_else(|| "未知用户".to_string()),
        "receiverId": read_nested_string(&display, &["receiverId"]),
        "timestamp": read_string(payload, "createdAt").unwrap_or_else(|| Utc::now().to_rfc3339()),
        "type": media_type,
        "isGroupChat": display
            .get("serviceFlags")
            .and_then(|flags| flags.get("isGroupChat"))
            .and_then(Value::as_bool)
            .unwrap_or(chat_type == "group"),
        "status": status,
        "attachments": display.get("attachments").cloned(),
        "fileUrl": read_nested_string(&display, &["fileUrl"]),
        "fileName": read_nested_string(&display, &["fileName"]),
        "fileSize": display.get("fileSize").cloned(),
        "mimeType": read_nested_string(&display, &["mimeType"]),
        "thumbnailUrl": read_nested_string(&display, &["thumbnailUrl"]),
        "clientTempId": read_string(payload, "clientTempId"),
    })
}

fn read_string(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn read_nested_string(payload: &Value, path: &[&str]) -> Option<String> {
    let mut current = payload;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::realtime_contracts::RealtimeDeliveryTopic;

    use super::translate_delivery_payload;

    #[test]
    fn translates_room_message_payload_to_frontend_shape() {
        let translated = translate_delivery_payload(
            &json!({
                "schemaVersion": "room_message.v1",
                "chatId": "g:group-1",
                "messageId": "message-1",
                "seq": 42,
                "senderId": "user-1",
                "senderUsername": "alice",
                "chatType": "group",
                "createdAt": "2026-01-01T00:00:00Z",
                "clientTempId": "temp-1",
                "displayEnvelope": {
                    "text": "hello",
                    "groupId": "group-1",
                    "type": "text",
                    "serviceFlags": {
                        "isGroupChat": true,
                        "status": "delivered"
                    }
                }
            }),
            RealtimeDeliveryTopic::Message,
        );

        assert_eq!(
            translated.get("id").and_then(|value| value.as_str()),
            Some("message-1")
        );
        assert_eq!(
            translated.get("chatId").and_then(|value| value.as_str()),
            Some("g:group-1")
        );
        assert_eq!(
            translated.get("groupId").and_then(|value| value.as_str()),
            Some("group-1")
        );
        assert_eq!(
            translated
                .get("clientTempId")
                .and_then(|value| value.as_str()),
            Some("temp-1")
        );
    }
}
