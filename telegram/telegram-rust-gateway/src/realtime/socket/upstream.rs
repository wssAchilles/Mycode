use anyhow::{Context, Result, anyhow, bail};
use reqwest::StatusCode;
use serde_json::{Map, Value, json};

use crate::state::AppState;

use super::contracts::{
    ApiSuccessEnvelope, SendMessagePayload, UpstreamAuthMeData, UpstreamGroupSummary,
    UpstreamReadChatResponse,
};

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
    request_success_data(
        state,
        reqwest::Method::GET,
        "/api/auth/me",
        access_token,
        None,
    )
    .await
}

pub async fn fetch_user_groups(
    state: &AppState,
    access_token: &str,
) -> Result<Vec<UpstreamGroupSummary>> {
    request_success_data(
        state,
        reqwest::Method::GET,
        "/api/groups/my",
        access_token,
        None,
    )
    .await
}

pub async fn ensure_group_access(
    state: &AppState,
    access_token: &str,
    group_id: &str,
) -> Result<()> {
    let path = format!("/api/groups/{group_id}");
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
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND => Err(anyhow!("GROUP_ACCESS_DENIED")),
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
    let path = format!("/api/messages/chat/{chat_id}/read");
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
            .context("build authorization header")?,
    );
    validator
        .maybe_validate_bearer(&headers)
        .context("prevalidate access token")?
        .ok_or_else(|| anyhow!("missing access token"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{SendMessagePayload, build_send_message_body};

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
            file_url: None,
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
                "groupId": "group-1"
            })
        );
    }
}
