package geo

import (
	"container/list"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// OpenStreetMap's tile policy asks for an identifying User-Agent, caching and
// light use; the panel proxies so the browser stays on its own origin.
const (
	defaultTileURL = "https://tile.openstreetmap.org/%d/%d/%d.png"
	tileUserAgent  = "OvixUI-ClientMap/1.0 (+https://ntools.net)"
	maxTileZoom    = 19
	tileCacheSize  = 1500
	tileMaxBytes   = 512 << 10
)

type tileEntry struct {
	key  string
	body []byte
}

// TileProxy serves map tiles from a bounded in-memory cache, fetching misses
// from the upstream tile server.
type TileProxy struct {
	URLFormat string
	Client    *http.Client

	mu    sync.Mutex
	order *list.List
	byKey map[string]*list.Element
}

// NewTileProxy proxies the public OpenStreetMap tiles.
func NewTileProxy() *TileProxy {
	return &TileProxy{URLFormat: defaultTileURL, Client: &http.Client{Timeout: 15 * time.Second}}
}

// parseTile accepts only real slippy-map coordinates, so the proxy can never
// be pointed anywhere but a tile.
func parseTile(zs, xs, ys string) (z, x, y int, ok bool) {
	ys = strings.TrimSuffix(ys, ".png")
	var err error
	if z, err = strconv.Atoi(zs); err != nil || z < 0 || z > maxTileZoom {
		return 0, 0, 0, false
	}
	n := 1 << z
	if x, err = strconv.Atoi(xs); err != nil || x < 0 || x >= n {
		return 0, 0, 0, false
	}
	if y, err = strconv.Atoi(ys); err != nil || y < 0 || y >= n {
		return 0, 0, 0, false
	}
	return z, x, y, true
}

func (p *TileProxy) cached(key string) ([]byte, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.byKey == nil {
		return nil, false
	}
	el, ok := p.byKey[key]
	if !ok {
		return nil, false
	}
	p.order.MoveToFront(el)
	return el.Value.(*tileEntry).body, true
}

func (p *TileProxy) store(key string, body []byte) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.byKey == nil {
		p.byKey, p.order = map[string]*list.Element{}, list.New()
	}
	if _, ok := p.byKey[key]; ok {
		return
	}
	p.byKey[key] = p.order.PushFront(&tileEntry{key: key, body: body})
	for p.order.Len() > tileCacheSize {
		old := p.order.Back()
		p.order.Remove(old)
		delete(p.byKey, old.Value.(*tileEntry).key)
	}
}

// Serve handles GET .../tile/:z/:x/:y.
func (p *TileProxy) Serve(c *gin.Context) {
	z, x, y, ok := parseTile(c.Param("z"), c.Param("x"), c.Param("y"))
	if !ok {
		c.Status(http.StatusBadRequest)
		return
	}
	key := fmt.Sprintf("%d/%d/%d", z, x, y)
	body, hit := p.cached(key)
	if !hit {
		var err error
		if body, err = p.fetch(c, z, x, y); err != nil {
			c.Status(http.StatusBadGateway)
			return
		}
		p.store(key, body)
	}
	c.Header("Cache-Control", "private, max-age=604800")
	c.Data(http.StatusOK, "image/png", body)
}

func (p *TileProxy) fetch(c *gin.Context, z, x, y int) ([]byte, error) {
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, fmt.Sprintf(p.URLFormat, z, x, y), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", tileUserAgent)
	resp, err := p.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tile server answered %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, tileMaxBytes))
}
