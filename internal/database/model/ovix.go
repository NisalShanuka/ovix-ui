package model

// Ovix UI fork tables. They live in their own file and their own tables so an
// upstream merge never touches them; see OVIX_PANEL_PLAN.md section 3a.

// OvixRoleReseller is the only stored role: a users row without an OvixAdmin
// row is the panel owner, so the original login and API tokens stay the owner.
const OvixRoleReseller = "reseller"

// OvixAdmin marks a panel login as a reseller and holds its prepaid credit
// (1 credit = 1 client-day).
type OvixAdmin struct {
	UserId    int    `json:"userId" gorm:"primaryKey;autoIncrement:false;column:user_id"`
	Role      string `json:"role" gorm:"not null;default:reseller"`
	Disabled  bool   `json:"disabled" gorm:"not null;default:false"`
	Credit    int64  `json:"credit" gorm:"not null;default:0"`
	Note      string `json:"note"`
	CreatedAt int64  `json:"createdAt" gorm:"autoCreateTime:milli"`
}

func (OvixAdmin) TableName() string { return "ovix_admins" }

// OvixResellerInbound lists the inbounds a reseller may put clients on.
type OvixResellerInbound struct {
	UserId    int `json:"userId" gorm:"primaryKey;autoIncrement:false;column:user_id"`
	InboundId int `json:"inboundId" gorm:"primaryKey;autoIncrement:false;column:inbound_id"`
}

func (OvixResellerInbound) TableName() string { return "ovix_reseller_inbounds" }

// OvixClientOwner records which reseller created a client; no row means the
// client belongs to the owner.
type OvixClientOwner struct {
	ClientId int `json:"clientId" gorm:"primaryKey;autoIncrement:false;column:client_id"`
	UserId   int `json:"userId" gorm:"not null;index:idx_ovix_client_owners_user;column:user_id"`
}

func (OvixClientOwner) TableName() string { return "ovix_client_owners" }

// OvixCreditLedger is the append-only history of a reseller's credit; each row
// is written in the same transaction as the balance change it records.
type OvixCreditLedger struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId       int    `json:"userId" gorm:"not null;index:idx_ovix_credit_ledger_user;column:user_id"`
	Delta        int64  `json:"delta" gorm:"not null"`
	BalanceAfter int64  `json:"balanceAfter" gorm:"not null;column:balance_after"`
	Reason       string `json:"reason" gorm:"not null"`
	ClientEmail  string `json:"clientEmail" gorm:"column:client_email"`
	Days         int    `json:"days"`
	ActorId      int    `json:"actorId" gorm:"column:actor_id"`
	CreatedAt    int64  `json:"createdAt" gorm:"autoCreateTime:milli;index:idx_ovix_credit_ledger_created"`
}

func (OvixCreditLedger) TableName() string { return "ovix_credit_ledger" }

// OvixAuditLog records reseller actions and owner actions on resellers.
type OvixAuditLog struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	ActorId   int    `json:"actorId" gorm:"not null;index:idx_ovix_audit_log_actor;column:actor_id"`
	Action    string `json:"action" gorm:"not null"`
	Target    string `json:"target"`
	Detail    string `json:"detail"`
	IP        string `json:"ip" gorm:"column:ip"`
	CreatedAt int64  `json:"createdAt" gorm:"autoCreateTime:milli;index:idx_ovix_audit_log_created"`
}

func (OvixAuditLog) TableName() string { return "ovix_audit_log" }

// OvixModels is appended to the auto-migrated model list, so migrate-db and
// backups carry these tables too.
func OvixModels() []any {
	return []any{
		&OvixAdmin{},
		&OvixResellerInbound{},
		&OvixClientOwner{},
		&OvixCreditLedger{},
		&OvixAuditLog{},
	}
}
