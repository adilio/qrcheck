package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestResolveURL(t *testing.T) {
	base := "https://example.com/a/b"
	target, _ := url.Parse("/c")
	got := resolveURL(target, base)
	want := "https://example.com/c"
	if got != want {
		t.Fatalf("resolveURL(%v, %s) = %s, want %s", target, base, got, want)
	}
}

func TestRateLimit(t *testing.T) {
	limitersMu.Lock()
	limiters = make(map[string]*rateLimiter)
	limitersMu.Unlock()

	handler := rateLimit(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "http://example.com", nil)

	for i := 0; i < 60; i++ {
		rr := httptest.NewRecorder()
		handler(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected status 200 for request %d, got %d", i+1, rr.Code)
		}
	}

	rr := httptest.NewRecorder()
	handler(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after exceeding limit, got %d", rr.Code)
	}
}

func TestFetchPhishTankNoAPIKey(t *testing.T) {
	t.Setenv("PHISHTANK_API_KEY", "")
	if result := fetchPhishTank(context.Background(), "https://example.com"); result != nil {
		t.Fatalf("expected nil when API key missing, got %#v", result)
	}
}
