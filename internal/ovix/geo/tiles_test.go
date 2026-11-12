package geo

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
)

func tileServer(t *testing.T, status int) (*httptest.Server, *atomic.Int32, *atomic.Value) {
	t.Helper()
	var hits atomic.Int32
	var ua atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		ua.Store(r.UserAgent() + " " + r.URL.Path)
		w.WriteHeader(status)
		_, _ = w.Write([]byte("png:" + r.URL.Path))
	}))
	t.Cleanup(srv.Close)
	return srv, &hits, &ua
}

func tileEngine(p *TileProxy) *gin.Engine {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.GET("/tile/:z/:x/:y", p.Serve)
	return e
}

func get(e *gin.Engine, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestTileProxyFetchesOnceThenServesFromCache(t *testing.T) {
	srv, hits, ua := tileServer(t, http.StatusOK)
	e := tileEngine(&TileProxy{URLFormat: srv.URL + "/%d/%d/%d.png", Client: srv.Client()})

	for range 3 {
		rec := get(e, "/tile/5/24/15.png")
		if rec.Code != http.StatusOK || rec.Body.String() != "png:/5/24/15.png" {
			t.Fatalf("tile = %d %q, want the upstream tile", rec.Code, rec.Body.String())
		}
		if rec.Header().Get("Content-Type") != "image/png" || rec.Header().Get("Cache-Control") == "" {
			t.Fatalf("headers = %v, want a cacheable PNG", rec.Header())
		}
	}
	if hits.Load() != 1 {
		t.Fatalf("upstream hits = %d, want 1: repeats must come from the cache", hits.Load())
	}
	if got := ua.Load().(string); got != tileUserAgent+" /5/24/15.png" {
		t.Fatalf("upstream saw %q, want the identifying User-Agent the tile policy asks for", got)
	}
}

func TestTileProxyRefusesAnythingButATileAndNeverCallsUpstream(t *testing.T) {
	srv, hits, _ := tileServer(t, http.StatusOK)
	e := tileEngine(&TileProxy{URLFormat: srv.URL + "/%d/%d/%d.png", Client: srv.Client()})
	for _, path := range []string{"/tile/20/0/0", "/tile/2/4/0", "/tile/2/0/4", "/tile/-1/0/0", "/tile/3/x/1", "/tile/3/1/1.jpg"} {
		if rec := get(e, path); rec.Code != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", path, rec.Code)
		}
	}
	// The router itself turns away an encoded traversal before the handler runs.
	if rec := get(e, "/tile/3/1/..%2f..%2fetc"); rec.Code == http.StatusOK {
		t.Errorf("encoded traversal answered %d", rec.Code)
	}
	if hits.Load() != 0 {
		t.Fatalf("upstream hits = %d, want 0", hits.Load())
	}
}

func TestTileProxyReportsUpstreamFailureWithoutCachingIt(t *testing.T) {
	srv, hits, _ := tileServer(t, http.StatusTooManyRequests)
	e := tileEngine(&TileProxy{URLFormat: srv.URL + "/%d/%d/%d.png", Client: srv.Client()})
	for range 2 {
		if rec := get(e, "/tile/1/0/0"); rec.Code != http.StatusBadGateway {
			t.Fatalf("code = %d, want 502", rec.Code)
		}
	}
	if hits.Load() != 2 {
		t.Fatalf("upstream hits = %d, want 2: a failed tile must be retried, not cached", hits.Load())
	}
}

func TestTileCacheStaysBounded(t *testing.T) {
	p := &TileProxy{}
	for i := range tileCacheSize + 10 {
		p.store(string(rune('a'+i%26))+string(rune(i)), []byte{1})
	}
	if p.order.Len() != tileCacheSize || len(p.byKey) != tileCacheSize {
		t.Fatalf("cache holds %d/%d entries, want %d", p.order.Len(), len(p.byKey), tileCacheSize)
	}
}
