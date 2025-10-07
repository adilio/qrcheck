package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type URLHausResult struct {
	QueryStatus string `json:"query_status"`
	URL         string `json:"url,omitempty"`
	Threat      string `json:"threat,omitempty"`
	URLStatus   string `json:"url_status,omitempty"`
}

type IntelIn struct {
	URL string `json:"url"`
}

type IntelOut struct {
	URLHaus   URLHausResult `json:"urlhaus"`
	PhishTank any           `json:"phishtank"`
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", health)
	mux.HandleFunc("/resolve", cors(rateLimit(resolve)))
	mux.HandleFunc("/intel", cors(rateLimit(intel)))

	addr := ":8080"
	log.Printf("qrcheck api listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	okUH := false
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://urlhaus-api.abuse.ch/v1/", nil)
	if resp, err := http.DefaultClient.Do(req); err == nil && resp.StatusCode == http.StatusOK {
		okUH = true
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"feeds": map[string]bool{"urlhaus": okUH},
	})
}

func cors(h http.HandlerFunc) http.HandlerFunc {
	allow := os.Getenv("CORS_ORIGIN")
	if allow == "" {
		allow = "*"
	}

	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allow)
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		h(w, r)
	}
}

func resolve(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if _, err := url.ParseRequestURI(target); err != nil {
		http.Error(w, "bad url", http.StatusBadRequest)
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	hops := []string{}
	cur := target
	seen := map[string]bool{}

	for i := 0; i < 10; i++ {
		if seen[cur] {
			break
		}
		seen[cur] = true
		hops = append(hops, cur)

		req, _ := http.NewRequest(http.MethodHead, cur, nil)
		req.Header.Set("User-Agent", "QRCheck/1.0 (+https://qrcheck.ca)")
		resp, err := client.Do(req)
		if err != nil {
			break
		}
		resp.Body.Close()
		loc, err := resp.Location()
		if err != nil {
			break
		}
		cur = resolveURL(loc, cur)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"hops": hops, "final": cur})
}

func intel(w http.ResponseWriter, r *http.Request) {
	var in IntelIn
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	uh := fetchURLHaus(ctx, in.URL)
	pt := fetchPhishTank(ctx, in.URL)

	if uh.QueryStatus == "no_results" {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(IntelOut{URLHaus: uh, PhishTank: pt})
}

func fetchURLHaus(ctx context.Context, target string) URLHausResult {
	vals := url.Values{"url": {target}}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://urlhaus-api.abuse.ch/v1/url/", strings.NewReader(vals.Encode()))
	req.Header.Set("content-type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return URLHausResult{QueryStatus: "error"}
	}
	defer resp.Body.Close()

	var result URLHausResult
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return result
}

func fetchPhishTank(ctx context.Context, target string) any {
	apiKey := os.Getenv("PHISHTANK_API_KEY")
	if apiKey == "" {
		return map[string]string{"error": "API key not configured"}
	}

	vals := url.Values{
		"url":    {target},
		"format": {"json"},
		"app_key": {apiKey},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://checkurl.phishtank.com/checkurl/", strings.NewReader(vals.Encode()))
	req.Header.Set("content-type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return map[string]string{"error": err.Error()}
	}
	defer resp.Body.Close()

	var result any
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return result
}

func resolveURL(loc *url.URL, base string) string {
	if loc.IsAbs() {
		return loc.String()
	}

	b, _ := url.Parse(base)
	return b.ResolveReference(loc).String()
}
