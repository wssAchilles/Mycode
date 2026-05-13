package profiling

import "testing"

func TestIsLoopbackBind(t *testing.T) {
	for _, bindAddr := range []string{"127.0.0.1:6060", "localhost:6060", "[::1]:6060"} {
		if !IsLoopbackBind(bindAddr) {
			t.Fatalf("expected %s to be accepted", bindAddr)
		}
	}
	for _, bindAddr := range []string{"0.0.0.0:6060", ":6060", "10.0.0.1:6060", "bad-address"} {
		if IsLoopbackBind(bindAddr) {
			t.Fatalf("expected %s to be rejected", bindAddr)
		}
	}
}

func TestNewServerDefaultsDisabled(t *testing.T) {
	server, err := NewServer("", nil)
	if err != nil {
		t.Fatalf("expected disabled server to be valid: %v", err)
	}
	if server.Enabled() {
		t.Fatalf("expected empty bind addr to disable pprof")
	}
}

func TestNewServerRejectsNonLoopback(t *testing.T) {
	if _, err := NewServer("0.0.0.0:6060", nil); err == nil {
		t.Fatalf("expected non-loopback bind to fail")
	}
}
