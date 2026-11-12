package panel

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"ovix.store/ovix-ui/internal/config"
	"ovix.store/ovix-ui/internal/web/service"
)

// githubAPIBase is a var so tests can serve the release repo from httptest.
var githubAPIBase = "https://api.github.com"

var (
	// errReleaseAccess means GitHub hid the release repo: private without a token, or the token lacks access.
	errReleaseAccess      = errors.New("the Ovix UI release repository is not reachable with the saved access token")
	errInvalidReleaseKey  = errors.New("the access token has an unexpected format")
	errReleaseKeyRejected = errors.New("GitHub did not accept this token for the Ovix UI release repository")
)

// GitHub classic (ghp_) and fine-grained (github_pat_) tokens are word characters only.
var releaseTokenPattern = regexp.MustCompile(`^[A-Za-z0-9_]{20,255}$`)

// ReleaseTokenPath is shared with update.sh/install.sh, which read the same root-only file.
func ReleaseTokenPath() string {
	return filepath.Join(config.GetDBFolderPath(), "release-token")
}

func readReleaseToken() string {
	data, err := os.ReadFile(ReleaseTokenPath())
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func repoAPIURL(path string) string {
	return githubAPIBase + "/repos/" + ovixReleaseRepo + path
}

func newReleaseRequest(ctx context.Context, url, accept, token string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", accept)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req, nil
}

// releaseStatusErr maps GitHub's answer for a hidden private repo (404, or 401/403
// for a bad token) to errReleaseAccess, so the panel can ask for a token.
func releaseStatusErr(status int) error {
	switch status {
	case http.StatusOK:
		return nil
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound:
		return fmt.Errorf("%w (HTTP %d)", errReleaseAccess, status)
	default:
		return fmt.Errorf("GitHub API returned status %d", status)
	}
}

// ReleaseTokenSet reports whether an access token is saved, without revealing it.
func (s *PanelService) ReleaseTokenSet() bool {
	return readReleaseToken() != ""
}

// SetReleaseToken saves the token after GitHub confirms it can read the release
// repo; an empty token removes the saved one.
func (s *PanelService) SetReleaseToken(token string) error {
	if err := releaseSourceConfigured(); err != nil {
		return err
	}
	token = strings.TrimSpace(token)
	path := ReleaseTokenPath()
	if token == "" {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	if !releaseTokenPattern.MatchString(token) {
		return errInvalidReleaseKey
	}
	client := (&service.SettingService{}).NewProxiedHTTPClient(10 * time.Second)
	req, err := newReleaseRequest(context.Background(), repoAPIURL(""), "application/vnd.github+json", token)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("check access token: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w (HTTP %d)", errReleaseKeyRejected, resp.StatusCode)
	}
	return writePrivateFile(path, token+"\n")
}

// writePrivateFile replaces path atomically with a 0600 file.
func writePrivateFile(path, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".release-token-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
