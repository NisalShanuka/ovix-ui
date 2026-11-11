package reseller

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"ovix.store/ovix-ui/internal/database"
	"ovix.store/ovix-ui/internal/database/dbtest"
	"ovix.store/ovix-ui/internal/database/model"
)

type clientFixture struct {
	shop, other int
	inbound     int
	forbidden   int
}

func mkClientInbound(t *testing.T, port int, settings string) int {
	t.Helper()
	ib := &model.Inbound{
		Tag:      "vless-" + filepath.Base(t.TempDir()),
		Enable:   true,
		Port:     port,
		Protocol: model.VLESS,
		Settings: settings,
	}
	if err := database.GetDB().Create(ib).Error; err != nil {
		t.Fatalf("create inbound: %v", err)
	}
	return ib.Id
}

// setupClients makes two resellers: shop (40 credit, may use inbound) and
// other (40 credit, same inbound); forbidden is an inbound nobody may use.
func setupClients(t *testing.T) clientFixture {
	t.Helper()
	dbDir := t.TempDir()
	t.Setenv("OVIX_DB_FOLDER", dbDir)
	dbtest.InitDB(t, filepath.Join(dbDir, "ovix-ui.db"))
	f := clientFixture{
		inbound:   mkClientInbound(t, 22001, `{"clients":[],"decryption":"none"}`),
		forbidden: mkClientInbound(t, 22002, `{"clients":[],"decryption":"none"}`),
	}
	for _, name := range []string{"shop", "other"} {
		v, err := CreateReseller(ownerActor, name, "longenough", "", []int{f.inbound})
		if err != nil {
			t.Fatalf("create reseller %s: %v", name, err)
		}
		if _, err := AdjustCredit(ownerActor, v.UserId, 40); err != nil {
			t.Fatalf("top up %s: %v", name, err)
		}
		if name == "shop" {
			f.shop = v.UserId
		} else {
			f.other = v.UserId
		}
	}
	return f
}

func creditOf(t *testing.T, userID int) int64 {
	t.Helper()
	var a model.OvixAdmin
	if err := database.GetDB().Take(&a, "user_id = ?", userID).Error; err != nil {
		t.Fatalf("load credit: %v", err)
	}
	return a.Credit
}

func recordOf(t *testing.T, email string) (*model.ClientRecord, bool) {
	t.Helper()
	var rec model.ClientRecord
	err := database.GetDB().Where("email = ?", email).Take(&rec).Error
	if err != nil {
		return nil, false
	}
	return &rec, true
}

func near(t *testing.T, got, want int64) {
	t.Helper()
	if d := got - want; d < -60_000 || d > 60_000 {
		t.Fatalf("time = %d, want %d (±1 min)", got, want)
	}
}

func TestResellerCreateChargesDaysAndOwnsTheClient(t *testing.T) {
	f := setupClients(t)
	view, err := CreateClient(f.shop, NewClientInput{Email: "kasun", Days: 30, InboundIds: []int{f.inbound}, LimitIP: 2, TrafficLimitGB: 50})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if got := creditOf(t, f.shop); got != 10 {
		t.Fatalf("credit = %d, want 40-30 = 10", got)
	}
	rec, ok := recordOf(t, "kasun")
	if !ok {
		t.Fatal("client record missing")
	}
	near(t, rec.ExpiryTime, time.Now().Add(30*24*time.Hour).UnixMilli())
	if rec.TotalGB != 50*bytesPerGB || rec.LimitIP != 2 || !rec.Enable || rec.Reset != 0 {
		t.Fatalf("record = %+v", rec)
	}
	if view.Email != "kasun" || len(view.InboundIds) != 1 || view.InboundIds[0] != f.inbound {
		t.Fatalf("view = %+v", view)
	}
	var owner model.OvixClientOwner
	if err := database.GetDB().Take(&owner, "client_id = ?", rec.Id).Error; err != nil || owner.UserId != f.shop {
		t.Fatalf("owner row = %+v err=%v", owner, err)
	}
	rows, _ := Ledger(f.shop, 10)
	if rows[0].Reason != ReasonClientCreate || rows[0].Delta != -30 || rows[0].Days != 30 || rows[0].ClientEmail != "kasun" {
		t.Fatalf("ledger = %+v", rows[0])
	}
}

func TestResellerCreateFirstUseStartsOnConnect(t *testing.T) {
	f := setupClients(t)
	if _, err := CreateClient(f.shop, NewClientInput{Email: "later", Days: 7, InboundIds: []int{f.inbound}, StartOnFirstUse: true}); err != nil {
		t.Fatalf("create: %v", err)
	}
	rec, _ := recordOf(t, "later")
	if rec.ExpiryTime != -7*dayMs {
		t.Fatalf("expiry = %d, want %d (3x-ui delayed start)", rec.ExpiryTime, -7*dayMs)
	}
}

func TestResellerCreateRefusalsChargeNothing(t *testing.T) {
	f := setupClients(t)
	if _, err := CreateClient(f.shop, NewClientInput{Email: "taken", Days: 1, InboundIds: []int{f.inbound}}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	cases := []struct {
		name string
		in   NewClientInput
		want error
	}{
		{"zero days", NewClientInput{Email: "a", Days: 0, InboundIds: []int{f.inbound}}, ErrDaysRange},
		{"over ten years", NewClientInput{Email: "a", Days: maxDays + 1, InboundIds: []int{f.inbound}}, ErrDaysRange},
		{"no inbound", NewClientInput{Email: "a", Days: 1}, ErrInboundNotAllowed},
		{"inbound not allowed", NewClientInput{Email: "a", Days: 1, InboundIds: []int{f.forbidden}}, ErrInboundNotAllowed},
		{"not enough credit", NewClientInput{Email: "a", Days: 40, InboundIds: []int{f.inbound}}, ErrInsufficientCredit},
		{"email taken", NewClientInput{Email: "taken", Days: 1, InboundIds: []int{f.inbound}}, ErrEmailTaken},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := CreateClient(f.shop, tc.in); !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if got := creditOf(t, f.shop); got != 39 {
				t.Fatalf("credit = %d, want 39 (only the seed client charged)", got)
			}
		})
	}
}

func TestResellerCreateFailureRefunds(t *testing.T) {
	f := setupClients(t)
	broken := mkClientInbound(t, 22003, `not json`)
	if _, err := UpdateReseller(f.shop, "", false, []int{f.inbound, broken}); err != nil {
		t.Fatalf("allow broken inbound: %v", err)
	}
	if _, err := CreateClient(f.shop, NewClientInput{Email: "fails", Days: 10, InboundIds: []int{broken}}); err == nil {
		t.Fatal("create on an inbound with broken settings must fail")
	}
	if got := creditOf(t, f.shop); got != 40 {
		t.Fatalf("credit = %d, want 40 after the refund", got)
	}
	if _, ok := recordOf(t, "fails"); ok {
		t.Fatal("no client record may survive a refunded create")
	}
	rows, _ := Ledger(f.shop, 10)
	if rows[0].Reason != ReasonRefund || rows[0].Delta != 10 || rows[1].Reason != ReasonClientCreate {
		t.Fatalf("ledger = %+v", rows[:2])
	}
}

func TestResellerRenewExtendsFromLaterOfNowAndExpiry(t *testing.T) {
	f := setupClients(t)
	if _, err := CreateClient(f.shop, NewClientInput{Email: "live", Days: 10, InboundIds: []int{f.inbound}}); err != nil {
		t.Fatalf("create: %v", err)
	}
	before, _ := recordOf(t, "live")
	if _, err := RenewClient(f.shop, "live", 5); err != nil {
		t.Fatalf("renew live: %v", err)
	}
	after, _ := recordOf(t, "live")
	if after.ExpiryTime != before.ExpiryTime+5*dayMs {
		t.Fatalf("live renew expiry = %d, want old + 5 days", after.ExpiryTime)
	}

	past := time.Now().Add(-48 * time.Hour).UnixMilli()
	if err := database.GetDB().Model(&model.ClientRecord{}).Where("email = ?", "live").
		Updates(map[string]any{"expiry_time": past, "enable": false}).Error; err != nil {
		t.Fatalf("expire: %v", err)
	}
	if _, err := RenewClient(f.shop, "live", 3); err != nil {
		t.Fatalf("renew expired: %v", err)
	}
	expired, _ := recordOf(t, "live")
	near(t, expired.ExpiryTime, time.Now().Add(3*24*time.Hour).UnixMilli())
	if !expired.Enable {
		t.Fatal("renewing an expired client must enable it again")
	}
	if got := creditOf(t, f.shop); got != 40-10-5-3 {
		t.Fatalf("credit = %d, want %d", got, 40-10-5-3)
	}

	if _, err := CreateClient(f.shop, NewClientInput{Email: "delayed", Days: 2, InboundIds: []int{f.inbound}, StartOnFirstUse: true}); err != nil {
		t.Fatalf("create delayed: %v", err)
	}
	if _, err := RenewClient(f.shop, "delayed", 4); err != nil {
		t.Fatalf("renew delayed: %v", err)
	}
	delayed, _ := recordOf(t, "delayed")
	if delayed.ExpiryTime != -6*dayMs {
		t.Fatalf("delayed expiry = %d, want -6 days", delayed.ExpiryTime)
	}
}

func TestResellerCannotTouchOthersClients(t *testing.T) {
	f := setupClients(t)
	if _, err := CreateClient(f.shop, NewClientInput{Email: "mine", Days: 1, InboundIds: []int{f.inbound}}); err != nil {
		t.Fatalf("create: %v", err)
	}
	ownerClient := &model.ClientRecord{Email: "owners", SubID: "owners-sub", Enable: true}
	if err := database.GetDB().Create(ownerClient).Error; err != nil {
		t.Fatalf("seed owner client: %v", err)
	}
	for _, email := range []string{"mine", "owners", "missing"} {
		if email == "mine" {
			if _, err := RenewClient(f.other, email, 1); !errors.Is(err, ErrNotYourClient) {
				t.Fatalf("other renews shop's client: err = %v", err)
			}
			continue
		}
		if _, err := RenewClient(f.shop, email, 1); !errors.Is(err, ErrNotYourClient) {
			t.Fatalf("renew %s: err = %v, want ErrNotYourClient", email, err)
		}
		if err := DeleteClient(f.shop, email); !errors.Is(err, ErrNotYourClient) {
			t.Fatalf("delete %s: err = %v, want ErrNotYourClient", email, err)
		}
		if _, err := UpdateClient(f.shop, email, ClientUpdateInput{Enable: true}); !errors.Is(err, ErrNotYourClient) {
			t.Fatalf("update %s: err = %v, want ErrNotYourClient", email, err)
		}
	}
	if got := creditOf(t, f.other); got != 40 {
		t.Fatalf("other's credit = %d, a refused renew must not charge", got)
	}
	list, err := ListClients(f.other)
	if err != nil || len(list) != 0 {
		t.Fatalf("other's list = %+v err=%v, want empty", list, err)
	}
	mine, err := ListClients(f.shop)
	if err != nil || len(mine) != 1 || mine[0].Email != "mine" {
		t.Fatalf("shop's list = %+v err=%v", mine, err)
	}
}

func TestResellerUpdateKeepsExpiryAndDeleteDoesNotRefund(t *testing.T) {
	f := setupClients(t)
	if _, err := CreateClient(f.shop, NewClientInput{Email: "edit", Days: 5, InboundIds: []int{f.inbound}}); err != nil {
		t.Fatalf("create: %v", err)
	}
	before, _ := recordOf(t, "edit")
	if _, err := UpdateClient(f.shop, "edit", ClientUpdateInput{Enable: false, LimitIP: 3, TrafficLimitGB: 20, Comment: "vip", TgID: 77}); err != nil {
		t.Fatalf("update: %v", err)
	}
	after, _ := recordOf(t, "edit")
	if after.ExpiryTime != before.ExpiryTime || after.Enable || after.LimitIP != 3 || after.TotalGB != 20*bytesPerGB ||
		after.Comment != "vip" || after.TgID != 77 || after.UUID != before.UUID || after.SubID != before.SubID {
		t.Fatalf("after update = %+v", after)
	}

	if err := DeleteClient(f.shop, "edit"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, ok := recordOf(t, "edit"); ok {
		t.Fatal("client still exists after delete")
	}
	if got := creditOf(t, f.shop); got != 35 {
		t.Fatalf("credit = %d, want 35 (no refund on delete)", got)
	}
	var owners int64
	database.GetDB().Model(&model.OvixClientOwner{}).Where("client_id = ?", before.Id).Count(&owners)
	if owners != 0 {
		t.Fatal("owner row must go with the client")
	}
}
