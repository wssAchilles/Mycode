use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const RUST_SOCKET_IO_COMPAT_SOURCE: &str = "rust_socket_io_compat";
pub const ROOM_MESSAGE_SCHEMA_VERSION: &str = "room_message.v1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatePayload {
    pub token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomRequestPayload {
    pub room_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessagePayload {
    pub content: String,
    pub client_temp_id: Option<String>,
    pub r#type: Option<String>,
    pub chat_type: String,
    pub receiver_id: Option<String>,
    pub group_id: Option<String>,
    pub attachments: Option<Vec<Value>>,
    pub file_url: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<u64>,
    pub mime_type: Option<String>,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadChatPayload {
    pub chat_id: String,
    pub seq: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypingPayload {
    pub receiver_id: Option<String>,
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketMessageAck {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_temp_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl SocketMessageAck {
    pub fn ok(
        message_id: Option<String>,
        seq: Option<u64>,
        client_temp_id: Option<String>,
    ) -> Self {
        Self {
            success: true,
            client_temp_id,
            message_id,
            seq,
            error: None,
        }
    }

    pub fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            client_temp_id: None,
            message_id: None,
            seq: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpstreamAuthMeResponse {
    pub user: UpstreamAuthUser,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpstreamAuthUser {
    pub id: String,
    pub username: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpstreamGroupsResponse {
    #[serde(default)]
    pub groups: Vec<UpstreamGroupSummary>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpstreamGroupSummary {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpstreamSendMessageResponse {
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamReadChatResponse {
    pub chat_id: String,
    pub seq: u64,
    pub read_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypingServerPayload {
    pub user_id: String,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

pub fn session_room(session_id: &str) -> String {
    format!("sid:{session_id}")
}

pub fn user_room(user_id: &str) -> String {
    format!("user:{user_id}")
}

pub fn normalize_group_room(room_id: &str) -> String {
    let normalized = room_id.trim();
    if normalized.starts_with("room:") {
        normalized.to_string()
    } else {
        format!("room:{normalized}")
    }
}

pub fn read_message_id(payload: &Value) -> Option<String> {
    payload
        .get("_id")
        .or_else(|| payload.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub fn read_seq(payload: &Value) -> Option<u64> {
    payload.get("seq").and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_i64().map(|seq| seq.max(0) as u64))
    })
}

pub fn parse_chat_id(chat_id: &str) -> Option<ParsedChatId> {
    let normalized = chat_id.trim();
    if let Some(rest) = normalized.strip_prefix("g:") {
        if rest.is_empty() {
            return None;
        }
        return Some(ParsedChatId::Group {
            group_id: rest.to_string(),
        });
    }
    if let Some(rest) = normalized.strip_prefix("p:") {
        let user_ids = rest
            .split(':')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        if user_ids.len() < 2 {
            return None;
        }
        return Some(ParsedChatId::Private { user_ids });
    }
    None
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedChatId {
    Group { group_id: String },
    Private { user_ids: Vec<String> },
}

pub fn other_private_user_id(chat_id: &str, user_id: &str) -> Option<String> {
    match parse_chat_id(chat_id)? {
        ParsedChatId::Private { user_ids } => user_ids.into_iter().find(|id| id != user_id),
        ParsedChatId::Group { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        ParsedChatId, normalize_group_room, other_private_user_id, parse_chat_id, read_message_id,
        read_seq,
    };

    #[test]
    fn normalizes_group_room_ids() {
        assert_eq!(normalize_group_room("group-1"), "room:group-1");
        assert_eq!(normalize_group_room("room:group-1"), "room:group-1");
    }

    #[test]
    fn parses_chat_ids() {
        assert_eq!(
            parse_chat_id("g:room-1"),
            Some(ParsedChatId::Group {
                group_id: "room-1".to_string(),
            })
        );
        assert_eq!(
            parse_chat_id("p:user-b:user-a"),
            Some(ParsedChatId::Private {
                user_ids: vec!["user-b".to_string(), "user-a".to_string()],
            })
        );
    }

    #[test]
    fn resolves_other_private_user() {
        assert_eq!(
            other_private_user_id("p:user-a:user-b", "user-a"),
            Some("user-b".to_string())
        );
    }

    #[test]
    fn reads_message_id_and_seq_from_payload() {
        let payload = json!({
            "_id": "message-1",
            "seq": 42
        });
        assert_eq!(read_message_id(&payload), Some("message-1".to_string()));
        assert_eq!(read_seq(&payload), Some(42));
    }
}
