package geo

import (
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	"ovix.store/ovix-ui/internal/logger"
)

// FileName is the database inside the bin folder, next to the Xray geo files.
const FileName = "dbip-city-lite.mmdb"

// DB-IP publishes a new free edition each month; a month-old copy is fine.
const refreshAfter = 35 * 24 * time.Hour

const defaultBaseURL = "https://download.db-ip.com/free"

// Updater keeps the database file fresh and loaded into a Locator.
type Updater struct {
	Dir     string
	BaseURL string
	Client  *http.Client
	Loc     *Locator

	running atomic.Bool
}

func (u *Updater) path() string { return filepath.Join(u.Dir, FileName) }

func editionURL(base string, month time.Time) string {
	return fmt.Sprintf("%s/dbip-city-lite-%s.mmdb.gz", base, month.Format("2006-01"))
}

// LoadExisting loads the file on disk, if any, without touching the network.
func (u *Updater) LoadExisting() error {
	info, err := os.Stat(u.path())
	if err != nil {
		return err
	}
	return u.Loc.Load(u.path(), info.ModTime())
}

// Stale reports whether there is no database or it is older than a month.
func (u *Updater) Stale(now time.Time) bool {
	info, err := os.Stat(u.path())
	return err != nil || now.Sub(info.ModTime()) > refreshAfter
}

// Downloading reports whether a refresh is in flight.
func (u *Updater) Downloading() bool { return u.running.Load() }

// RefreshInBackground starts one download when the file is missing or stale.
func (u *Updater) RefreshInBackground(now time.Time) {
	if !u.Stale(now) || !u.running.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer u.running.Store(false)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		if err := u.Download(ctx, now); err != nil {
			logger.Warning("ip location database download failed:", err)
		}
	}()
}

// Download fetches this month's edition (or last month's while the new one is
// not out yet), checks it opens, then swaps it in atomically.
func (u *Updater) Download(ctx context.Context, now time.Time) error {
	base := u.BaseURL
	if base == "" {
		base = defaultBaseURL
	}
	client := u.Client
	if client == nil {
		client = http.DefaultClient
	}
	var lastErr error
	for _, month := range []time.Time{now, now.AddDate(0, -1, 0)} {
		lastErr = u.fetch(ctx, client, editionURL(base, month), now)
		if lastErr == nil {
			return nil
		}
	}
	return lastErr
}

func (u *Updater) fetch(ctx context.Context, client *http.Client, url string, now time.Time) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}
	zr, err := gzip.NewReader(resp.Body)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(u.Dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(u.Dir, FileName+".*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, zr); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	// Prove the download is a usable database before it replaces a good one.
	probe := &Locator{}
	if err := probe.Load(tmp.Name(), now); err != nil {
		return fmt.Errorf("downloaded database is unreadable: %w", err)
	}
	probe.close()
	if err := os.Rename(tmp.Name(), u.path()); err != nil {
		return err
	}
	_ = os.Chtimes(u.path(), now, now)
	return u.Loc.Load(u.path(), now)
}

func (l *Locator) close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.db != nil {
		_ = l.db.Close()
		l.db = nil
	}
}
