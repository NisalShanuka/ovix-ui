package panel

import (
	"errors"
	"testing"

	"ovix.store/ovix-ui/internal/config"
)

// Without an Ovix release source, self-update must never fetch upstream 3x-ui
// releases: that would replace the Ovix binary with plain 3x-ui.
func TestSelfUpdateDisabledWithoutReleaseSource(t *testing.T) {
	prev := ovixReleaseRepo
	ovixReleaseRepo = ""
	t.Cleanup(func() { ovixReleaseRepo = prev })
	s := &PanelService{}

	t.Run("StartUpdate refuses", func(t *testing.T) {
		if _, err := s.StartUpdate(); !errors.Is(err, errSelfUpdateDisabled) {
			t.Fatalf("StartUpdate() error = %v, want errSelfUpdateDisabled", err)
		}
	})
	t.Run("StartUpdateChannel refuses on both channels", func(t *testing.T) {
		for _, dev := range []bool{false, true} {
			if _, err := s.StartUpdateChannel(dev); !errors.Is(err, errSelfUpdateDisabled) {
				t.Fatalf("StartUpdateChannel(%v) error = %v, want errSelfUpdateDisabled", dev, err)
			}
		}
	})
	t.Run("GetUpdateInfo reports no update without a network call", func(t *testing.T) {
		info, err := s.GetUpdateInfo()
		if err != nil {
			t.Fatalf("GetUpdateInfo() error = %v", err)
		}
		current := config.GetBaseVersion()
		if info.UpdateAvailable || info.LatestVersion != current || info.CurrentVersion != current {
			t.Fatalf("GetUpdateInfo() = %+v, want no update and latest == current %q", info, current)
		}
	})
}
