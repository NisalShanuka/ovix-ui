package reseller

import (
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"

	"ovix.store/ovix-ui/internal/database"
	"ovix.store/ovix-ui/internal/database/model"
	"ovix.store/ovix-ui/internal/logger"
	"ovix.store/ovix-ui/internal/util/crypto"
)

const minPasswordLen = 8

// Ledger reasons stored in ovix_credit_ledger.reason.
const (
	ReasonTopup        = "topup"
	ReasonAdjust       = "adjust"
	ReasonClientCreate = "client_create"
	ReasonClientRenew  = "client_renew"
	ReasonRefund       = "refund"
)

var (
	ErrUsernameInvalid     = errors.New("username must be 1-64 characters without spaces")
	ErrUsernameTaken       = errors.New("that username is already used by another login")
	ErrPasswordTooShort    = errors.New("password must be at least 8 characters")
	ErrUnknownInbound      = errors.New("unknown inbound id")
	ErrNotReseller         = errors.New("no reseller with that id")
	ErrInsufficientCredit  = errors.New("not enough credit")
	ErrZeroCredit          = errors.New("credit change must not be zero")
	ErrResellerHasClients  = errors.New("reseller still has clients: disable it instead, or move or delete its clients first")
	ErrResellerDisabled    = errors.New("reseller account is disabled")
	errLedgerReasonMissing = errors.New("ledger reason is required")
)

// ResellerView is what the owner API returns for one reseller.
type ResellerView struct {
	UserId      int    `json:"userId" example:"2"`
	Username    string `json:"username" example:"shop1"`
	Disabled    bool   `json:"disabled" example:"false"`
	Credit      int64  `json:"credit" example:"120"`
	Note        string `json:"note" example:"Kandy shop"`
	CreatedAt   int64  `json:"createdAt" example:"1762819200000"`
	ClientCount int64  `json:"clientCount" example:"14"`
	InboundIds  []int  `json:"inboundIds" example:"[1,3]"`
}

// LoginPolicy rejects disabled resellers and reports whether the panel's
// global 2FA applies: it is the owner's, so only owner logins need it.
func LoginPolicy(userID int) (ownerLogin bool, err error) {
	var admin model.OvixAdmin
	err = database.GetDB().Where("user_id = ?", userID).Take(&admin).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	if admin.Disabled {
		return false, ErrResellerDisabled
	}
	return false, nil
}

func normalizeUsername(username string) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" || len(username) > 64 || strings.ContainsAny(username, " \t\r\n") {
		return "", ErrUsernameInvalid
	}
	return username, nil
}

func checkInbounds(tx *gorm.DB, inboundIDs []int) error {
	if len(inboundIDs) == 0 {
		return nil
	}
	var n int64
	if err := tx.Model(&model.Inbound{}).Where("id IN ?", inboundIDs).Count(&n).Error; err != nil {
		return err
	}
	if int(n) != len(uniqueInts(inboundIDs)) {
		return ErrUnknownInbound
	}
	return nil
}

func uniqueInts(in []int) []int {
	seen := make(map[int]bool, len(in))
	out := make([]int, 0, len(in))
	for _, v := range in {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func replaceInbounds(tx *gorm.DB, userID int, inboundIDs []int) error {
	if err := tx.Where("user_id = ?", userID).Delete(&model.OvixResellerInbound{}).Error; err != nil {
		return err
	}
	for _, id := range uniqueInts(inboundIDs) {
		if err := tx.Create(&model.OvixResellerInbound{UserId: userID, InboundId: id}).Error; err != nil {
			return err
		}
	}
	return nil
}

// CreateReseller adds a panel login with the reseller role and zero credit.
func CreateReseller(actorID int, username, password, note string, inboundIDs []int) (*ResellerView, error) {
	username, err := normalizeUsername(username)
	if err != nil {
		return nil, err
	}
	if len(password) < minPasswordLen {
		return nil, ErrPasswordTooShort
	}
	hash, err := crypto.HashPasswordAsBcrypt(password)
	if err != nil {
		return nil, err
	}
	var userID int
	err = database.GetDB().Transaction(func(tx *gorm.DB) error {
		var taken int64
		if err := tx.Model(&model.User{}).Where("LOWER(username) = LOWER(?)", username).Count(&taken).Error; err != nil {
			return err
		}
		if taken > 0 {
			return ErrUsernameTaken
		}
		if err := checkInbounds(tx, inboundIDs); err != nil {
			return err
		}
		user := &model.User{Username: username, Password: hash}
		if err := tx.Create(user).Error; err != nil {
			return err
		}
		userID = user.Id
		admin := &model.OvixAdmin{UserId: user.Id, Role: model.OvixRoleReseller, Note: strings.TrimSpace(note)}
		if err := tx.Create(admin).Error; err != nil {
			return err
		}
		return replaceInbounds(tx, user.Id, inboundIDs)
	})
	if err != nil {
		return nil, err
	}
	return GetReseller(userID)
}

// GetReseller loads one reseller with its inbounds and live client count.
func GetReseller(userID int) (*ResellerView, error) {
	views, err := listResellers(userID)
	if err != nil {
		return nil, err
	}
	if len(views) == 0 {
		return nil, ErrNotReseller
	}
	return &views[0], nil
}

// ListResellers returns every reseller, oldest first.
func ListResellers() ([]ResellerView, error) {
	return listResellers(0)
}

func listResellers(onlyID int) ([]ResellerView, error) {
	db := database.GetDB()
	q := db.Table("ovix_admins AS a").
		Select("a.user_id, u.username, a.disabled, a.credit, a.note, a.created_at").
		Joins("JOIN users AS u ON u.id = a.user_id").
		Order("a.user_id")
	if onlyID > 0 {
		q = q.Where("a.user_id = ?", onlyID)
	}
	var views []ResellerView
	if err := q.Scan(&views).Error; err != nil {
		return nil, err
	}
	for i := range views {
		v := &views[i]
		if err := db.Model(&model.OvixResellerInbound{}).Where("user_id = ?", v.UserId).
			Order("inbound_id").Pluck("inbound_id", &v.InboundIds).Error; err != nil {
			return nil, err
		}
		if v.InboundIds == nil {
			v.InboundIds = []int{}
		}
		count, err := ownedClientCount(db, v.UserId)
		if err != nil {
			return nil, err
		}
		v.ClientCount = count
	}
	return views, nil
}

// ownedClientCount ignores owner rows whose client was deleted elsewhere,
// even when its id was reused by a newer client.
func ownedClientCount(db *gorm.DB, userID int) (int64, error) {
	var n int64
	err := db.Table("ovix_client_owners AS o").
		Joins("JOIN clients AS c ON c.id = o.client_id AND c.created_at = o.client_created_at").
		Where("o.user_id = ?", userID).Count(&n).Error
	return n, err
}

func requireReseller(tx *gorm.DB, userID int) error {
	var n int64
	if err := tx.Model(&model.OvixAdmin{}).Where("user_id = ?", userID).Count(&n).Error; err != nil {
		return err
	}
	if n == 0 {
		return ErrNotReseller
	}
	return nil
}

func bumpLoginEpoch(tx *gorm.DB, userID int) error {
	return tx.Model(&model.User{}).Where("id = ?", userID).
		Update("login_epoch", gorm.Expr("login_epoch + 1")).Error
}

// UpdateReseller sets note, disabled and allowed inbounds. Disabling ends the
// reseller's open sessions; its clients keep working.
func UpdateReseller(userID int, note string, disabled bool, inboundIDs []int) (*ResellerView, error) {
	err := database.GetDB().Transaction(func(tx *gorm.DB) error {
		var admin model.OvixAdmin
		if err := tx.Where("user_id = ?", userID).Take(&admin).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotReseller
			}
			return err
		}
		if err := checkInbounds(tx, inboundIDs); err != nil {
			return err
		}
		if err := tx.Model(&model.OvixAdmin{}).Where("user_id = ?", userID).
			Updates(map[string]any{"note": strings.TrimSpace(note), "disabled": disabled}).Error; err != nil {
			return err
		}
		if disabled && !admin.Disabled {
			if err := bumpLoginEpoch(tx, userID); err != nil {
				return err
			}
		}
		return replaceInbounds(tx, userID, inboundIDs)
	})
	if err != nil {
		return nil, err
	}
	return GetReseller(userID)
}

// SetResellerPassword replaces the password and ends open sessions.
func SetResellerPassword(userID int, password string) error {
	if len(password) < minPasswordLen {
		return ErrPasswordTooShort
	}
	hash, err := crypto.HashPasswordAsBcrypt(password)
	if err != nil {
		return err
	}
	return database.GetDB().Transaction(func(tx *gorm.DB) error {
		if err := requireReseller(tx, userID); err != nil {
			return err
		}
		if err := tx.Model(&model.User{}).Where("id = ?", userID).Update("password", hash).Error; err != nil {
			return err
		}
		return bumpLoginEpoch(tx, userID)
	})
}

// DeleteReseller removes a reseller login that no longer owns any client.
// Its ledger and audit rows are kept as history.
func DeleteReseller(userID int) error {
	return database.GetDB().Transaction(func(tx *gorm.DB) error {
		if err := requireReseller(tx, userID); err != nil {
			return err
		}
		count, err := ownedClientCount(tx, userID)
		if err != nil {
			return err
		}
		if count > 0 {
			return ErrResellerHasClients
		}
		for _, m := range []any{&model.OvixClientOwner{}, &model.OvixResellerInbound{}, &model.OvixAdmin{}} {
			if err := tx.Where("user_id = ?", userID).Delete(m).Error; err != nil {
				return err
			}
		}
		return tx.Delete(&model.User{}, userID).Error
	})
}

// CreditChange is one balance change and the ledger row that records it.
type CreditChange struct {
	UserID      int
	Delta       int64
	Reason      string
	ClientEmail string
	Days        int
	ActorID     int
}

// ApplyCredit changes a reseller's balance inside tx and appends the ledger
// row. The conditional UPDATE makes concurrent spends unable to overdraw.
func ApplyCredit(tx *gorm.DB, ch CreditChange) (int64, error) {
	if ch.Delta == 0 {
		return 0, ErrZeroCredit
	}
	if ch.Reason == "" {
		return 0, errLedgerReasonMissing
	}
	res := tx.Model(&model.OvixAdmin{}).
		Where("user_id = ? AND credit + ? >= 0", ch.UserID, ch.Delta).
		Update("credit", gorm.Expr("credit + ?", ch.Delta))
	if res.Error != nil {
		return 0, res.Error
	}
	if res.RowsAffected == 0 {
		if err := requireReseller(tx, ch.UserID); err != nil {
			return 0, err
		}
		return 0, ErrInsufficientCredit
	}
	var admin model.OvixAdmin
	if err := tx.Where("user_id = ?", ch.UserID).Take(&admin).Error; err != nil {
		return 0, err
	}
	row := &model.OvixCreditLedger{
		UserId:       ch.UserID,
		Delta:        ch.Delta,
		BalanceAfter: admin.Credit,
		Reason:       ch.Reason,
		ClientEmail:  ch.ClientEmail,
		Days:         ch.Days,
		ActorId:      ch.ActorID,
	}
	if err := tx.Create(row).Error; err != nil {
		return 0, err
	}
	return admin.Credit, nil
}

// AdjustCredit is the owner adding (top-up) or removing credit by hand.
func AdjustCredit(actorID, userID int, delta int64) (int64, error) {
	reason := ReasonTopup
	if delta < 0 {
		reason = ReasonAdjust
	}
	var balance int64
	err := database.GetDB().Transaction(func(tx *gorm.DB) error {
		var err error
		balance, err = ApplyCredit(tx, CreditChange{UserID: userID, Delta: delta, Reason: reason, ActorID: actorID})
		return err
	})
	return balance, err
}

// Ledger returns a reseller's newest ledger rows first.
func Ledger(userID, limit int) ([]model.OvixCreditLedger, error) {
	rows := []model.OvixCreditLedger{}
	err := database.GetDB().Where("user_id = ?", userID).
		Order("id DESC").Limit(clampLimit(limit)).Find(&rows).Error
	return rows, err
}

// AuditLog returns the newest audit rows first.
func AuditLog(limit int) ([]model.OvixAuditLog, error) {
	rows := []model.OvixAuditLog{}
	err := database.GetDB().Order("id DESC").Limit(clampLimit(limit)).Find(&rows).Error
	return rows, err
}

func clampLimit(limit int) int {
	if limit <= 0 || limit > 500 {
		return 500
	}
	return limit
}

// Audit records an action; a failure is logged, never returned, so auditing
// can not break the action it describes.
func Audit(actorID int, action, target string, detail any, ip string) {
	raw, err := json.Marshal(detail)
	if err != nil {
		raw = []byte("null")
	}
	row := &model.OvixAuditLog{ActorId: actorID, Action: action, Target: target, Detail: string(raw), IP: ip}
	if err := database.GetDB().Create(row).Error; err != nil {
		logger.Warning("ovix audit: write failed:", err)
	}
}
