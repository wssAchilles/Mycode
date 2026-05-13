package profiling

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/pprof"
	"strings"
)

type Server struct {
	bindAddr string
	server   *http.Server
}

func NewServer(bindAddr string, logger *log.Logger) (*Server, error) {
	bindAddr = strings.TrimSpace(bindAddr)
	if bindAddr == "" {
		return &Server{}, nil
	}
	if !IsLoopbackBind(bindAddr) {
		return nil, fmt.Errorf("pprof bind address must use loopback host, got %q", bindAddr)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	for _, name := range []string{"allocs", "block", "goroutine", "heap", "mutex", "threadcreate"} {
		mux.Handle("/debug/pprof/"+name, pprof.Handler(name))
	}

	return &Server{
		bindAddr: bindAddr,
		server: &http.Server{
			Addr:              bindAddr,
			Handler:           requestLogger(mux, logger),
			ReadHeaderTimeout: defaultReadHeaderTimeout,
		},
	}, nil
}

func (s *Server) Enabled() bool {
	return s != nil && s.server != nil
}

func (s *Server) BindAddr() string {
	if s == nil {
		return ""
	}
	return s.bindAddr
}

func (s *Server) ListenAndServe() error {
	if !s.Enabled() {
		return nil
	}
	return s.server.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	if !s.Enabled() {
		return nil
	}
	return s.server.Shutdown(ctx)
}

func IsLoopbackBind(bindAddr string) bool {
	host, _, err := net.SplitHostPort(strings.TrimSpace(bindAddr))
	if err != nil {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func requestLogger(next http.Handler, logger *log.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if logger != nil {
			logger.Printf("pprof %s %s", r.Method, r.URL.Path)
		}
		next.ServeHTTP(w, r)
	})
}
