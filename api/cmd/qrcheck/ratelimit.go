package main

import (
	"net/http"
	"sync"
	"time"
)

type rateLimiter struct {
	requests []time.Time
	mu       sync.Mutex
}

var (
	limiters   = make(map[string]*rateLimiter)
	limitersMu sync.RWMutex
)

func rateLimit(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr

		limitersMu.Lock()
		if limiters[ip] == nil {
			limiters[ip] = &rateLimiter{}
		}
		lim := limiters[ip]
		limitersMu.Unlock()

		lim.mu.Lock()
		defer lim.mu.Unlock()

		now := time.Now()
		cutoff := now.Add(-1 * time.Minute)

		filtered := lim.requests[:0]
		for _, t := range lim.requests {
			if t.After(cutoff) {
				filtered = append(filtered, t)
			}
		}
		lim.requests = filtered

		if len(lim.requests) >= 60 {
			http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
			return
		}

		lim.requests = append(lim.requests, now)
		next(w, r)
	}
}
