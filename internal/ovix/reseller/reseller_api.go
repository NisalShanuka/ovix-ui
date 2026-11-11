package reseller

import (
	"net"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"ovix.store/ovix-ui/internal/web/session"
)

// RegisterResellerRoutes mounts the reseller's own API under /panel/api.
// Only reseller sessions may call it; the owner manages clients normally.
func RegisterResellerRoutes(api *gin.RouterGroup) {
	g := api.Group("/reseller")
	g.Use(requireResellerCaller)
	g.GET("/me", resellerMe)
	g.GET("/ledger", resellerLedger)
	g.GET("/clients", resellerClients)
	g.POST("/clients/add", resellerAdd)
	g.POST("/clients/renew/:email", resellerRenew)
	g.POST("/clients/update/:email", resellerUpdate)
	g.POST("/clients/resetTraffic/:email", resellerResetTraffic)
	g.POST("/clients/del/:email", resellerDelete)
	g.GET("/clients/links/:email", resellerLinks)
}

const callerKey = "ovix_reseller_id"

func requireResellerCaller(c *gin.Context) {
	role, _ := c.Get(RoleContextKey)
	user := session.GetLoginUser(c)
	if role != RoleReseller || user == nil {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "msg": "only reseller logins use this API"})
		return
	}
	c.Set(callerKey, user.Id)
	c.Next()
}

func caller(c *gin.Context) int { return c.GetInt(callerKey) }

type renewForm struct {
	Days int `json:"days" form:"days"`
}

func resellerMe(c *gin.Context) {
	me, err := Me(caller(c))
	reply(c, me, err)
}

func resellerLedger(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	rows, err := Ledger(caller(c), limit)
	reply(c, rows, err)
}

func resellerClients(c *gin.Context) {
	views, err := ListClients(caller(c))
	reply(c, views, err)
}

func resellerAdd(c *gin.Context) {
	var in NewClientInput
	if !bindForm(c, &in) {
		return
	}
	view, err := CreateClient(caller(c), in)
	if err == nil {
		Audit(caller(c), "client.create", view.Email, gin.H{"days": in.Days, "inboundIds": view.InboundIds}, c.ClientIP())
	}
	reply(c, view, err)
}

func resellerRenew(c *gin.Context) {
	var form renewForm
	if !bindForm(c, &form) {
		return
	}
	view, err := RenewClient(caller(c), c.Param("email"), form.Days)
	if err == nil {
		Audit(caller(c), "client.renew", view.Email, gin.H{"days": form.Days, "expiryTime": view.ExpiryTime}, c.ClientIP())
	}
	reply(c, view, err)
}

func resellerUpdate(c *gin.Context) {
	var in ClientUpdateInput
	if !bindForm(c, &in) {
		return
	}
	view, err := UpdateClient(caller(c), c.Param("email"), in)
	if err == nil {
		Audit(caller(c), "client.update", view.Email, in, c.ClientIP())
	}
	reply(c, view, err)
}

func resellerResetTraffic(c *gin.Context) {
	email := c.Param("email")
	err := ResetClientTraffic(caller(c), email)
	if err == nil {
		Audit(caller(c), "client.resetTraffic", email, nil, c.ClientIP())
	}
	reply(c, nil, err)
}

func resellerDelete(c *gin.Context) {
	email := c.Param("email")
	err := DeleteClient(caller(c), email)
	if err == nil {
		Audit(caller(c), "client.delete", email, nil, c.ClientIP())
	}
	reply(c, nil, err)
}

func resellerLinks(c *gin.Context) {
	host := c.Request.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	links, err := ClientLinks(caller(c), c.Param("email"), host)
	reply(c, links, err)
}
