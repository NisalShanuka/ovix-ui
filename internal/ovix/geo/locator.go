// Package geo turns client IPs into map points with an offline IP database
// (DB-IP City Lite, CC BY 4.0), so no client address ever leaves the server.
package geo

import (
	"errors"
	"net/netip"
	"sync"
	"time"

	"github.com/oschwald/maxminddb-golang/v2"
)

// Place is where an IP address is, as precise as the database knows.
type Place struct {
	Lat         float64 `json:"lat" example:"6.9271"`
	Lon         float64 `json:"lon" example:"79.8612"`
	City        string  `json:"city" example:"Colombo"`
	Region      string  `json:"region" example:"Western Province"`
	Country     string  `json:"country" example:"Sri Lanka"`
	CountryCode string  `json:"countryCode" example:"LK"`
}

type record struct {
	City struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"city"`
	Country struct {
		ISOCode string            `maxminddb:"iso_code"`
		Names   map[string]string `maxminddb:"names"`
	} `maxminddb:"country"`
	Location struct {
		Latitude  float64 `maxminddb:"latitude"`
		Longitude float64 `maxminddb:"longitude"`
	} `maxminddb:"location"`
	Subdivisions []struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"subdivisions"`
}

// Locator answers IP lookups from one loaded database file and can swap in a
// newer file while readers keep going.
type Locator struct {
	mu      sync.RWMutex
	db      *maxminddb.Reader
	updated time.Time
}

// Load opens path and replaces the current database only if the new one opens.
func (l *Locator) Load(path string, updated time.Time) error {
	db, err := maxminddb.Open(path)
	if err != nil {
		return err
	}
	l.mu.Lock()
	old := l.db
	l.db, l.updated = db, updated
	l.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	return nil
}

// Ready reports whether a database is loaded, and when it was fetched.
func (l *Locator) Ready() (bool, time.Time) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.db != nil, l.updated
}

// ErrNoDatabase means no IP database has been loaded yet.
var ErrNoDatabase = errors.New("ip location database is not loaded yet")

// Lookup locates a public IP. Private, loopback and unknown addresses report
// found=false; they have no place on a world map.
func (l *Locator) Lookup(ip string) (Place, bool, error) {
	addr, err := netip.ParseAddr(ip)
	if err != nil || !isPublic(addr) {
		return Place{}, false, nil
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	if l.db == nil {
		return Place{}, false, ErrNoDatabase
	}
	var rec record
	res := l.db.Lookup(addr)
	if !res.Found() {
		return Place{}, false, res.Err()
	}
	if err := res.Decode(&rec); err != nil {
		return Place{}, false, err
	}
	p := Place{
		Lat:         rec.Location.Latitude,
		Lon:         rec.Location.Longitude,
		City:        rec.City.Names["en"],
		Country:     rec.Country.Names["en"],
		CountryCode: rec.Country.ISOCode,
	}
	if len(rec.Subdivisions) > 0 {
		p.Region = rec.Subdivisions[0].Names["en"]
	}
	return p, true, nil
}

func isPublic(a netip.Addr) bool {
	a = a.Unmap()
	return a.IsValid() && a.IsGlobalUnicast() && !a.IsPrivate() && !a.IsLoopback() &&
		!netip.MustParsePrefix("100.64.0.0/10").Contains(a)
}
