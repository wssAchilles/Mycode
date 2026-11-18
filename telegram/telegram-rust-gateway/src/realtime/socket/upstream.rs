use std::sync::LazyLock;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use dashmap::DashMap;
use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};
use reqwest::StatusCode;
use serde_json::{Map, Value, json};
use thiserror::Error;

use crate::state::AppState;

use super::contracts::{
    ApiSuccessEnvelope, ParsedChatId, SendMessagePayload, UpstreamAuthMeData, UpstreamGroupSummary,
    UpstreamReadChatResponse, parse_chat_id,
};

pub const AUTH_ERROR_CODE: &str = "AUTH_ERROR";

const AUTH_METADATA_CACHE_TTL: Duration = Duration::from_secs(30);
const MAX_AUTH_CACHE_ENTRIES: usize = 4_096;

/// 上游路由保留词集合，防止通过 `joinRoom("my")` 命中 `/api/groups/my` 越权入房
const RESERVED_GROUP_SEGMENTS: [&str; 8] = [
    "my", "create", "public", "search", "health", "join", "leave", "members",
];

const PATH_SEGMENT_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'/')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}')
    .add(b'\\');

/// 标准认证失效错误，与前端 `AUTH_ERROR` 重认证及 HTTP Fallback 契约对齐
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum UpstreamAuthError {
    #[error("AUTH_ERROR")]
    Unauthorized,
}

static AUTH_ME_CACHE: LazyLock<DashMap<String, (Instant, UpstreamAuthMeData)>> =
    LazyLock::new(DashMap::new);
static USER_GROUPS_CACHE: LazyLock<DashMap<String, (Instant, Vec<UpstreamGroupSummary>)>> =
    LazyLock::new(DashMap::new);

/// 判断错误是否属于认证失效（401 或令牌无效/过期）
pub fn is_auth_error(err: &anyhow::Error) -> bool {
    err.downcast_ref::<UpstreamAuthError>().is_some() || err.to_string() == AUTH_ERROR_CODE
}

/// 当上游返回 401 时立即失效本地令牌元数据缓存
pub fn invalidate_token_caches(access_token: &str) {
    AUTH_ME_CACHE.remove(access_token);
    USER_GROUPS_CACHE.remove(access_token);
}

fn bounded_cache_insert<V: Clone>(
    cache: &DashMap<String, (Instant, V)>,
    key: String,
    value: V,
    ttl: Duration,
    max_entries: usize,
) {
    let now = Instant::now();
    if cache.len() >= max_entries / 2 {
        cache.retain(|_, (inserted_at, _)| now.duration_since(*inserted_at) < ttl);
    }
    if cache.len() >= max_entries
        && let Some(oldest_key) = cache
            .iter()
            .min_by_key(|entry| entry.value().0)
            .map(|entry| entry.key().clone())
    {
        cache.remove(&oldest_key);
    }
    cache.insert(key, (now, value));
}

fn is_safe_identifier_chars(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.contains("..")
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b':')
}

/// 严格校验并规范化 `group_id`（剥离可选 `room:` / `g:` 前缀，拒绝路径穿越与保留词，并编码路径段）
pub fn sanitize_group_id_segment(raw_group_id: &str) -> Result<String> {
    let mut clean = raw_group_id.trim();
    while let Some(stripped) = clean
        .strip_prefix("room:")
        .or_else(|| clean.strip_prefix("g:"))
    {
        clean = stripped.trim();
    }

    if !is_safe_identifier_chars(clean) || clean == "." || clean == ".." {
        bail!("INVALID_GROUP_ID");
    }

    let lower = clean.to_ascii_lowercase();
    if RESERVED_GROUP_SEGMENTS.contains(&lower.as_str()) {
        bail!("INVALID_GROUP_ID");
    }

    Ok(utf8_percent_encode(clean, PATH_SEGMENT_ENCODE_SET).to_string())
}

/// 严格校验并编码 `chat_id`（仅允许合法 `g:<groupId>` 或 `p:<uid1>:<uid2>` 结构，拒绝 `/` 与 `..`）
pub fn sanitize_chat_id_segment(raw_chat_id: &str) -> Result<String> {
    let trimmed = raw_chat_id.trim();
    if trimmed.is_empty() || trimmed.len() > 160 || trimmed.contains("..") || trimmed.contains('/')
    {
        bail!("INVALID_CHAT_ID");
    }

    match parse_chat_id(trimmed) {
        Some(ParsedChatId::Group { group_id }) => {
            let clean_gid = sanitize_group_id_segment(&group_id)?;
            let canonical = format!("g:{clean_gid}");
            Ok(utf8_percent_encode(&canonical, PATH_SEGMENT_ENCODE_SET).to_string())
        }
        Some(ParsedChatId::Private { user_ids }) => {
            if user_ids.len() != 2
                || !user_ids
                    .iter()
                    .all(|uid| is_safe_identifier_chars(uid) && !uid.contains(':'))
            {
                bail!("INVALID_CHAT_ID");
            }
            let canonical = format!("p:{}:{}", user_ids[0], user_ids[1]);
            Ok(utf8_percent_encode(&canonical, PATH_SEGMENT_ENCODE_SET).to_string())
        }
        None => bail!("INVALID_CHAT_ID"),
    }
}

async fn request_json<T: serde::de::DeserializeOwned>(
    state: &AppState,
    method: reqwest::Method,
    path: &str,
    access_token: &str,
    body: Option<Value>,
) -> Result<T> {
    let url = format!("{}{}", state.config.upstream_http, path);
    let mut request = state
        .client
        .request(method, &url)
        .bearer_auth(access_token)
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(payload) = body {
        request = request.json(&payload);
    }

    let response = request
        .send()
        .await
        .with_context(|| format!("send upstream request to {path}"))?;
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED {
        invalidate_token_caches(access_token);
        return Err(anyhow::Error::new(UpstreamAuthError::Unauthorized));
    }
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        bail!("upstream {path} returned {status}: {detail}");
    }

    response
        .json::<T>()
        .await
        .with_context(|| format!("decode upstream response from {path}"))
}

async fn request_success_data<T: serde::de::DeserializeOwned>(
    state: &AppState,
    method: reqwest::Method,
    path: &str,
    access_token: &str,
    body: Option<Value>,
) -> Result<T> {
    let envelope: ApiSuccessEnvelope<T> =
        request_json(state, method, path, access_token, body).await?;
    if !envelope.success {
        bail!("upstream {path} returned unsuccessful response envelope");
    }
    Ok(envelope.data)
}

pub async fn fetch_current_user(
    state: &AppState,
    access_token: &str,
) -> Result<UpstreamAuthMeData> {
    if let Some(entry) = AUTH_ME_CACHE.get(access_token) {
        if entry.0.elapsed() < AUTH_METADATA_CACHE_TTL {
            return Ok(entry.1.clone());
        }
        drop(entry);
        AUTH_ME_CACHE.remove(access_token);
    }

    let data: UpstreamAuthMeData = request_success_data(
        state,
        reqwest::Method::GET,
        "/api/auth/me",
        access_token,
        None,
    )
    .await?;

    bounded_cache_insert(
        &AUTH_ME_CACHE,
        access_token.to_string(),
        data.clone(),
        AUTH_METADATA_CACHE_TTL,
        MAX_AUTH_CACHE_ENTRIES,
    );
    Ok(data)
}

pub async fn fetch_user_groups(
    state: &AppState,
    access_token: &str,
) -> Result<Vec<UpstreamGroupSummary>> {
    if let Some(entry) = USER_GROUPS_CACHE.get(access_token) {
        if entry.0.elapsed() < AUTH_METADATA_CACHE_TTL {
            return Ok(entry.1.clone());
        }
        drop(entry);
        USER_GROUPS_CACHE.remove(access_token);
    }

    let data: Vec<UpstreamGroupSummary> = request_success_data(
        state,
        reqwest::Method::GET,
        "/api/groups/my",
        access_token,
        None,
    )
    .await?;

    bounded_cache_insert(
        &USER_GROUPS_CACHE,
        access_token.to_string(),
        data.clone(),
        AUTH_METADATA_CACHE_TTL,
        MAX_AUTH_CACHE_ENTRIES,
    );
    Ok(data)
}

pub async fn ensure_group_access(
    state: &AppState,
    access_token: &str,
    group_id: &str,
) -> Result<()> {
    let safe_group_id = sanitize_group_id_segment(group_id)?;
    let path = format!("/api/groups/{safe_group_id}");
    let url = format!("{}{}", state.config.upstream_http, path);
    let response = state
        .client
        .get(url)
        .bearer_auth(access_token)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .context("send upstream group access request")?;

    match response.status() {
        StatusCode::OK => Ok(()),
        StatusCode::UNAUTHORIZED => {
            invalidate_token_caches(access_token);
            Err(anyhow::Error::new(UpstreamAuthError::Unauthorized))
        }
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND | StatusCode::BAD_REQUEST => {
            Err(anyhow!("GROUP_ACCESS_DENIED"))
        }
        status => {
            let detail = response.text().await.unwrap_or_default();
            Err(anyhow!("group access probe returned {status}: {detail}"))
        }
    }
}

pub async fn send_message(
    state: &AppState,
    access_token: &str,
    payload: &SendMessagePayload,
) -> Result<Value> {
    validate_auth_precheck(state, access_token)?;
    request_success_data(
        state,
        reqwest::Method::POST,
        "/api/messages/send",
        access_token,
        Some(build_send_message_body(payload)),
    )
    .await
}

fn insert_optional_string(body: &mut Map<String, Value>, key: &str, value: &Option<String>) {
    if let Some(value) = value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body.insert(key.to_string(), Value::String(value.to_string()));
    }
}

fn build_send_message_body(payload: &SendMessagePayload) -> Value {
    let mut body = Map::new();
    body.insert(
        "content".to_string(),
        Value::String(payload.content.clone()),
    );
    body.insert(
        "chatType".to_string(),
        Value::String(payload.chat_type.clone()),
    );
    body.insert(
        "type".to_string(),
        Value::String(payload.r#type.clone().unwrap_or_else(|| "text".to_string())),
    );
    insert_optional_string(&mut body, "clientTempId", &payload.client_temp_id);
    insert_optional_string(&mut body, "receiverId", &payload.receiver_id);
    insert_optional_string(&mut body, "groupId", &payload.group_id);
    insert_optional_string(&mut body, "fileUrl", &payload.file_url);
    insert_optional_string(&mut body, "fileName", &payload.file_name);
    insert_optional_string(&mut body, "mimeType", &payload.mime_type);
    insert_optional_string(&mut body, "thumbnailUrl", &payload.thumbnail_url);
    if let Some(file_size) = payload.file_size {
        body.insert("fileSize".to_string(), Value::from(file_size));
    }
    if let Some(attachments) = payload
        .attachments
        .as_ref()
        .filter(|items| !items.is_empty())
    {
        body.insert("attachments".to_string(), Value::Array(attachments.clone()));
    }
    Value::Object(body)
}

pub async fn mark_chat_read(
    state: &AppState,
    access_token: &str,
    chat_id: &str,
    seq: u64,
) -> Result<UpstreamReadChatResponse> {
    validate_auth_precheck(state, access_token)?;
    let safe_chat_id = sanitize_chat_id_segment(chat_id)?;
    let path = format!("/api/messages/chat/{safe_chat_id}/read");
    request_success_data(
        state,
        reqwest::Method::POST,
        &path,
        access_token,
        Some(json!({ "seq": seq })),
    )
    .await
}

pub fn validate_auth_precheck(state: &AppState, access_token: &str) -> Result<()> {
    if !state.config.validate_access_tokens {
        return Ok(());
    }
    let Some(validator) = state.jwt_validator.as_ref() else {
        bail!("JWT validator unavailable");
    };
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&format!("Bearer {access_token}"))
            .map_err(|_| anyhow::Error::new(UpstreamAuthError::Unauthorized))?,
    );
    validator
        .maybe_validate_bearer(&headers)
        .map_err(|_| {
            invalidate_token_caches(access_token);
            anyhow::Error::new(UpstreamAuthError::Unauthorized)
        })?
        .ok_or_else(|| anyhow::Error::new(UpstreamAuthError::Unauthorized))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        SendMessagePayload, UpstreamAuthError, build_send_message_body, is_auth_error,
        sanitize_chat_id_segment, sanitize_group_id_segment,
    };

    #[test]
    fn send_message_body_omits_absent_optional_fields() {
        let payload = SendMessagePayload {
            content: "hello".to_string(),
            client_temp_id: Some("temp-1".to_string()),
            r#type: Some("text".to_string()),
            chat_type: "group".to_string(),
            receiver_id: None,
            group_id: Some("group-1".to_string()),
            attachments: None,
            file_url: Some("/api/uploads/photo.png".to_string()),
            file_name: None,
            file_size: None,
            mime_type: None,
            thumbnail_url: None,
        };

        assert_eq!(
            build_send_message_body(&payload),
            json!({
                "content": "hello",
                "clientTempId": "temp-1",
                "type": "text",
                "chatType": "group",
                "groupId": "group-1",
                "fileUrl": "/api/uploads/photo.png"
            })
        );
    }

    #[test]
    fn sanitizes_group_and_chat_ids_and_rejects_traversal_or_reserved_words() {
        assert_eq!(
            sanitize_group_id_segment("room:15776659-176c-4a97-8146-c6a24d85fb96").unwrap(),
            "15776659-176c-4a97-8146-c6a24d85fb96"
        );
        assert!(sanitize_group_id_segment("my").is_err());
        assert!(sanitize_group_id_segment("room:MY").is_err());
        assert!(sanitize_group_id_segment("../auth/me").is_err());
        assert!(sanitize_group_id_segment("group/evil").is_err());

        assert_eq!(
            sanitize_chat_id_segment("g:15776659-176c-4a97-8146-c6a24d85fb96").unwrap(),
            "g:15776659-176c-4a97-8146-c6a24d85fb96"
        );
        assert_eq!(
            sanitize_chat_id_segment("p:user-1:user-2").unwrap(),
            "p:user-1:user-2"
        );
        assert!(sanitize_chat_id_segment("g:../auth/me").is_err());
        assert!(sanitize_chat_id_segment("g:my").is_err());
        assert!(sanitize_chat_id_segment("../internal/health").is_err());
    }

    #[test]
    fn classifies_unauthorized_error_as_auth_error() {
        let err = anyhow::Error::new(UpstreamAuthError::Unauthorized);
        assert!(is_auth_error(&err));
        assert_eq!(err.to_string(), "AUTH_ERROR");
    }
}
