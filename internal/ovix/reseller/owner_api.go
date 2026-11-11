package reseller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"ovix.store/ovix-ui/internal/web/entity"
	"ovix.store/ovix-ui/internal/web/session"
)

// RegisterOwnerRoutes mounts the owner's reseller management API under the
// /panel/api group. Gate keeps resellers out, so only owner callers get here.
func RegisterOwnerRoutes(api *gin.RouterGroup) {
	g := api.Group("/ovix/resellers")
	g.GET("/list", ownerList)
	g.POST("/add", ownerAdd)
	g.POST("/update/:id", ownerUpdate)
	g.POST("/password/:id", ownerPassword)
	g.POST("/credit/:id", ownerCredit)
	g.GET("/ledger/:id", ownerLedger)
	g.POST("/del/:id", ownerDelete)
	g.GET("/audit", ownerAudit)
}

type resellerForm struct {
	Username   string `json:"username" form:"username"`
	Password   string `json:"password" form:"password"`
	Note       string `json:"note" form:"note"`
	Disabled   bool   `json:"disabled" form:"disabled"`
	InboundIds []int  `json:"inboundIds" form:"inboundIds"`
}

type passwordForm struct {
	Password string `json:"password" form:"password"`
}

type creditForm struct {
	Delta int64 `json:"delta" form:"delta"`
}

func reply(c *gin.Context, obj any, err error) {
	if err != nil {
		c.JSON(http.StatusOK, entity.Msg{Success: false, Msg: err.Error()})
		return
	}
	c.JSON(http.StatusOK, entity.Msg{Success: true, Obj: obj})
}

func actorID(c *gin.Context) int {
	if u := session.GetLoginUser(c); u != nil {
		return u.Id
	}
	return 0
}

func pathID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		reply(c, nil, errors.New("invalid id"))
		return 0, false
	}
	return id, true
}

func bindForm(c *gin.Context, form any) bool {
	if err := c.ShouldBind(form); err != nil {
		reply(c, nil, errors.New("invalid request body"))
		return false
	}
	return true
}

func ownerList(c *gin.Context) {
	views, err := ListResellers()
	if views == nil {
		views = []ResellerView{}
	}
	reply(c, views, err)
}

func ownerAdd(c *gin.Context) {
	var form resellerForm
	if !bindForm(c, &form) {
		return
	}
	view, err := CreateReseller(actorID(c), form.Username, form.Password, form.Note, form.InboundIds)
	if err == nil {
		Audit(actorID(c), "reseller.create", view.Username, gin.H{"userId": view.UserId, "inboundIds": view.InboundIds}, c.ClientIP())
	}
	reply(c, view, err)
}

func ownerUpdate(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	var form resellerForm
	if !bindForm(c, &form) {
		return
	}
	view, err := UpdateReseller(id, form.Note, form.Disabled, form.InboundIds)
	if err == nil {
		Audit(actorID(c), "reseller.update", view.Username, gin.H{"disabled": view.Disabled, "inboundIds": view.InboundIds}, c.ClientIP())
	}
	reply(c, view, err)
}

func ownerPassword(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	var form passwordForm
	if !bindForm(c, &form) {
		return
	}
	err := SetResellerPassword(id, form.Password)
	if err == nil {
		Audit(actorID(c), "reseller.password", strconv.Itoa(id), nil, c.ClientIP())
	}
	reply(c, nil, err)
}

func ownerCredit(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	var form creditForm
	if !bindForm(c, &form) {
		return
	}
	balance, err := AdjustCredit(actorID(c), id, form.Delta)
	if err == nil {
		Audit(actorID(c), "reseller.credit", strconv.Itoa(id), gin.H{"delta": form.Delta, "balance": balance}, c.ClientIP())
	}
	reply(c, gin.H{"credit": balance}, err)
}

func ownerLedger(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	rows, err := Ledger(id, limit)
	reply(c, rows, err)
}

func ownerDelete(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	err := DeleteReseller(id)
	if err == nil {
		Audit(actorID(c), "reseller.delete", strconv.Itoa(id), nil, c.ClientIP())
	}
	reply(c, nil, err)
}

func ownerAudit(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	rows, err := AuditLog(limit)
	reply(c, rows, err)
}
