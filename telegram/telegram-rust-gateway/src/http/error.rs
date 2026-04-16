use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GatewayError {
    #[error("authorization failed")]
    Unauthorized,
    #[error("too many requests")]
    RateLimited { retry_after_secs: u64 },
    #[error("upstream unavailable")]
    UpstreamUnavailable,
    #[error("internal server error")]
    Internal,
}

#[derive(Debug, Serialize)]
struct ErrorEnvelope<'a> {
    success: bool,
    error: ErrorPayload<'a>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload<'a> {
    code: &'a str,
    message: &'a str,
}

impl IntoResponse for GatewayError {
    fn into_response(self) -> Response {
        match self {
            GatewayError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                Json(ErrorEnvelope {
                    success: false,
                    error: ErrorPayload {
                        code: "UNAUTHORIZED",
                        message: "访问令牌无效或已过期",
                    },
                }),
            )
                .into_response(),
            GatewayError::RateLimited { retry_after_secs } => {
                let mut response = (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(ErrorEnvelope {
                        success: false,
                        error: ErrorPayload {
                            code: "RATE_LIMITED",
                            message: "请求过于频繁，请稍后重试",
                        },
                    }),
                )
                    .into_response();
                response.headers_mut().insert(
                    http::header::RETRY_AFTER,
                    retry_after_secs
                        .to_string()
                        .parse()
                        .unwrap_or_else(|_| http::HeaderValue::from_static("1")),
                );
                response
            }
            GatewayError::UpstreamUnavailable => (
                StatusCode::BAD_GATEWAY,
                Json(ErrorEnvelope {
                    success: false,
                    error: ErrorPayload {
                        code: "UPSTREAM_UNAVAILABLE",
                        message: "上游服务当前不可用",
                    },
                }),
            )
                .into_response(),
            GatewayError::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorEnvelope {
                    success: false,
                    error: ErrorPayload {
                        code: "INTERNAL_ERROR",
                        message: "网关内部错误",
                    },
                }),
            )
                .into_response(),
        }
    }
}
