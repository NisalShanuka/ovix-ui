package sentinel

import (
	"testing"
	"time"
)

func TestParseLine(t *testing.T) {
	cases := []struct {
		name string
		line string
		want Hit
		ok   bool
	}{
		{
			"tcp with >> route",
			"2026/11/11 20:01:02.123456 from tcp:203.0.114.7:51234 accepted tcp:5.6.7.8:6881 [inbound-443 >> torrent-out] email: kasun",
			Hit{ClientIP: "203.0.114.7", Target: "5.6.7.8:6881", Route: "torrent-out", Email: "kasun"},
			true,
		},
		{
			"udp with -> route and no from prefix",
			"2026/11/11 20:01:02 from 198.100.1.2:40000 accepted udp:dht.example.org:51413 [in-80 -> blocked] email: shop1.nimal",
			Hit{ClientIP: "198.100.1.2", Target: "dht.example.org:51413", Route: "blocked", Email: "shop1.nimal"},
			true,
		},
		{
			"ipv6 client and target",
			"2026/11/11 20:01:02 from tcp:[2a01:4f8::1]:443 accepted tcp:[2606:4700::1111]:6881 [in >> torrent-out] email: v6user",
			Hit{ClientIP: "2a01:4f8::1", Target: "[2606:4700::1111]:6881", Route: "torrent-out", Email: "v6user"},
			true,
		},
		{
			"windows line ending",
			"2026/11/11 from 1.1.1.1:1 accepted tcp:8.8.8.8:6881 [a >> torrent-out] email: crlf\r\n",
			Hit{ClientIP: "1.1.1.1", Target: "8.8.8.8:6881", Route: "torrent-out", Email: "crlf"},
			true,
		},
		{"no email", "2026/11/11 from 1.1.1.1:1 accepted tcp:8.8.8.8:6881 [a >> torrent-out]", Hit{}, false},
		{"rejected line", "2026/11/11 from 1.1.1.1:1 rejected  proxy/vless: invalid request", Hit{}, false},
		{"api line", "2026/11/11 from 127.0.0.1:5000 accepted tcp:127.0.0.1:62789 [api -> api]", Hit{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ParseLine(tc.line)
			if ok != tc.ok || got != tc.want {
				t.Fatalf("ParseLine = %+v, %v; want %+v, %v", got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestIsPublicTarget(t *testing.T) {
	cases := map[string]bool{
		"5.6.7.8:6881":           true,
		"dht.example.org:51413":  true,
		"[2606:4700::1111]:6881": true,
		"10.1.2.3:80":            false,
		"172.16.0.1:80":          false,
		"172.32.0.1:80":          true,
		"192.168.1.1:80":         false,
		"127.0.0.1:62789":        false,
		"169.254.1.1:80":         false,
		"100.64.0.1:80":          false,
		"100.128.0.1:80":         true,
		"192.0.2.1:80":           false,
		"198.51.100.9:80":        false,
		"203.0.113.9:80":         false,
		"198.18.0.1:80":          false,
		"224.0.0.251:5353":       false,
		"255.255.255.255:67":     false,
		"0.0.0.0:0":              false,
		"[::1]:80":               false,
		"[fe80::1]:80":           false,
		"[fd00::1]:80":           false,
		"printer.local:631":      false,
		"nas.lan:445":            false,
		"router.home.arpa:80":    false,
		"":                       false,
		"8.8.8.8":                true,
	}
	for target, want := range cases {
		if got := IsPublicTarget(target); got != want {
			t.Errorf("IsPublicTarget(%q) = %v, want %v", target, got, want)
		}
	}
}

func TestDetectorModesAndCooldowns(t *testing.T) {
	base := time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)
	torrent := Hit{ClientIP: "1.1.1.1", Target: "5.6.7.8:6881", Route: RouteTorrent, Email: "kasun"}
	blocked := Hit{ClientIP: "1.1.1.1", Target: "5.6.7.8:6881", Route: RouteBlocked, Email: "kasun"}
	private := Hit{ClientIP: "1.1.1.1", Target: "192.0.2.1:80", Route: RouteBlocked, Email: "kasun"}

	t.Run("monitor mode ignores blocked routes (geoip:private, ads)", func(t *testing.T) {
		d := NewDetector()
		if v := d.Observe(blocked, ModeMonitor, base); v.Counted {
			t.Fatalf("blocked route in monitor mode counted: %+v", v)
		}
		if v := d.Observe(torrent, ModeMonitor, base); !v.Counted || !v.NewIncident || !v.Alert {
			t.Fatalf("first torrent hit = %+v, want counted, incident and alert", v)
		}
	})

	t.Run("block mode counts blocked routes but never private targets", func(t *testing.T) {
		d := NewDetector()
		if v := d.Observe(private, ModeBlock, base); v.Counted {
			t.Fatalf("private target counted: %+v", v)
		}
		if v := d.Observe(blocked, ModeBlock, base); !v.Counted || !v.NewIncident {
			t.Fatalf("blocked hit in block mode = %+v", v)
		}
	})

	t.Run("one incident per 45s and one alert per 60s, with the burst count", func(t *testing.T) {
		d := NewDetector()
		d.Observe(torrent, ModeMonitor, base)
		for i := 1; i <= 4; i++ {
			v := d.Observe(torrent, ModeMonitor, base.Add(time.Duration(i)*10*time.Second))
			if v.NewIncident || v.Alert {
				t.Fatalf("hit %d inside the cooldowns = %+v", i, v)
			}
		}
		v := d.Observe(torrent, ModeMonitor, base.Add(45*time.Second))
		if !v.NewIncident || v.Alert {
			t.Fatalf("at 45s = %+v, want a new incident but no alert", v)
		}
		v = d.Observe(torrent, ModeMonitor, base.Add(60*time.Second))
		if v.NewIncident || !v.Alert || v.Burst != 6 {
			t.Fatalf("at 60s = %+v, want an alert covering the 6 hits since the last one", v)
		}
	})

	t.Run("cooldowns are per client", func(t *testing.T) {
		d := NewDetector()
		d.Observe(torrent, ModeMonitor, base)
		other := torrent
		other.Email = "nimal"
		if v := d.Observe(other, ModeMonitor, base.Add(time.Second)); !v.NewIncident || !v.Alert {
			t.Fatalf("second client inside the first's cooldown = %+v", v)
		}
	})

	t.Run("active torrent users are those seen in the last 2 minutes", func(t *testing.T) {
		d := NewDetector()
		d.Observe(torrent, ModeMonitor, base)
		if got := d.ActiveUsers(base.Add(119 * time.Second)); len(got) != 1 || got[0] != "kasun" {
			t.Fatalf("active at 119s = %v", got)
		}
		if got := d.ActiveUsers(base.Add(121 * time.Second)); len(got) != 0 {
			t.Fatalf("active at 121s = %v, want none", got)
		}
	})
}
