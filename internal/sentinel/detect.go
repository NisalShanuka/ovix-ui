// Package sentinel is the Ovix UI port of the ovix_sentinel.py sidecar: it
// watches the Xray access log for BitTorrent and reports it to the owner.
package sentinel

import (
	"net/netip"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Routes the bittorrent routing rule sends traffic to.
const (
	RouteTorrent = "torrent-out"
	RouteBlocked = "blocked"
)

// Mode is whether torrent traffic is let through (and measured) or dropped.
type Mode string

const (
	ModeMonitor Mode = "monitor"
	ModeBlock   Mode = "block"
)

const (
	incidentCooldown = 45 * time.Second
	alertCooldown    = 60 * time.Second
	activeWindow     = 2 * time.Minute
)

// Hit is one torrent-routed connection from the access log.
type Hit struct {
	ClientIP string
	Target   string
	Route    string
	Email    string
}

var lineRe = regexp.MustCompile(
	`from\s+(?:tcp:|udp:)?(\[[0-9a-fA-F:.]+\]|[0-9a-fA-F.:]+?):\d+\s+accepted\s+(?:tcp|udp):(\S+)\s+\[[^\]]*?(?:->|>>)\s*([^\]\s]+)\s*\]\s+email:\s*(\S+)`)

// ParseLine extracts a Hit from an Xray access-log line; ok is false for lines
// without a route and an email.
func ParseLine(line string) (Hit, bool) {
	m := lineRe.FindStringSubmatch(line)
	if m == nil {
		return Hit{}, false
	}
	return Hit{
		ClientIP: strings.Trim(m[1], "[]"),
		Target:   m[2],
		Route:    m[3],
		Email:    m[4],
	}, true
}

var nonPublicPrefixes = mustPrefixes(
	"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15",
	"198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "64:ff9b:1::/48", "2001:db8::/32",
)

func mustPrefixes(list ...string) []netip.Prefix {
	out := make([]netip.Prefix, len(list))
	for i, s := range list {
		out[i] = netip.MustParsePrefix(s)
	}
	return out
}

var localSuffixes = []string{".local", ".localhost", ".internal", ".lan", ".home.arpa"}

// IsPublicTarget reports whether host[:port] is on the public internet. LAN,
// loopback, multicast, CGNAT and documentation ranges are not torrent peers.
func IsPublicTarget(target string) bool {
	host := target
	if strings.HasPrefix(host, "[") {
		if end := strings.Index(host, "]"); end > 0 {
			host = host[1:end]
		}
	} else if i := strings.LastIndex(host, ":"); i > 0 && strings.Count(host, ":") == 1 {
		host = host[:i]
	}
	if host == "" {
		return false
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		lower := strings.ToLower(host)
		for _, s := range localSuffixes {
			if strings.HasSuffix(lower, s) {
				return false
			}
		}
		return true
	}
	addr = addr.Unmap()
	if addr.IsPrivate() || addr.IsLoopback() || addr.IsMulticast() || addr.IsLinkLocalUnicast() ||
		addr.IsLinkLocalMulticast() || addr.IsUnspecified() || addr == netip.AddrFrom4([4]byte{255, 255, 255, 255}) {
		return false
	}
	for _, p := range nonPublicPrefixes {
		if p.Contains(addr) {
			return false
		}
	}
	return true
}

// Verdict is what one hit means for the caller.
type Verdict struct {
	Counted     bool // a real torrent hit
	NewIncident bool // record an incident (first in incidentCooldown)
	Alert       bool // send a Discord alert (first in alertCooldown)
	Burst       int  // hits since the previous alert, sent with Alert
}

type clientState struct {
	lastSeen     time.Time
	lastTarget   string
	lastIncident time.Time
	lastAlert    time.Time
	sinceAlert   int
}

// Detector applies the mode rule and per-client cooldowns. Safe for concurrent use.
type Detector struct {
	mu      sync.Mutex
	clients map[string]*clientState
}

func NewDetector() *Detector {
	return &Detector{clients: map[string]*clientState{}}
}

// Observe classifies a hit. In monitor mode only torrent-out is torrent: the
// blocked outbound then carries geoip:private and ad blocking, never torrents.
func (d *Detector) Observe(h Hit, mode Mode, now time.Time) Verdict {
	if h.Email == "" || (h.Route != RouteTorrent && h.Route != RouteBlocked) {
		return Verdict{}
	}
	if mode == ModeMonitor && h.Route != RouteTorrent {
		return Verdict{}
	}
	if !IsPublicTarget(h.Target) {
		return Verdict{}
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	st := d.clients[h.Email]
	if st == nil {
		st = &clientState{}
		d.clients[h.Email] = st
	}
	st.lastSeen, st.lastTarget = now, h.Target
	st.sinceAlert++
	v := Verdict{Counted: true}
	if st.lastIncident.IsZero() || now.Sub(st.lastIncident) >= incidentCooldown {
		st.lastIncident = now
		v.NewIncident = true
	}
	if st.lastAlert.IsZero() || now.Sub(st.lastAlert) >= alertCooldown {
		st.lastAlert = now
		v.Alert, v.Burst = true, st.sinceAlert
		st.sinceAlert = 0
	}
	return v
}

// Seen marks a client as torrenting at t, used to restore state after a restart.
func (d *Detector) Seen(email, target string, t time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	st := d.clients[email]
	if st == nil {
		st = &clientState{}
		d.clients[email] = st
	}
	if t.After(st.lastSeen) {
		st.lastSeen, st.lastTarget = t, target
	}
}

// ActiveUsers returns the clients seen torrenting within the last 2 minutes.
func (d *Detector) ActiveUsers(now time.Time) []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	var out []string
	for email, st := range d.clients {
		if now.Sub(st.lastSeen) < activeWindow {
			out = append(out, email)
		}
	}
	sort.Strings(out)
	return out
}

// LastSeen returns when a client last torrented and to which target.
func (d *Detector) LastSeen(email string) (time.Time, string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if st := d.clients[email]; st != nil {
		return st.lastSeen, st.lastTarget
	}
	return time.Time{}, ""
}
