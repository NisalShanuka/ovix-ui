package reseller

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"ovix.store/ovix-ui/internal/database"
	"ovix.store/ovix-ui/internal/database/model"
	"ovix.store/ovix-ui/internal/logger"
	"ovix.store/ovix-ui/internal/web/service"
	"ovix.store/ovix-ui/internal/web/websocket"
)

const (
	dayMs      int64 = 24 * 60 * 60 * 1000
	bytesPerGB int64 = 1 << 30
	maxDays          = 3650
)

var (
	ErrDaysRange         = fmt.Errorf("days must be between 1 and %d", maxDays)
	ErrInboundNotAllowed = errors.New("pick at least one inbound you are allowed to use")
	ErrEmailTaken        = errors.New("a client with that email already exists")
	ErrNotYourClient     = errors.New("no client with that email in your account")
	ErrUnlimitedClient   = errors.New("this client never expires, so it can not be renewed")
	ErrTrafficLimit      = errors.New("traffic limit must be 0 (unlimited) or more GB")
)

// clientMu serialises reseller client changes: a renew reads the expiry and
// writes it back, so two at once could charge twice and extend once.
var clientMu sync.Mutex

// NewClientInput is what a reseller sends to create a client.
type NewClientInput struct {
	Email           string `json:"email" form:"email"`
	Days            int    `json:"days" form:"days"`
	InboundIds      []int  `json:"inboundIds" form:"inboundIds"`
	TrafficLimitGB  int64  `json:"trafficLimitGB" form:"trafficLimitGB"`
	LimitIP         int    `json:"limitIp" form:"limitIp"`
	Comment         string `json:"comment" form:"comment"`
	TgID            int64  `json:"tgId" form:"tgId"`
	StartOnFirstUse bool   `json:"startOnFirstUse" form:"startOnFirstUse"`
}

// ClientUpdateInput is every field a reseller may change without credit.
type ClientUpdateInput struct {
	Enable         bool   `json:"enable" form:"enable"`
	TrafficLimitGB int64  `json:"trafficLimitGB" form:"trafficLimitGB"`
	LimitIP        int    `json:"limitIp" form:"limitIp"`
	Comment        string `json:"comment" form:"comment"`
	TgID           int64  `json:"tgId" form:"tgId"`
}

// ClientView is one reseller client as the reseller API returns it.
type ClientView struct {
	Email      string `json:"email" example:"kasun"`
	SubID      string `json:"subId" example:"k7d9s2f1x0q4m8n3"`
	Enable     bool   `json:"enable" example:"true"`
	ExpiryTime int64  `json:"expiryTime" example:"1765411200000"`
	TotalBytes int64  `json:"totalBytes" example:"53687091200"`
	Up         int64  `json:"up" example:"104857600"`
	Down       int64  `json:"down" example:"2147483648"`
	LimitIP    int    `json:"limitIp" example:"2"`
	Comment    string `json:"comment" example:"Kasun, Galle"`
	TgID       int64  `json:"tgId" example:"0"`
	InboundIds []int  `json:"inboundIds" example:"[1]"`
	CreatedAt  int64  `json:"createdAt" example:"1762819200000"`
}

var (
	clientService  service.ClientService
	inboundService service.InboundService
	xrayService    service.XrayService
	settingService service.SettingService
)

func afterClientChange(needRestart bool) {
	if needRestart {
		xrayService.SetToNeedRestart()
	}
	websocket.BroadcastInvalidate(websocket.MessageTypeClients)
}

func allowedInbounds(userID int) (map[int]bool, error) {
	var ids []int
	if err := database.GetDB().Model(&model.OvixResellerInbound{}).Where("user_id = ?", userID).
		Pluck("inbound_id", &ids).Error; err != nil {
		return nil, err
	}
	set := make(map[int]bool, len(ids))
	for _, id := range ids {
		set[id] = true
	}
	return set, nil
}

// ownedRecord loads a client only if userID created it; anything else, owner
// clients included, reads as not found so emails of others never leak.
func ownedRecord(userID int, email string) (*model.ClientRecord, error) {
	rec, err := clientService.GetRecordByEmail(nil, strings.TrimSpace(email))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotYourClient
	}
	if err != nil {
		return nil, err
	}
	var n int64
	if err := database.GetDB().Model(&model.OvixClientOwner{}).
		Where("client_id = ? AND user_id = ? AND client_created_at = ?", rec.Id, userID, rec.CreatedAt).
		Count(&n).Error; err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrNotYourClient
	}
	return rec, nil
}

func requireDays(days int) error {
	if days < 1 || days > maxDays {
		return ErrDaysRange
	}
	return nil
}

func spend(userID int, days int, reason, email string) error {
	return database.GetDB().Transaction(func(tx *gorm.DB) error {
		_, err := ApplyCredit(tx, CreditChange{UserID: userID, Delta: -int64(days), Reason: reason, ClientEmail: email, Days: days, ActorID: userID})
		return err
	})
}

func refund(userID int, days int, email string) {
	err := database.GetDB().Transaction(func(tx *gorm.DB) error {
		_, err := ApplyCredit(tx, CreditChange{UserID: userID, Delta: int64(days), Reason: ReasonRefund, ClientEmail: email, Days: days, ActorID: userID})
		return err
	})
	if err != nil {
		logger.Errorf("ovix reseller: refund of %d credit to user %d for %q failed: %v", days, userID, email, err)
	}
}

// CreateClient charges Days credit, then creates the client. If the create
// fails, any partly created client is removed and the credit refunded.
func CreateClient(userID int, in NewClientInput) (*ClientView, error) {
	clientMu.Lock()
	defer clientMu.Unlock()

	in.Email = strings.TrimSpace(in.Email)
	if err := requireDays(in.Days); err != nil {
		return nil, err
	}
	if in.TrafficLimitGB < 0 {
		return nil, ErrTrafficLimit
	}
	allowed, err := allowedInbounds(userID)
	if err != nil {
		return nil, err
	}
	inboundIDs := uniqueInts(in.InboundIds)
	if len(inboundIDs) == 0 {
		return nil, ErrInboundNotAllowed
	}
	for _, id := range inboundIDs {
		if !allowed[id] {
			return nil, ErrInboundNotAllowed
		}
	}
	if _, err := clientService.GetRecordByEmail(nil, in.Email); err == nil {
		return nil, ErrEmailTaken
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if err := spend(userID, in.Days, ReasonClientCreate, in.Email); err != nil {
		return nil, err
	}
	expiry := time.Now().UnixMilli() + int64(in.Days)*dayMs
	if in.StartOnFirstUse {
		expiry = -int64(in.Days) * dayMs
	}
	payload := &service.ClientCreatePayload{
		Client: model.Client{
			Email:      in.Email,
			Enable:     true,
			ExpiryTime: expiry,
			TotalGB:    in.TrafficLimitGB * bytesPerGB,
			LimitIP:    in.LimitIP,
			Comment:    strings.TrimSpace(in.Comment),
			TgID:       in.TgID,
		},
		InboundIds: inboundIDs,
	}
	needRestart, createErr := clientService.Create(&inboundService, payload)
	if createErr != nil {
		return nil, undoFailedCreate(userID, in, needRestart, createErr)
	}
	rec, err := clientService.GetRecordByEmail(nil, in.Email)
	if err == nil {
		err = database.GetDB().Create(&model.OvixClientOwner{ClientId: rec.Id, UserId: userID, ClientCreatedAt: rec.CreatedAt}).Error
	}
	afterClientChange(needRestart)
	if err != nil {
		return nil, fmt.Errorf("client created but its owner was not recorded: %w", err)
	}
	return clientView(rec)
}

func undoFailedCreate(userID int, in NewClientInput, needRestart bool, createErr error) error {
	if _, err := clientService.GetRecordByEmail(nil, in.Email); err == nil {
		delRestart, delErr := clientService.DeleteByEmail(&inboundService, in.Email, false)
		afterClientChange(needRestart || delRestart)
		if delErr != nil {
			logger.Errorf("ovix reseller: cleanup of partly created %q failed: %v", in.Email, delErr)
			return fmt.Errorf("client was only partly created and could not be removed; ask the panel owner: %w", createErr)
		}
	}
	refund(userID, in.Days, in.Email)
	return createErr
}

// RenewClient charges days credit and extends the expiry from the later of
// now and the current expiry; a not-yet-started client gets a longer duration.
func RenewClient(userID int, email string, days int) (*ClientView, error) {
	clientMu.Lock()
	defer clientMu.Unlock()

	if err := requireDays(days); err != nil {
		return nil, err
	}
	rec, err := ownedRecord(userID, email)
	if err != nil {
		return nil, err
	}
	if rec.ExpiryTime == 0 {
		return nil, ErrUnlimitedClient
	}
	if err := spend(userID, days, ReasonClientRenew, rec.Email); err != nil {
		return nil, err
	}
	updated := rec.ToClient()
	add := int64(days) * dayMs
	if rec.ExpiryTime < 0 {
		updated.ExpiryTime = rec.ExpiryTime - add
	} else {
		updated.ExpiryTime = max(rec.ExpiryTime, time.Now().UnixMilli()) + add
	}
	updated.Enable = true
	needRestart, err := clientService.Update(&inboundService, rec.Id, *updated, rec.LimitHwid)
	afterClientChange(needRestart)
	if err != nil {
		refund(userID, days, rec.Email)
		return nil, err
	}
	return reloadView(rec.Email)
}

// UpdateClient changes the credit-free fields; expiry and inbounds stay.
func UpdateClient(userID int, email string, in ClientUpdateInput) (*ClientView, error) {
	clientMu.Lock()
	defer clientMu.Unlock()

	if in.TrafficLimitGB < 0 {
		return nil, ErrTrafficLimit
	}
	rec, err := ownedRecord(userID, email)
	if err != nil {
		return nil, err
	}
	updated := rec.ToClient()
	updated.Enable = in.Enable
	updated.TotalGB = in.TrafficLimitGB * bytesPerGB
	updated.LimitIP = in.LimitIP
	updated.Comment = strings.TrimSpace(in.Comment)
	updated.TgID = in.TgID
	needRestart, err := clientService.Update(&inboundService, rec.Id, *updated, rec.LimitHwid)
	afterClientChange(needRestart)
	if err != nil {
		return nil, err
	}
	return reloadView(rec.Email)
}

// DeleteClient removes a client; unused days are not refunded.
func DeleteClient(userID int, email string) error {
	clientMu.Lock()
	defer clientMu.Unlock()

	rec, err := ownedRecord(userID, email)
	if err != nil {
		return err
	}
	needRestart, err := clientService.DeleteByEmail(&inboundService, rec.Email, false)
	afterClientChange(needRestart)
	if err != nil {
		return err
	}
	return database.GetDB().Where("client_id = ?", rec.Id).Delete(&model.OvixClientOwner{}).Error
}

// ResetClientTraffic zeroes a client's used traffic.
func ResetClientTraffic(userID int, email string) error {
	clientMu.Lock()
	defer clientMu.Unlock()

	rec, err := ownedRecord(userID, email)
	if err != nil {
		return err
	}
	needRestart, err := clientService.ResetTrafficByEmail(&inboundService, rec.Email)
	afterClientChange(needRestart)
	return err
}

// ClientLinks returns the subscription URLs and share links of a client.
func ClientLinks(userID int, email, host string) (map[string][]string, error) {
	rec, err := ownedRecord(userID, email)
	if err != nil {
		return nil, err
	}
	subURLs, err := subscriptionURLs(host, rec.SubID)
	if err != nil {
		return nil, err
	}
	links, err := inboundService.GetAllClientLinks(host, rec.Email)
	if err != nil {
		return nil, err
	}
	return map[string][]string{"subscription": subURLs, "links": links}, nil
}

// subscriptionURLs builds the client's subscription URLs the way the owner
// panel does: each enabled format's base URI plus the subId.
func subscriptionURLs(host, subID string) ([]string, error) {
	urls := []string{}
	if subID == "" {
		return urls, nil
	}
	settings, err := settingService.GetDefaultSettings(host)
	if err != nil {
		return nil, err
	}
	values, _ := settings.(map[string]any)
	for _, f := range [][2]string{{"subEnable", "subURI"}, {"subJsonEnable", "subJsonURI"}, {"subClashEnable", "subClashURI"}} {
		enabled, _ := values[f[0]].(bool)
		base, _ := values[f[1]].(string)
		if enabled && base != "" {
			urls = append(urls, base+subID)
		}
	}
	return urls, nil
}

// ListClients returns the reseller's own clients with their traffic.
func ListClients(userID int) ([]ClientView, error) {
	var owned []model.OvixClientOwner
	if err := database.GetDB().Where("user_id = ?", userID).Find(&owned).Error; err != nil {
		return nil, err
	}
	views := []ClientView{}
	if len(owned) == 0 {
		return views, nil
	}
	mine := make(map[int]int64, len(owned))
	for _, o := range owned {
		mine[o.ClientId] = o.ClientCreatedAt
	}
	rows, err := clientService.List()
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if created, ok := mine[rows[i].Id]; ok && created == rows[i].CreatedAt {
			views = append(views, viewOf(&rows[i]))
		}
	}
	return views, nil
}

func viewOf(row *service.ClientWithAttachments) ClientView {
	v := ClientView{
		Email:      row.Email,
		SubID:      row.SubID,
		Enable:     row.Enable,
		ExpiryTime: row.ExpiryTime,
		TotalBytes: row.TotalGB,
		LimitIP:    row.LimitIP,
		Comment:    row.Comment,
		TgID:       row.TgID,
		InboundIds: row.InboundIds,
		CreatedAt:  row.CreatedAt,
	}
	if v.InboundIds == nil {
		v.InboundIds = []int{}
	}
	if row.Traffic != nil {
		v.Up, v.Down = row.Traffic.Up, row.Traffic.Down
	}
	return v
}

func clientView(rec *model.ClientRecord) (*ClientView, error) {
	ids, err := clientService.GetInboundIdsForRecord(rec.Id)
	if err != nil {
		return nil, err
	}
	v := viewOf(&service.ClientWithAttachments{ClientRecord: *rec, InboundIds: ids})
	return &v, nil
}

func reloadView(email string) (*ClientView, error) {
	rec, err := clientService.GetRecordByEmail(nil, email)
	if err != nil {
		return nil, err
	}
	return clientView(rec)
}

// InboundBrief is an inbound a reseller may use, without its secrets.
type InboundBrief struct {
	Id       int    `json:"id" example:"1"`
	Remark   string `json:"remark" example:"VLESS-443"`
	Protocol string `json:"protocol" example:"vless"`
	Port     int    `json:"port" example:"443"`
}

// MeView is the reseller's own account summary.
type MeView struct {
	Username string         `json:"username" example:"shop1"`
	Credit   int64          `json:"credit" example:"120"`
	Inbounds []InboundBrief `json:"inbounds"`
}

// Me returns the caller's balance and the inbounds it may use.
func Me(userID int) (*MeView, error) {
	r, err := GetReseller(userID)
	if err != nil {
		return nil, err
	}
	me := &MeView{Username: r.Username, Credit: r.Credit, Inbounds: []InboundBrief{}}
	if len(r.InboundIds) == 0 {
		return me, nil
	}
	err = database.GetDB().Model(&model.Inbound{}).Select("id, remark, protocol, port").
		Where("id IN ?", r.InboundIds).Order("id").Scan(&me.Inbounds).Error
	return me, err
}
