package handlers

import (
	"crypto/sha256"
	"crypto/subtle"
	stdhttp "net/http"
)

// VerifyInternalToken 使用 SHA-256 定长摘要做恒定时间比对，防止内部 Token 长度或时序侧信道泄露。
func VerifyInternalToken(expected string, provided string) bool {
	if expected == "" || provided == "" {
		return false
	}
	expectedDigest := sha256.Sum256([]byte(expected))
	providedDigest := sha256.Sum256([]byte(provided))
	return subtle.ConstantTimeCompare(expectedDigest[:], providedDigest[:]) == 1
}

// RequireInternalToken 强制校验 X-Internal-Token 请求头，未配置密钥或密钥不匹配时一律 Fail-Closed 返回 403。
func RequireInternalToken(expectedToken string, next stdhttp.HandlerFunc) stdhttp.HandlerFunc {
	return func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if !VerifyInternalToken(expectedToken, r.Header.Get("X-Internal-Token")) {
			writeJSON(w, stdhttp.StatusForbidden, map[string]any{"error": "forbidden"})
			return
		}
		next(w, r)
	}
}
