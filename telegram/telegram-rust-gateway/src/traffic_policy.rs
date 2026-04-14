use std::{fmt, net::IpAddr};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrafficClass {
    InternalOps,
    Auth,
    PublicRead,
    SyncLongPoll,
    SocketIoCompat,
    DefaultApi,
}

impl TrafficClass {
    pub fn from_path(path: &str) -> Self {
        if path == "/health" || path.starts_with("/gateway/ops/") {
            Self::InternalOps
        } else if path.starts_with("/api/auth/login") || path.starts_with("/api/auth/register") {
            Self::Auth
        } else if path.starts_with("/api/public/") {
            Self::PublicRead
        } else if path.starts_with("/api/sync/updates") {
            Self::SyncLongPoll
        } else if path.starts_with("/socket.io/") {
            Self::SocketIoCompat
        } else {
            Self::DefaultApi
        }
    }

    pub fn bypass_rate_limit(self) -> bool {
        matches!(self, Self::InternalOps)
    }

    pub fn bypass_jwt_prevalidation(self) -> bool {
        matches!(
            self,
            Self::InternalOps | Self::Auth | Self::PublicRead | Self::SocketIoCompat
        )
    }

    pub fn bucket_key(self, client_ip: &IpAddr) -> String {
        format!("{}:{client_ip}", self.as_str())
    }

    pub fn request_timeout_secs(self, default_secs: u64, sync_long_poll_secs: u64) -> u64 {
        match self {
            Self::SyncLongPoll => sync_long_poll_secs,
            _ => default_secs,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::InternalOps => "internal_ops",
            Self::Auth => "auth",
            Self::PublicRead => "public_read",
            Self::SyncLongPoll => "sync_long_poll",
            Self::SocketIoCompat => "socket_io_compat",
            Self::DefaultApi => "default_api",
        }
    }
}

impl fmt::Display for TrafficClass {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use super::TrafficClass;

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
            TrafficClass::from_path("/api/public/space/uploads/a.png"),
            TrafficClass::PublicRead
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
    }

    #[test]
    fn derives_bucket_and_bypass_rules() {
        let ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));

        assert!(TrafficClass::InternalOps.bypass_rate_limit());
        assert!(TrafficClass::Auth.bypass_jwt_prevalidation());
        assert!(!TrafficClass::SyncLongPoll.bypass_jwt_prevalidation());
        assert_eq!(
            TrafficClass::DefaultApi.bucket_key(&ip),
            "default_api:127.0.0.1"
        );
        assert_eq!(TrafficClass::DefaultApi.request_timeout_secs(30, 45), 30);
        assert_eq!(TrafficClass::SyncLongPoll.request_timeout_secs(30, 45), 45);
    }
}
