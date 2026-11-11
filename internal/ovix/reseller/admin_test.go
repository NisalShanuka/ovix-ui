package reseller

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"ovix.store/ovix-ui/internal/database"
	"ovix.store/ovix-ui/internal/database/dbtest"
	"ovix.store/ovix-ui/internal/database/model"
	"ovix.store/ovix-ui/internal/util/crypto"
)

const ownerActor = 1

func initAdminDB(t *testing.T) {
	t.Helper()
	dbtest.InitDB(t, filepath.Join(t.TempDir(), "ovix-ui.db"))
}

func seedInbound(t *testing.T, port int) int {
	t.Helper()
	in := &model.Inbound{Remark: "in", Port: port, Protocol: model.VLESS, Tag: "inbound-test-" + string(rune('a'+port%26)), Enable: true}
	if err := database.GetDB().Create(in).Error; err != nil {
		t.Fatalf("seed inbound: %v", err)
	}
	return in.Id
}

func TestCreateResellerValidatesAndStores(t *testing.T) {
	initAdminDB(t)
	inboundID := seedInbound(t, 20001)

	view, err := CreateReseller(ownerActor, "  shop1 ", "longenough", "first shop", []int{inboundID})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if view.Username != "shop1" || view.Credit != 0 || view.Disabled || len(view.InboundIds) != 1 || view.InboundIds[0] != inboundID {
		t.Fatalf("view = %+v", view)
	}
	var user model.User
	if err := database.GetDB().First(&user, view.UserId).Error; err != nil {
		t.Fatalf("load user: %v", err)
	}
	if user.Password == "longenough" || !crypto.CheckPasswordHash(user.Password, "longenough") {
		t.Fatal("password must be stored as a bcrypt hash of the given password")
	}

	cases := []struct {
		name, username, password string
		inbounds                 []int
		want                     error
	}{
		{"duplicate username", "shop1", "longenough", nil, ErrUsernameTaken},
		{"owner's username", "admin", "longenough", nil, ErrUsernameTaken},
		{"empty username", "   ", "longenough", nil, ErrUsernameInvalid},
		{"short password", "shop2", "short", nil, ErrPasswordTooShort},
		{"unknown inbound", "shop3", "longenough", []int{99999}, ErrUnknownInbound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := CreateReseller(ownerActor, tc.username, tc.password, "", tc.inbounds); !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestAdjustCreditKeepsBalanceAndLedgerInStep(t *testing.T) {
	initAdminDB(t)
	view, err := CreateReseller(ownerActor, "shop", "longenough", "", nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if bal, err := AdjustCredit(ownerActor, view.UserId, 30); err != nil || bal != 30 {
		t.Fatalf("top up: bal=%d err=%v", bal, err)
	}
	if _, err := AdjustCredit(ownerActor, view.UserId, -31); !errors.Is(err, ErrInsufficientCredit) {
		t.Fatalf("overdraw err = %v, want ErrInsufficientCredit", err)
	}
	if bal, err := AdjustCredit(ownerActor, view.UserId, -10); err != nil || bal != 20 {
		t.Fatalf("remove: bal=%d err=%v", bal, err)
	}
	if _, err := AdjustCredit(ownerActor, ownerActor, 5); !errors.Is(err, ErrNotReseller) {
		t.Fatalf("credit on owner err = %v, want ErrNotReseller", err)
	}

	rows, err := Ledger(view.UserId, 50)
	if err != nil {
		t.Fatalf("ledger: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("ledger rows = %d, want 2 (the refused overdraw writes none)", len(rows))
	}
	// Newest first.
	if rows[0].Delta != -10 || rows[0].BalanceAfter != 20 || rows[0].Reason != ReasonAdjust ||
		rows[1].Delta != 30 || rows[1].BalanceAfter != 30 || rows[1].Reason != ReasonTopup {
		t.Fatalf("ledger = %+v", rows)
	}
}

func TestConcurrentSpendNeverOverdraws(t *testing.T) {
	initAdminDB(t)
	view, err := CreateReseller(ownerActor, "shop", "longenough", "", nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := AdjustCredit(ownerActor, view.UserId, 10); err != nil {
		t.Fatalf("top up: %v", err)
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	succeeded := 0
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := AdjustCredit(ownerActor, view.UserId, -3); err == nil {
				mu.Lock()
				succeeded++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	var admin model.OvixAdmin
	if err := database.GetDB().Take(&admin, "user_id = ?", view.UserId).Error; err != nil {
		t.Fatalf("load: %v", err)
	}
	if admin.Credit < 0 || admin.Credit != 10-3*int64(succeeded) || succeeded > 3 {
		t.Fatalf("credit=%d after %d spends of 3 from 10", admin.Credit, succeeded)
	}
	rows, _ := Ledger(view.UserId, 100)
	if len(rows) != 1+succeeded {
		t.Fatalf("ledger rows = %d, want %d", len(rows), 1+succeeded)
	}
}

func TestDisableEndsSessionsAndDeleteNeedsNoClients(t *testing.T) {
	initAdminDB(t)
	view, err := CreateReseller(ownerActor, "shop", "longenough", "", nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	epochOf := func() int64 {
		var u model.User
		_ = database.GetDB().First(&u, view.UserId).Error
		return u.LoginEpoch
	}
	before := epochOf()
	if _, err := UpdateReseller(view.UserId, "note", true, nil); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if epochOf() != before+1 {
		t.Fatal("disabling must bump login_epoch so open sessions end")
	}
	if err := SetResellerPassword(view.UserId, "another-pass"); err != nil {
		t.Fatalf("password: %v", err)
	}
	if epochOf() != before+2 {
		t.Fatal("a password change must bump login_epoch")
	}

	client := &model.ClientRecord{Email: "c1@shop", SubID: "s1", Enable: true}
	if err := database.GetDB().Create(client).Error; err != nil {
		t.Fatalf("seed client: %v", err)
	}
	if err := database.GetDB().Create(&model.OvixClientOwner{ClientId: client.Id, UserId: view.UserId}).Error; err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	if err := DeleteReseller(view.UserId); !errors.Is(err, ErrResellerHasClients) {
		t.Fatalf("delete with clients err = %v, want ErrResellerHasClients", err)
	}
	if err := database.GetDB().Delete(client).Error; err != nil {
		t.Fatalf("drop client: %v", err)
	}
	if err := DeleteReseller(view.UserId); err != nil {
		t.Fatalf("delete after the client is gone: %v", err)
	}
	var users, admins int64
	database.GetDB().Model(&model.User{}).Where("id = ?", view.UserId).Count(&users)
	database.GetDB().Model(&model.OvixAdmin{}).Where("user_id = ?", view.UserId).Count(&admins)
	if users != 0 || admins != 0 {
		t.Fatalf("after delete: users=%d ovix_admins=%d, want 0 and 0", users, admins)
	}
}
