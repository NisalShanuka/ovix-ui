package geo

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/maxmind/mmdbwriter"
	"github.com/maxmind/mmdbwriter/mmdbtype"

	"ovix.store/ovix-ui/internal/xray"
)

// writeFixture builds a tiny DB-IP-shaped database: Colombo, London, and a
// private and a CGNAT range that a careless lookup would put on the map.
func writeFixture(t *testing.T, path string) {
	t.Helper()
	w, err := mmdbwriter.New(mmdbwriter.Options{DatabaseType: "DBIP-City-Lite", RecordSize: 28, IncludeReservedNetworks: true})
	if err != nil {
		t.Fatal(err)
	}
	place := func(city, region, country, code string, lat, lon float64) mmdbtype.Map {
		return mmdbtype.Map{
			"city":         mmdbtype.Map{"names": mmdbtype.Map{"en": mmdbtype.String(city)}},
			"subdivisions": mmdbtype.Slice{mmdbtype.Map{"names": mmdbtype.Map{"en": mmdbtype.String(region)}}},
			"country": mmdbtype.Map{
				"iso_code": mmdbtype.String(code),
				"names":    mmdbtype.Map{"en": mmdbtype.String(country)},
			},
			"location": mmdbtype.Map{"latitude": mmdbtype.Float64(lat), "longitude": mmdbtype.Float64(lon)},
		}
	}
	for cidr, rec := range map[string]mmdbtype.Map{
		"175.157.0.0/16": place("Colombo", "Western Province", "Sri Lanka", "LK", 6.9271, 79.8612),
		"81.2.69.0/24":   place("London", "England", "United Kingdom", "GB", 51.5142, -0.0931),
		"10.0.0.0/8":     place("Private", "", "Nowhere", "ZZ", 1, 1),
		"100.64.0.0/10":  place("Carrier NAT", "", "Nowhere", "ZZ", 2, 2),
	} {
		_, n, _ := net.ParseCIDR(cidr)
		if err := w.Insert(n, rec); err != nil {
			t.Fatal(err)
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := w.WriteTo(f); err != nil {
		t.Fatal(err)
	}
}

func loadedLocator(t *testing.T) *Locator {
	t.Helper()
	path := filepath.Join(t.TempDir(), FileName)
	writeFixture(t, path)
	loc := &Locator{}
	if err := loc.Load(path, time.Unix(1, 0)); err != nil {
		t.Fatal(err)
	}
	return loc
}

func TestLookupPlacesPublicIPs(t *testing.T) {
	loc := loadedLocator(t)
	got, found, err := loc.Lookup("175.157.44.10")
	if err != nil || !found {
		t.Fatalf("Lookup = found %v err %v, want a place", found, err)
	}
	want := Place{Lat: 6.9271, Lon: 79.8612, City: "Colombo", Region: "Western Province", Country: "Sri Lanka", CountryCode: "LK"}
	if got != want {
		t.Fatalf("Lookup = %+v, want %+v", got, want)
	}
	if got, found, _ := loc.Lookup("::ffff:81.2.69.160"); !found || got.City != "London" {
		t.Fatalf("an IPv4-mapped IPv6 address must resolve like plain IPv4, got %+v found %v", got, found)
	}
}

func TestLookupLeavesPrivateAndUnknownAddressesOff(t *testing.T) {
	loc := loadedLocator(t)
	for _, ip := range []string{"10.0.0.7", "192.168.1.20", "127.0.0.1", "100.64.3.3", "8.8.8.8", "not-an-ip"} {
		if p, found, err := loc.Lookup(ip); found || err != nil {
			t.Errorf("Lookup(%q) = %+v found %v err %v, want not found", ip, p, found, err)
		}
	}
}

func TestLookupWithoutDatabaseSaysSo(t *testing.T) {
	if _, _, err := (&Locator{}).Lookup("175.157.44.10"); !errors.Is(err, ErrNoDatabase) {
		t.Fatalf("err = %v, want ErrNoDatabase", err)
	}
}

func TestBuildMapPlacesEachClientIPOnceAndCountsTheRest(t *testing.T) {
	loc := loadedLocator(t)
	users := []xray.OnlineUser{
		{Email: "kasun", IPs: []xray.OnlineIP{{IP: "175.157.44.10", LastSeen: 100}, {IP: "175.157.44.10", LastSeen: 90}, {IP: "10.1.1.1"}}},
		{Email: "amal", IPs: []xray.OnlineIP{{IP: "81.2.69.160", LastSeen: 50}}},
	}
	view := BuildMap(loc, users, "81.2.69.1")

	if len(view.Points) != 2 || view.Points[0].Email != "amal" || view.Points[1].Email != "kasun" {
		t.Fatalf("points = %+v, want amal then kasun, each once", view.Points)
	}
	if view.Points[1].LastSeen != 100 || view.Points[1].City != "Colombo" {
		t.Fatalf("kasun point = %+v, want the first sighting placed in Colombo", view.Points[1])
	}
	if view.Unlocated != 1 {
		t.Fatalf("unlocated = %d, want 1 (the private 10.1.1.1)", view.Unlocated)
	}
	if view.Server == nil || view.Server.City != "London" {
		t.Fatalf("server = %+v, want placed in London", view.Server)
	}
}

func TestBuildMapWithoutDatabaseCountsEveryIPAsUnlocated(t *testing.T) {
	users := []xray.OnlineUser{{Email: "kasun", IPs: []xray.OnlineIP{{IP: "175.157.44.10"}, {IP: "81.2.69.160"}}}}
	view := BuildMap(&Locator{}, users, "81.2.69.1")
	if len(view.Points) != 0 || view.Unlocated != 2 || view.Server != nil {
		t.Fatalf("view = %+v, want no points, 2 unlocated, no server", view)
	}
}

func gzipped(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	_, _ = zw.Write(raw)
	_ = zw.Close()
	return buf.Bytes()
}

func TestDownloadFallsBackToLastMonthAndLoadsIt(t *testing.T) {
	fixture := filepath.Join(t.TempDir(), "fixture.mmdb")
	writeFixture(t, fixture)
	body := gzipped(t, fixture)
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.URL.Path)
		if r.URL.Path != "/dbip-city-lite-2026-10.mmdb.gz" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	u := &Updater{Dir: t.TempDir(), BaseURL: srv.URL, Loc: &Locator{}}
	now := time.Date(2026, 11, 1, 3, 0, 0, 0, time.UTC)
	if err := u.Download(context.Background(), now); err != nil {
		t.Fatalf("Download: %v", err)
	}
	if len(asked) != 2 || asked[0] != "/dbip-city-lite-2026-11.mmdb.gz" {
		t.Fatalf("requests = %v, want this month first, then last month", asked)
	}
	if _, found, _ := u.Loc.Lookup("175.157.44.10"); !found {
		t.Fatal("downloaded database was not loaded")
	}
	if u.Stale(now.Add(24 * time.Hour)) {
		t.Fatal("a fresh download must not count as stale the next day")
	}
	if !u.Stale(now.Add(36 * 24 * time.Hour)) {
		t.Fatal("a 36-day-old database must count as stale")
	}
}

func TestDownloadKeepsTheGoodDatabaseWhenTheNewOneIsBroken(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, filepath.Join(dir, FileName))
	u := &Updater{Dir: dir, Loc: &Locator{}}
	if err := u.LoadExisting(); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		zw := gzip.NewWriter(w)
		_, _ = zw.Write([]byte("this is not a database"))
		_ = zw.Close()
	}))
	defer srv.Close()
	u.BaseURL = srv.URL

	if err := u.Download(context.Background(), time.Now()); err == nil {
		t.Fatal("Download of a broken file must fail")
	}
	if _, found, _ := u.Loc.Lookup("175.157.44.10"); !found {
		t.Fatal("the loaded database must survive a broken download")
	}
	if err := (&Locator{}).Load(filepath.Join(dir, FileName), time.Now()); err != nil {
		t.Fatalf("the file on disk was replaced by the broken download: %v", err)
	}
}
