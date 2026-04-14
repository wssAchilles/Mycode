use std::{env, net::SocketAddr};

use anyhow::{Context, Result, bail};

#[derive(Debug, Clone)]
pub struct GatewayConfig {
    pub bind_addr: SocketAddr,
    pub upstream_http: String,
    pub ops_token: Option<String>,
    pub jwt_secret: Option<String>,
    pub validate_access_tokens: bool,
    pub trust_x_forwarded_for: bool,
    pub rate_limit_capacity: f64,
    pub rate_limit_refill_per_sec: f64,
    pub request_timeout_secs: u64,
    pub sync_request_timeout_secs: u64,
}

impl GatewayConfig {
    pub fn from_env() -> Result<Self> {
        let bind_addr = read_socket_addr("GATEWAY_BIND_ADDR", "0.0.0.0:4000")?;
        let upstream_http =
            normalize_base_url(read_string("GATEWAY_UPSTREAM_HTTP", "http://backend:5000"));
        let ops_token = read_optional_string("GATEWAY_OPS_TOKEN")
            .or_else(|| read_optional_string("OPS_METRICS_TOKEN"));
        let jwt_secret = read_optional_string("JWT_SECRET");
        let validate_access_tokens = read_bool("GATEWAY_VALIDATE_ACCESS_TOKENS", true);
        if validate_access_tokens && jwt_secret.is_none() {
            bail!("GATEWAY_VALIDATE_ACCESS_TOKENS=true 时必须配置 JWT_SECRET");
        }
        let trust_x_forwarded_for = read_bool("GATEWAY_TRUST_X_FORWARDED_FOR", true);
        let rate_limit_capacity = read_f64("GATEWAY_RATE_LIMIT_CAPACITY", 120.0)?;
        let rate_limit_refill_per_sec = read_f64("GATEWAY_RATE_LIMIT_REFILL_PER_SEC", 2.0)?;
        let request_timeout_secs = read_u64("GATEWAY_REQUEST_TIMEOUT_SECS", 30)?;
        let sync_request_timeout_secs = read_u64("GATEWAY_SYNC_REQUEST_TIMEOUT_SECS", 45)?;

        Ok(Self {
            bind_addr,
            upstream_http,
            ops_token,
            jwt_secret,
            validate_access_tokens,
            trust_x_forwarded_for,
            rate_limit_capacity,
            rate_limit_refill_per_sec,
            request_timeout_secs,
            sync_request_timeout_secs,
        })
    }
}

fn read_socket_addr(key: &str, default: &str) -> Result<SocketAddr> {
    env::var(key)
        .unwrap_or_else(|_| default.to_string())
        .parse::<SocketAddr>()
        .with_context(|| format!("failed to parse {key} as SocketAddr"))
}

fn read_string(key: &str, default: &str) -> String {
    env::var(key)
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|_| default.to_string())
}

fn read_optional_string(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn read_bool(key: &str, default: bool) -> bool {
    match env::var(key) {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => default,
    }
}

fn read_f64(key: &str, default: f64) -> Result<f64> {
    match env::var(key) {
        Ok(value) => value
            .trim()
            .parse::<f64>()
            .with_context(|| format!("failed to parse {key} as f64")),
        Err(_) => Ok(default),
    }
}

fn read_u64(key: &str, default: u64) -> Result<u64> {
    match env::var(key) {
        Ok(value) => value
            .trim()
            .parse::<u64>()
            .with_context(|| format!("failed to parse {key} as u64")),
        Err(_) => Ok(default),
    }
}

fn normalize_base_url(value: String) -> String {
    value.trim_end_matches('/').to_string()
}
