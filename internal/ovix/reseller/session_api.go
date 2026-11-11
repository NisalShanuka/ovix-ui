package reseller

import (
	"github.com/gin-gonic/gin"

	"ovix.store/ovix-ui/internal/web/session"
)

// sessionPath is the one /panel/api route both roles may call; the SPA reads
// it at startup to pick the owner panel or the reseller portal.
const sessionPath = "panel/api/ovix/session"

// SessionView tells the SPA who is logged in.
type SessionView struct {
	Role     string `json:"role" example:"reseller"`
	Username string `json:"username" example:"shop1"`
}

// RegisterSessionRoute mounts GET /panel/api/ovix/session.
func RegisterSessionRoute(api *gin.RouterGroup) {
	api.GET("/ovix/session", func(c *gin.Context) {
		user := session.GetLoginUser(c)
		if user == nil {
			reply(c, nil, ErrNotReseller)
			return
		}
		role, err := RoleOf(user.Id)
		reply(c, SessionView{Role: string(role), Username: user.Username}, err)
	})
}
