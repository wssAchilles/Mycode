use std::{env, net::SocketAddr};

use anyhow::{Context, Result, bail};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GatewayRealtimeRolloutStage {
    Shadow,
    CompatPrimary,
    RustEdgePrimary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GatewayRealtimeSocketTerminator {
    Node,
    Rust,
}

impl GatewayRealtimeSocketTerminator {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Node => "node",
            Self::Rust => "rust",
        }
    }
}

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
    pub cors_extra_origins: Vec<String>,
    pub realtime_redis_url: String,
    pub realtime_stream_key: String,
    pub realtime_delivery_stream_key: String,
    pub realtime_dlq_stream_key: String,
    pub realtime_consumer_group: String,
    pub realtime_consumer_name: String,
    pub realtime_delivery_consumer_group: String,
    pub realtime_delivery_consumer_name: String,
    pub realtime_compat_dispatch_channel: String,
    pub realtime_rollout_stage: GatewayRealtimeRolloutStage,
    pub realtime_socket_terminator: GatewayRealtimeSocketTerminator,
    pub realtime_heartbeat_stale_secs: u64,
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
        let cors_extra_origins =
            read_csv_origins(&["FRONTEND_ORIGIN", "FRONTEND_ORIGINS", "CORS_EXTRA_ORIGINS"]);
        let realtime_redis_url = read_optional_string("GATEWAY_REALTIME_REDIS_URL")
            .or_else(|| read_optional_string("REDIS_URL"))
            .unwrap_or_else(|| "redis://redis:6379/0".to_string());
        let realtime_stream_key = read_string("GATEWAY_REALTIME_STREAM_KEY", "realtime:ingress:v1");
        let realtime_delivery_stream_key = read_string(
            "GATEWAY_REALTIME_DELIVERY_STREAM_KEY",
            "realtime:delivery:v1",
        );
        let realtime_dlq_stream_key =
            read_string("GATEWAY_REALTIME_DLQ_STREAM_KEY", "realtime:dlq:v1");
        let realtime_consumer_group = read_string(
            "GATEWAY_REALTIME_CONSUMER_GROUP",
            "gateway-realtime-boundary",
        );
        let realtime_consumer_name = read_optional_string("GATEWAY_REALTIME_CONSUMER_NAME")
            .or_else(|| read_optional_string("HOSTNAME"))
            .unwrap_or_else(|| "gateway-realtime-consumer".to_string());
        let realtime_delivery_consumer_group = read_string(
            "GATEWAY_REALTIME_DELIVERY_CONSUMER_GROUP",
            "gateway-realtime-delivery",
        );
        let realtime_delivery_consumer_name =
            read_optional_string("GATEWAY_REALTIME_DELIVERY_CONSUMER_NAME")
                .or_else(|| read_optional_string("HOSTNAME"))
                .unwrap_or_else(|| "gateway-realtime-delivery-consumer".to_string());
        let realtime_compat_dispatch_channel = read_string(
            "GATEWAY_REALTIME_COMPAT_DISPATCH_CHANNEL",
            "realtime:compat:dispatch:v1",
        );
        let realtime_rollout_stage = read_realtime_rollout_stage(
            "GATEWAY_REALTIME_ROLLOUT_STAGE",
            GatewayRealtimeRolloutStage::CompatPrimary,
        );
        let realtime_socket_terminator = read_realtime_socket_terminator(
            "GATEWAY_REALTIME_SOCKET_TERMINATOR",
            realtime_rollout_stage,
        );
        let realtime_heartbeat_stale_secs = read_u64("GATEWAY_REALTIME_HEARTBEAT_STALE_SECS", 120)?;

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
            cors_extra_origins,
            realtime_redis_url,
            realtime_stream_key,
            realtime_delivery_stream_key,
            realtime_dlq_stream_key,
            realtime_consumer_group,
            realtime_consumer_name,
            realtime_delivery_consumer_group,
            realtime_delivery_consumer_name,
            realtime_compat_dispatch_channel,
            realtime_rollout_stage,
            realtime_socket_terminator,
            realtime_heartbeat_stale_secs,
        })
    }

    pub fn is_origin_allowed(&self, origin: &str) -> bool {
        if is_localhost_origin(origin) {
            return true;
        }

        if matches!(
            origin,
            "https://telegram-liart-rho.vercel.app"
                | "https://telegram-467705.web.app"
                | "https://telegram-467705.firebaseapp.com"
        ) {
            return true;
        }

        if origin.starts_with("https://") && origin.ends_with(".vercel.app") {
            return true;
        }

        self.cors_extra_origins
            .iter()
            .any(|allowed| allowed == origin)
    }

    pub fn realtime_fanout_owner(&self) -> &'static str {
        match self.realtime_rollout_stage {
            GatewayRealtimeRolloutStage::RustEdgePrimary => "rust",
            GatewayRealtimeRolloutStage::Shadow | GatewayRealtimeRolloutStage::CompatPrimary => {
                "node"
            }
        }
    }

    pub fn realtime_socket_terminator_owner(&self) -> &'static str {
        self.realtime_socket_terminator.as_str()
    }

    pub fn realtime_delivery_primary_enabled(&self) -> bool {
        self.realtime_fanout_owner() == "rust"
    }

    pub fn realtime_transport_preferred(&self) -> &'static str {
        if self.realtime_socket_terminator == GatewayRealtimeSocketTerminator::Rust {
            "rust_socket_io_compat"
        } else {
            "node_socket_io_compat"
        }
    }

    pub fn realtime_transport_fallback(&self) -> &'static str {
        if self.realtime_socket_terminator == GatewayRealtimeSocketTerminator::Rust {
            "node_socket_io_compat"
        } else {
            "rust_socket_io_compat"
        }
    }

    pub fn realtime_compat_fallback_owner(&self) -> &'static str {
        if self.realtime_socket_terminator == GatewayRealtimeSocketTerminator::Rust {
            "node"
        } else {
            "rust"
        }
    }

    pub fn realtime_socket_io_probe_url(&self) -> String {
        if self.realtime_socket_terminator == GatewayRealtimeSocketTerminator::Rust {
            format!(
                "http://{}/socket.io/?EIO=4&transport=polling",
                self.realtime_probe_bind_addr(),
            )
        } else {
            format!("{}/socket.io/?EIO=4&transport=polling", self.upstream_http)
        }
    }

    fn realtime_probe_bind_addr(&self) -> SocketAddr {
        match self.bind_addr {
            SocketAddr::V4(addr) if addr.ip().is_unspecified() => {
                SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, addr.port()))
            }
            SocketAddr::V6(addr) if addr.ip().is_unspecified() => {
                SocketAddr::from((std::net::Ipv6Addr::LOCALHOST, addr.port()))
            }
            addr => addr,
        }
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

fn read_csv_origins(keys: &[&str]) -> Vec<String> {
    keys.iter()
        .filter_map(|key| env::var(key).ok())
        .flat_map(|value| value.split(',').map(str::to_owned).collect::<Vec<_>>())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn is_localhost_origin(origin: &str) -> bool {
    origin.starts_with("http://localhost:") || origin.starts_with("http://127.0.0.1:")
}

fn read_realtime_rollout_stage(
    key: &str,
    default: GatewayRealtimeRolloutStage,
) -> GatewayRealtimeRolloutStage {
    match env::var(key) {
        Ok(value) => match value.trim().to_ascii_lowercase().as_str() {
            "shadow" => GatewayRealtimeRolloutStage::Shadow,
            "rust_edge_primary" => GatewayRealtimeRolloutStage::RustEdgePrimary,
            "compat_primary" => GatewayRealtimeRolloutStage::CompatPrimary,
            _ => default,
        },
        Err(_) => default,
    }
}

fn read_realtime_socket_terminator(
    key: &str,
    rollout_stage: GatewayRealtimeRolloutStage,
) -> GatewayRealtimeSocketTerminator {
    if !matches!(rollout_stage, GatewayRealtimeRolloutStage::RustEdgePrimary) {
        return GatewayRealtimeSocketTerminator::Node;
    }

    match env::var(key) {
        Ok(value) => match value.trim().to_ascii_lowercase().as_str() {
            "rust" => GatewayRealtimeSocketTerminator::Rust,
            _ => GatewayRealtimeSocketTerminator::Node,
        },
        Err(_) => GatewayRealtimeSocketTerminator::Node,
    }
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, SocketAddr};

    use super::{
        GatewayConfig, GatewayRealtimeRolloutStage, GatewayRealtimeSocketTerminator,
        read_realtime_socket_terminator,
    };

    fn config() -> GatewayConfig {
        GatewayConfig {
            bind_addr: SocketAddr::from((Ipv4Addr::LOCALHOST, 4000)),
            upstream_http: "http://backend:5000".to_string(),
            ops_token: None,
            jwt_secret: Some("secret".to_string()),
            validate_access_tokens: true,
            trust_x_forwarded_for: true,
            rate_limit_capacity: 120.0,
            rate_limit_refill_per_sec: 2.0,
            request_timeout_secs: 30,
            sync_request_timeout_secs: 45,
            cors_extra_origins: vec!["https://api.xuziqi.tech".to_string()],
            realtime_redis_url: "redis://redis:6379/0".to_string(),
            realtime_stream_key: "realtime:ingress:v1".to_string(),
            realtime_delivery_stream_key: "realtime:delivery:v1".to_string(),
            realtime_dlq_stream_key: "realtime:dlq:v1".to_string(),
            realtime_consumer_group: "gateway-realtime-boundary".to_string(),
            realtime_consumer_name: "gateway-realtime-consumer".to_string(),
            realtime_delivery_consumer_group: "gateway-realtime-delivery".to_string(),
            realtime_delivery_consumer_name: "gateway-realtime-delivery-consumer".to_string(),
            realtime_compat_dispatch_channel: "realtime:compat:dispatch:v1".to_string(),
            realtime_rollout_stage: GatewayRealtimeRolloutStage::CompatPrimary,
            realtime_socket_terminator: GatewayRealtimeSocketTerminator::Node,
            realtime_heartbeat_stale_secs: 120,
        }
    }

    #[test]
    fn allows_static_and_extra_origins() {
        let config = config();

        assert!(config.is_origin_allowed("https://telegram-467705.web.app"));
        assert!(config.is_origin_allowed("https://preview.vercel.app"));
        assert!(config.is_origin_allowed("http://127.0.0.1:4173"));
        assert!(config.is_origin_allowed("https://api.xuziqi.tech"));
        assert!(!config.is_origin_allowed("https://evil.example.com"));
    }

    #[test]
    fn rollout_stage_controls_runtime_ownership() {
        let mut config = config();
        config.realtime_rollout_stage = GatewayRealtimeRolloutStage::RustEdgePrimary;

        assert_eq!(config.realtime_fanout_owner(), "rust");
        assert_eq!(config.realtime_socket_terminator_owner(), "node");
        assert!(config.realtime_delivery_primary_enabled());
        assert_eq!(
            config.realtime_transport_preferred(),
            "node_socket_io_compat"
        );
        assert_eq!(
            config.realtime_transport_fallback(),
            "rust_socket_io_compat"
        );
    }

    #[test]
    fn socket_terminator_env_only_activates_under_rust_edge_primary() {
        assert_eq!(
            read_realtime_socket_terminator("UNUSED", GatewayRealtimeRolloutStage::CompatPrimary,),
            GatewayRealtimeSocketTerminator::Node,
        );
    }
}
