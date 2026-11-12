package geo

import (
	"sort"

	"ovix.store/ovix-ui/internal/xray"
)

// Point is one client connection placed on the map.
type Point struct {
	Email    string `json:"email" example:"kasun"`
	IP       string `json:"ip" example:"175.157.44.10"`
	LastSeen int64  `json:"lastSeen" example:"1794423797"`
	Place
}

// ServerPoint is where the panel's own server is.
type ServerPoint struct {
	IP string `json:"ip" example:"64.120.95.214"`
	Place
}

// MapView is everything the client map draws.
type MapView struct {
	Ready       bool         `json:"ready" example:"true"`
	Downloading bool         `json:"downloading" example:"false"`
	Updated     int64        `json:"updated" example:"1794423797"`
	Server      *ServerPoint `json:"server"`
	Points      []Point      `json:"points"`
	Unlocated   int          `json:"unlocated" example:"0"`
}

type lookuper interface {
	Lookup(ip string) (Place, bool, error)
}

// BuildMap places every live client IP; addresses the database cannot place
// (private, loopback, unknown) are only counted, so the owner sees they exist.
func BuildMap(loc lookuper, users []xray.OnlineUser, serverIP string) MapView {
	view := MapView{Points: []Point{}}
	seen := map[string]bool{}
	for _, u := range users {
		for _, entry := range u.IPs {
			key := u.Email + "|" + entry.IP
			if seen[key] {
				continue
			}
			seen[key] = true
			place, found, err := loc.Lookup(entry.IP)
			if err != nil || !found {
				view.Unlocated++
				continue
			}
			view.Points = append(view.Points, Point{Email: u.Email, IP: entry.IP, LastSeen: entry.LastSeen, Place: place})
		}
	}
	sort.Slice(view.Points, func(i, j int) bool {
		if view.Points[i].Email != view.Points[j].Email {
			return view.Points[i].Email < view.Points[j].Email
		}
		return view.Points[i].IP < view.Points[j].IP
	})
	if place, found, err := loc.Lookup(serverIP); err == nil && found {
		view.Server = &ServerPoint{IP: serverIP, Place: place}
	}
	return view
}
