package panel

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"ovix.store/ovix-ui/internal/config"
	"ovix.store/ovix-ui/internal/database/dbtest"
)

const testReleaseToken = "github_pat_0123456789abcdefghijKLMNOP"

// privateRepo serves the release repo the way GitHub does for a private one:
// every route answers 404 unless the request carries the right token.
func privateRepo(t *testing.T) {
	t.Helper()
	t.Setenv("OVIX_DB_FOLDER", t.TempDir())
	dbtest.InitDB(t, config.GetDBPath())

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testReleaseToken {
			http.NotFound(w, r)
			return
		}
		switch r.URL.Path {
		case "/repos/owner/ovix-ui":
			_, _ = w.Write([]byte(`{"private":true}`))
		case "/repos/owner/ovix-ui/releases/latest":
			_, _ = w.Write([]byte(`{"tag_name":"v99.0.0"}`))
		case "/repos/owner/ovix-ui/contents/update.sh":
			if r.URL.Query().Get("ref") != "main" || r.Header.Get("Accept") != "application/vnd.github.raw" {
				http.Error(w, "wrong ref or media type", http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte("#!/bin/bash\necho updater\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	prevBase, prevRepo := githubAPIBase, ovixReleaseRepo
	githubAPIBase, ovixReleaseRepo = srv.URL, "owner/ovix-ui"
	t.Cleanup(func() { githubAPIBase, ovixReleaseRepo = prevBase, prevRepo })
}

func TestUpdateInfoAsksForTokenWhenRepoIsHidden(t *testing.T) {
	privateRepo(t)
	info, err := (&PanelService{}).GetUpdateInfo()
	if err != nil {
		t.Fatalf("GetUpdateInfo() error = %v, want the token prompt instead of a failure", err)
	}
	if !info.NeedsToken || info.TokenSet || info.UpdateAvailable {
		t.Fatalf("GetUpdateInfo() = %+v, want NeedsToken without an update", info)
	}
}

func TestSavedTokenUnlocksPrivateReleases(t *testing.T) {
	privateRepo(t)
	s := &PanelService{}
	if err := s.SetReleaseToken("  " + testReleaseToken + "\n"); err != nil {
		t.Fatalf("SetReleaseToken() error = %v", err)
	}
	info, err := s.GetUpdateInfo()
	if err != nil {
		t.Fatalf("GetUpdateInfo() error = %v", err)
	}
	if info.NeedsToken || !info.TokenSet || info.LatestVersion != "v99.0.0" || !info.UpdateAvailable {
		t.Fatalf("GetUpdateInfo() = %+v, want v99.0.0 available through the token", info)
	}

	path, err := downloadPanelUpdater()
	if err != nil {
		t.Fatalf("downloadPanelUpdater() error = %v", err)
	}
	defer os.Remove(path)
	if body, _ := os.ReadFile(path); string(body) != "#!/bin/bash\necho updater\n" {
		t.Fatalf("updater body = %q, want update.sh from main", body)
	}
}

func TestTokenFileIsPrivate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits; the updater only runs on Linux")
	}
	privateRepo(t)
	if err := (&PanelService{}).SetReleaseToken(testReleaseToken); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(ReleaseTokenPath())
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("token file mode = %o, want 600", st.Mode().Perm())
	}
}

func TestSetReleaseTokenRefusesTokensThatCannotReadTheRepo(t *testing.T) {
	privateRepo(t)
	s := &PanelService{}
	cases := []struct {
		name, token string
		want        error
	}{
		{"rejected by GitHub", "ghp_" + strings.Repeat("x", 36), errReleaseKeyRejected},
		{"not a token", "ghp_abc def\nrm -rf /", errInvalidReleaseKey},
		{"too short", "ghp_short", errInvalidReleaseKey},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := s.SetReleaseToken(tc.token); !errors.Is(err, tc.want) {
				t.Fatalf("SetReleaseToken() error = %v, want %v", err, tc.want)
			}
			if _, err := os.Stat(ReleaseTokenPath()); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("a refused token was saved (stat err = %v)", err)
			}
		})
	}
}

func TestEmptyTokenRemovesTheSavedOne(t *testing.T) {
	privateRepo(t)
	s := &PanelService{}
	if err := s.SetReleaseToken(testReleaseToken); err != nil {
		t.Fatal(err)
	}
	if err := s.SetReleaseToken(""); err != nil {
		t.Fatalf("clearing error = %v", err)
	}
	if s.ReleaseTokenSet() {
		t.Fatal("token still reported as set after clearing")
	}
	if _, err := os.Stat(filepath.Join(config.GetDBFolderPath(), "release-token")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("token file still present: %v", err)
	}
}
