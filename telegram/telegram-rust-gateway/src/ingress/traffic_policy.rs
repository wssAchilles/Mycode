use std::{fmt, net::IpAddr};

use serde::Serialize;

use super::path_normalizer::normalize_path_for_policy;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrafficClass {
    InternalOps,
    Auth,
    PublicRead,
    CronWebhook,
    RealtimeBootstrap,
    SyncLongPoll,
    SocketIoCompat,
    DefaultApi,
}

impl TrafficClass {
    pub fn from_path(path: &str) -> Self {
        // 先折叠 `.` / `..` 与重复斜杠并统一小写，防止路径变形绕过限流与 Bearer 预检
        let normalized = normalize_path_for_policy(path).to_ascii_lowercase();
        if normalized == "/health"
            || normalized == "/gateway/ops"
            || normalized.starts_with("/gateway/ops/")
        {
            Self::InternalOps
        } else if normalized.starts_with("/api/auth/login")
            || normalized.starts_with("/api/auth/register")
            || normalized.starts_with("/api/auth/refresh")
        {
            Self::Auth
        } else if normalized == "/api/news/ingest" || normalized == "/api/space/posts/batch-news" {
            Self::CronWebhook
        } else if normalized.starts_with("/api/realtime/health") {
            Self::PublicRead
        } else if normalized.starts_with("/api/realtime/") {
            Self::RealtimeBootstrap
        } else if normalized.starts_with("/api/public/") {
            Self::PublicRead
        } else if normalized.starts_with("/api/sync/updates") {
            Self::SyncLongPoll
        } else if normalized == "/socket.io" || normalized.starts_with("/socket.io/") {
            Self::SocketIoCompat
        } else {
            Self::DefaultApi
        }
    }

    pub fn bypass_rate_limit(self) -> bool {
        matches!(self, Self::InternalOps)
    }

    /// 根据路由类别计算令牌桶容量与填充速率，防止 Socket.IO 握手与长轮询触发 429 重连风暴
    pub fn rate_limit_budget(
        self,
        default_capacity: f64,
        default_refill_per_sec: f64,
    ) -> (f64, f64) {
        match self {
            Self::SocketIoCompat => (
                (default_capacity * 5.0).max(600.0),
                (default_refill_per_sec * 10.0).max(20.0),
            ),
            _ => (default_capacity, default_refill_per_sec),
        }
    }

    pub fn bypass_jwt_prevalidation(self) -> bool {
        matches!(
            self,
            Self::InternalOps
                | Self::Auth
                | Self::PublicRead
                | Self::CronWebhook
                | Self::SocketIoCompat
        )
    }

    /// 仅在明确的云端定时入库 Webhook 路由透传 `x-cron-secret`，其余路由一律剥离
    pub fn allow_cron_secret_passthrough(self) -> bool {
        matches!(self, Self::CronWebhook)
    }

    pub fn bucket_key(self, client_ip: &IpAddr) -> String {
        format!("{}:{client_ip}", self.as_str())
    }

    pub fn request_timeout_secs(self, default_secs: u64, sync_long_poll_secs: u64) -> u64 {
        match self {
            Self::SyncLongPoll => sync_long_poll_secs,
            Self::CronWebhook => default_secs.max(90),
            _ => default_secs,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::InternalOps => "internal_ops",
            Self::Auth => "auth",
            Self::PublicRead => "public_read",
            Self::CronWebhook => "cron_webhook",
            Self::RealtimeBootstrap => "realtime_bootstrap",
            Self::SyncLongPoll => "sync_long_poll",
            Self::SocketIoCompat => "socket_io_compat",
            Self::DefaultApi => "default_api",
        }
    }

    pub fn from_key(value: &str) -> Option<Self> {
        match value {
            "internal_ops" => Some(Self::InternalOps),
            "auth" => Some(Self::Auth),
            "public_read" => Some(Self::PublicRead),
            "cron_webhook" => Some(Self::CronWebhook),
            "realtime_bootstrap" => Some(Self::RealtimeBootstrap),
            "sync_long_poll" => Some(Self::SyncLongPoll),
            "socket_io_compat" => Some(Self::SocketIoCompat),
            "default_api" => Some(Self::DefaultApi),
            _ => None,
        }
    }
}

impl fmt::Display for TrafficClass {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficPolicyDescriptor {
    pub route_class: TrafficClass,
    pub match_rule: &'static str,
    pub description: &'static str,
    pub bypass_rate_limit: bool,
    pub bypass_jwt_prevalidation: bool,
    pub request_timeout_secs: u64,
    pub bucket_namespace: Option<&'static str>,
}

pub fn policy_catalog(default_secs: u64, sync_long_poll_secs: u64) -> Vec<TrafficPolicyDescriptor> {
    [
        (
            TrafficClass::InternalOps,
            "/health | /gateway/ops/*",
            "网关自身探针与运维观测面",
        ),
        (
            TrafficClass::Auth,
            "/api/auth/login | /api/auth/register | /api/auth/refresh",
            "公共认证入口，允许匿名流量进入 Node 兼容面",
        ),
        (
            TrafficClass::PublicRead,
            "/api/public/* | /api/realtime/health",
            "无需 JWT 的公共读接口与 realtime 健康探针",
        ),
        (
            TrafficClass::CronWebhook,
            "/api/news/ingest | /api/space/posts/batch-news",
            "云端定时入库 Webhook，豁免用户 JWT 预校验并允许透传 x-cron-secret 交由后端恒定时间验签",
        ),
        (
            TrafficClass::RealtimeBootstrap,
            "/api/realtime/bootstrap",
            "统一 realtime bootstrap 契约，保留 JWT 预校验与标准 API 超时",
        ),
        (
            TrafficClass::SyncLongPoll,
            "/api/sync/updates",
            "长轮询同步路径，使用独立超时窗口",
        ),
        (
            TrafficClass::SocketIoCompat,
            "/socket.io/*",
            "Socket.IO 兼容边界，保留给现有 Node realtime 入口",
        ),
        (
            TrafficClass::DefaultApi,
            "other /api/*",
            "默认业务 API，走标准 JWT 预校验和令牌桶限流",
        ),
    ]
    .into_iter()
    .map(
        |(route_class, match_rule, description)| TrafficPolicyDescriptor {
            route_class,
            match_rule,
            description,
            bypass_rate_limit: route_class.bypass_rate_limit(),
            bypass_jwt_prevalidation: route_class.bypass_jwt_prevalidation(),
            request_timeout_secs: route_class
                .request_timeout_secs(default_secs, sync_long_poll_secs),
            bucket_namespace: (!route_class.bypass_rate_limit()).then_some(route_class.as_str()),
        },
    )
    .collect()
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use super::{TrafficClass, policy_catalog};

    #[test]
    fn classifies_paths_and_policies() {
        assert_eq!(
            TrafficClass::from_path("/health"),
            TrafficClass::InternalOps
        );
        assert_eq!(
            TrafficClass::from_path("/gateway/ops/control-plane"),
            TrafficClass::InternalOps
        );
        assert_eq!(
            TrafficClass::from_path("/api/auth/login"),
            TrafficClass::Auth
        );
        assert_eq!(
            TrafficClass::from_path("/api/auth/refresh"),
            TrafficClass::Auth
        );
        assert_eq!(
            TrafficClass::from_path("/api/public/space/uploads/a.png"),
            TrafficClass::PublicRead
        );
        assert_eq!(
            TrafficClass::from_path("/api/realtime/health"),
            TrafficClass::PublicRead
        );
        assert_eq!(
            TrafficClass::from_path("/api/realtime/bootstrap"),
            TrafficClass::RealtimeBootstrap
        );
        assert_eq!(
            TrafficClass::from_path("/api/sync/updates?pts=0"),
            TrafficClass::SyncLongPoll
        );
        assert_eq!(
            TrafficClass::from_path("/socket.io/?EIO=4&transport=polling"),
            TrafficClass::SocketIoCompat
        );
        assert_eq!(
            TrafficClass::from_path("/api/messages/chat/abc"),
            TrafficClass::DefaultApi
        );
        // 验证路径折叠与大小写不敏感匹配，阻断 `..` 穿越绕过 InternalOps 豁免
        assert_eq!(
            TrafficClass::from_path("/gateway/ops/../../api/messages/send"),
            TrafficClass::DefaultApi
        );
        assert_eq!(
            TrafficClass::from_path("/API/Auth/Login"),
            TrafficClass::Auth
        );
    }

    #[test]
    fn derives_bucket_and_bypass_rules() {
        let ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));

        assert!(TrafficClass::InternalOps.bypass_rate_limit());
        assert!(TrafficClass::Auth.bypass_jwt_prevalidation());
        assert!(!TrafficClass::RealtimeBootstrap.bypass_jwt_prevalidation());
        assert!(!TrafficClass::SyncLongPoll.bypass_jwt_prevalidation());
        assert_eq!(
            TrafficClass::DefaultApi.bucket_key(&ip),
            "default_api:127.0.0.1"
        );
        assert_eq!(TrafficClass::DefaultApi.request_timeout_secs(30, 45), 30);
        assert_eq!(TrafficClass::SyncLongPoll.request_timeout_secs(30, 45), 45);
        assert_eq!(TrafficClass::from_key("auth"), Some(TrafficClass::Auth));
        assert_eq!(TrafficClass::from_key("unknown"), None);
    }

    #[test]
    fn builds_policy_catalog_with_route_specific_timeouts() {
        let catalog = policy_catalog(30, 45);
        let sync = catalog
            .iter()
            .find(|entry| entry.route_class == TrafficClass::SyncLongPoll)
            .expect("sync policy missing");
        let realtime_bootstrap = catalog
            .iter()
            .find(|entry| entry.route_class == TrafficClass::RealtimeBootstrap)
            .expect("realtime bootstrap policy missing");
        let default_api = catalog
            .iter()
            .find(|entry| entry.route_class == TrafficClass::DefaultApi)
            .expect("default api policy missing");

        assert_eq!(sync.request_timeout_secs, 45);
        assert_eq!(realtime_bootstrap.request_timeout_secs, 30);
        assert_eq!(default_api.request_timeout_secs, 30);
        assert!(default_api.bucket_namespace.is_some());
        assert!(
            catalog
                .iter()
                .find(|entry| entry.route_class == TrafficClass::InternalOps)
                .expect("ops policy missing")
                .bypass_rate_limit
        );
    }
}
