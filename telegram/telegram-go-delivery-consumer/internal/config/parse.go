package config

import (
	"net/url"
	"os"
	"strconv"
	"strings"
)

func RedisAddress(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return "redis:6379"
	}
	return parsed.Host
}

func RedisPassword(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.User == nil {
		return ""
	}
	password, _ := parsed.User.Password()
	return password
}

func RedisDB(rawURL string) int {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return 0
	}
	path := strings.TrimPrefix(parsed.Path, "/")
	if path == "" {
		return 0
	}
	value, err := strconv.Atoi(path)
	if err != nil || value < 0 {
		return 0
	}
	return value
}

func MongoDatabaseFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	path := strings.TrimPrefix(parsed.Path, "/")
	if path == "" {
		return ""
	}
	if idx := strings.Index(path, "?"); idx >= 0 {
		path = path[:idx]
	}
	return strings.TrimSpace(path)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func readInt(name string, fallback int, min int, max int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil {
		return fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func readBool(name string, fallback bool) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func readExecutionMode() string {
	value := strings.TrimSpace(strings.ToLower(os.Getenv("DELIVERY_CONSUMER_EXECUTION_MODE")))
	switch value {
	case "dry-run", "shadow", "canary", "primary":
		return value
	}
	if readBool("DELIVERY_CONSUMER_DRY_RUN", true) {
		return "dry-run"
	}
	return defaultExecutionMode
}

func readPlatformExecutionMode(name string, fallback string) string {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	switch value {
	case "shadow", "publish":
		return value
	default:
		return fallback
	}
}
