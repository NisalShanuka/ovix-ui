package panel

import (
	"path/filepath"
	"testing"
	"time"

	"ovix.store/ovix-ui/internal/database"
	"ovix.store/ovix-ui/internal/database/dbtest"
	"ovix.store/ovix-ui/internal/database/model"
	"ovix.store/ovix-ui/internal/util/crypto"

	"github.com/xlzd/gotp"
)

func seedLogin(t *testing.T, username, password string, reseller *model.OvixAdmin) {
	t.Helper()
	hash, err := crypto.HashPasswordAsBcrypt(password)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	user := &model.User{Username: username, Password: hash}
	if err := database.GetDB().Create(user).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if reseller != nil {
		reseller.UserId = user.Id
		reseller.Role = model.OvixRoleReseller
		if err := database.GetDB().Create(reseller).Error; err != nil {
			t.Fatalf("seed reseller: %v", err)
		}
	}
}

func TestCheckUserResellerRules(t *testing.T) {
	dbtest.InitDB(t, filepath.Join(t.TempDir(), "ovix-ui.db"))
	s := &UserService{}
	const secret = "JBSWY3DPEHPK3PXP"
	if err := s.settingService.SetTwoFactorToken(secret); err != nil {
		t.Fatalf("set 2fa token: %v", err)
	}
	if err := s.settingService.SetTwoFactorEnable(true); err != nil {
		t.Fatalf("enable 2fa: %v", err)
	}
	seedLogin(t, "owner-2", "owner-pass-1", nil)
	seedLogin(t, "shop", "shop-pass-1", &model.OvixAdmin{})
	seedLogin(t, "gone", "gone-pass-1", &model.OvixAdmin{Disabled: true})
	ownerCode := gotp.NewDefaultTOTP(secret).AtTime(time.Now())

	t.Run("owner still needs the panel 2FA code", func(t *testing.T) {
		if _, err := s.CheckUser("owner-2", "owner-pass-1", ""); err == nil || err.Error() != "invalid 2fa code" {
			t.Fatalf("owner without code: err = %v, want invalid 2fa code", err)
		}
		if u, err := s.CheckUser("owner-2", "owner-pass-1", ownerCode); err != nil || u.Username != "owner-2" {
			t.Fatalf("owner with code: user=%v err=%v", u, err)
		}
	})
	t.Run("reseller logs in without the owner's 2FA code", func(t *testing.T) {
		if u, err := s.CheckUser("shop", "shop-pass-1", ""); err != nil || u.Username != "shop" {
			t.Fatalf("reseller login: user=%v err=%v", u, err)
		}
	})
	t.Run("disabled reseller is refused even with the right password", func(t *testing.T) {
		u, err := s.CheckUser("gone", "gone-pass-1", "")
		if u != nil || err == nil || err.Error() != "reseller account is disabled" {
			t.Fatalf("disabled reseller: user=%v err=%v, want reseller account is disabled", u, err)
		}
	})
}
