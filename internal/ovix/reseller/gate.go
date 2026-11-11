// Package reseller implements Ovix UI reseller accounts: roles, the access
// gate, prepaid credit and the reseller API (OVIX_PANEL_PLAN.md section 3a).
package reseller

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"ovix.store/ovix-ui/internal/logger"
	"ovix.store/ovix-ui/internal/web/session"
)

// RoleContextKey holds the caller's Role on the gin context once Gate has run.
const RoleContextKey = "ovix_role"

const resellerAPIPrefix = "panel/api/reseller/"

// Gate lets a logged-in reseller reach only the reseller API, the SPA shell
// and session plumbing. Default deny: upstream routes added later stay owner-only.
func Gate(basePath string) gin.HandlerFunc {
	return func(c *gin.Context) {
		rel, underBase := strings.CutPrefix(c.Request.URL.Path, basePath)
		if !underBase || strings.HasPrefix(rel, "assets/") {
			c.Next()
			return
		}
		user := session.GetLoginUser(c)
		if user == nil {
			c.Next()
			return
		}
		role, err := RoleOf(user.Id)
		if err != nil {
			logger.Warning("ovix gate: role lookup failed:", err)
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"success": false, "msg": "role lookup failed"})
			return
		}
		c.Set(RoleContextKey, role)
		if role == RoleOwner || resellerMayReach(c.Request.Method, rel) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"success": false,
			"msg":     "resellers cannot access this endpoint",
		})
	}
}

// resellerMayReach is the reseller allowlist, rel being the path below the
// base path. /panel/api and /ws are owner-only apart from the reseller API.
func resellerMayReach(method, rel string) bool {
	if strings.HasPrefix(rel, resellerAPIPrefix) {
		return true
	}
	switch {
	case method == http.MethodPost && (rel == "logout" || rel == "login" || rel == "getTwoFactorEnable"):
		return true
	case method != http.MethodGet:
		return false
	case rel == "panel/api" || strings.HasPrefix(rel, "panel/api/"):
		return false
	case rel == "" || rel == "csrf-token" || rel == "panel" || strings.HasPrefix(rel, "panel/"):
		return true
	case rel == "manifest.webmanifest" || rel == "pwa-register.js" || rel == "service-worker.js" || strings.HasPrefix(rel, "icons/"):
		return true
	}
	return false
}
