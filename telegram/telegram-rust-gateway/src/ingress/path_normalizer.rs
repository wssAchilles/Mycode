use percent_encoding::percent_decode_str;
use thiserror::Error;

/// URI 路径安全校验错误类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PathSecurityError {
    #[error("path contains invalid characters or encoded separators")]
    InvalidEncoding,
    #[error("path traversal escapes root boundary")]
    RootTraversal,
}

/// 在路由策略判定与上游转发前执行严格一致的 URI 路径规范化
pub fn normalize_uri_path(raw_path: &str) -> Result<String, PathSecurityError> {
    // 兼容剥离可能附带的查询参数部分
    let path_only = raw_path.split('?').next().unwrap_or(raw_path).trim();
    if path_only.is_empty() || !path_only.starts_with('/') {
        return Err(PathSecurityError::InvalidEncoding);
    }

    // 禁止原始控制字符与反斜杠分隔符混淆
    if path_only
        .bytes()
        .any(|b| b <= 0x1f || b == 0x7f || b == b'\\')
    {
        return Err(PathSecurityError::InvalidEncoding);
    }

    // 拦截编码斜杠、反斜杠与空字节，防止网关与上游 Express 解码行为不一致
    let lower_raw = path_only.to_ascii_lowercase();
    if lower_raw.contains("%2f") || lower_raw.contains("%5c") || lower_raw.contains("%00") {
        return Err(PathSecurityError::InvalidEncoding);
    }

    let trailing_slash = path_only.len() > 1 && path_only.ends_with('/');
    let mut segments: Vec<&str> = Vec::new();

    for raw_segment in path_only.split('/') {
        if raw_segment.is_empty() {
            continue;
        }

        let decoded = percent_decode_str(raw_segment)
            .decode_utf8()
            .map_err(|_| PathSecurityError::InvalidEncoding)?;

        if decoded
            .bytes()
            .any(|b| b <= 0x1f || b == 0x7f || b == b'/' || b == b'\\')
        {
            return Err(PathSecurityError::InvalidEncoding);
        }

        if decoded == "." {
            continue;
        }
        if decoded == ".." {
            if segments.pop().is_none() {
                return Err(PathSecurityError::RootTraversal);
            }
            continue;
        }

        segments.push(raw_segment);
    }

    if segments.is_empty() {
        return Ok("/".to_string());
    }

    let mut normalized = format!("/{}", segments.join("/"));
    if trailing_slash {
        normalized.push('/');
    }
    Ok(normalized)
}

/// 供策略分类器使用的容错路径规范化（若路径非法穿越则回退为安全哨兵路径以拒绝豁免）
pub fn normalize_path_for_policy(raw_path: &str) -> String {
    normalize_uri_path(raw_path).unwrap_or_else(|_| "/__invalid_path__".to_string())
}

/// 判断规范化后的路径是否属于禁止外部穿透访问的内部端点
pub fn is_blocked_external_path(normalized_path: &str) -> bool {
    let lower = normalized_path.to_ascii_lowercase();
    lower == "/internal"
        || lower.starts_with("/internal/")
        || lower == "/ready"
        || lower.starts_with("/ready/")
        || lower == "/gateway/ops"
        || lower.starts_with("/gateway/ops/")
}

#[cfg(test)]
mod tests {
    use super::{PathSecurityError, is_blocked_external_path, normalize_uri_path};

    #[test]
    fn collapses_dot_segments_and_duplicate_slashes() {
        assert_eq!(
            normalize_uri_path("/gateway/ops/../../api/messages/send"),
            Ok("/api/messages/send".to_string())
        );
        assert_eq!(
            normalize_uri_path("//api///public/./space//feed"),
            Ok("/api/public/space/feed".to_string())
        );
        assert_eq!(
            normalize_uri_path("/socket.io/?EIO=4&transport=websocket"),
            Ok("/socket.io/".to_string())
        );
        assert_eq!(
            normalize_uri_path("/gateway/ops/%2e%2e/%2e%2e/api/groups/my"),
            Ok("/api/groups/my".to_string())
        );
    }

    #[test]
    fn rejects_root_escape_and_encoded_separators() {
        assert_eq!(
            normalize_uri_path("/../../etc/passwd"),
            Err(PathSecurityError::RootTraversal)
        );
        assert_eq!(
            normalize_uri_path("/api/groups/..%2f..%2finternal"),
            Err(PathSecurityError::InvalidEncoding)
        );
        assert_eq!(
            normalize_uri_path("/api\\internal\\health"),
            Err(PathSecurityError::InvalidEncoding)
        );
    }

    #[test]
    fn blocks_internal_and_ready_endpoints_case_insensitively() {
        assert!(is_blocked_external_path("/internal/recommendation/health"));
        assert!(is_blocked_external_path("/INTERNAL/graph-kernel/neighbors"));
        assert!(is_blocked_external_path("/ready"));
        assert!(is_blocked_external_path("/Ready/"));
        assert!(!is_blocked_external_path("/api/realtime/health"));
        assert!(!is_blocked_external_path("/api/messages/send"));
    }
}
