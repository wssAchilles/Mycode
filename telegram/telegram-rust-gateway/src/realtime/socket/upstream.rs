use anyhow::{Context, Result, anyhow, bail};
use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::state::AppState;

use super::contracts::{
    SendMessagePayload, UpstreamAuthMeResponse, UpstreamGroupSummary, UpstreamGroupsResponse,
    UpstreamReadChatResponse, UpstreamSendMessageResponse,
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

pub async fn fetch_current_user(
    state: &AppState,
    access_token: &str,
) -> Result<UpstreamAuthMeResponse> {
    request_json(
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
    let response: UpstreamGroupsResponse = request_json(
        state,
        reqwest::Method::GET,
        "/api/groups/my",
        access_token,
        None,
    )
    .await?;
    Ok(response.groups)
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
) -> Result<UpstreamSendMessageResponse> {
    request_json(
        state,
        reqwest::Method::POST,
        "/api/messages/send",
        access_token,
        Some(json!({
            "content": payload.content,
            "clientTempId": payload.client_temp_id,
            "type": payload.r#type,
            "chatType": payload.chat_type,
            "receiverId": payload.receiver_id,
            "groupId": payload.group_id,
            "attachments": payload.attachments,
            "fileUrl": payload.file_url,
            "fileName": payload.file_name,
            "fileSize": payload.file_size,
            "mimeType": payload.mime_type,
            "thumbnailUrl": payload.thumbnail_url,
        })),
    )
    .await
}

pub async fn mark_chat_read(
    state: &AppState,
    access_token: &str,
    chat_id: &str,
    seq: u64,
) -> Result<UpstreamReadChatResponse> {
    let path = format!("/api/messages/chat/{chat_id}/read");
    request_json(
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
