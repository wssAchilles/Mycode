use axum::http::{HeaderMap, header};

use crate::{error::GatewayError, state::AppState};

pub fn verify_ops_token(state: &AppState, headers: &HeaderMap) -> Result<(), GatewayError> {
    let Some(expected) = state.config.ops_token.as_deref() else {
        return Ok(());
    };
    let from_header = headers
        .get("x-ops-token")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let from_bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "))
        })
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let provided = from_header.or(from_bearer).unwrap_or_default();
    if provided != expected {
        return Err(GatewayError::Unauthorized);
    }
    Ok(())
}
