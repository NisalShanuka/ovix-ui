package reseller

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"

	"ovix.store/ovix-ui/internal/database"
	"ovix.store/ovix-ui/internal/database/model"
	"ovix.store/ovix-ui/internal/web/session"
)

func postJSON(t *testing.T, client *http.Client, url, body string) (int, apiReply) {
	t.Helper()
	resp, err := client.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var r apiReply
	_ = json.Unmarshal(raw, &r)
	return resp.StatusCode, r
}

func TestResellerAPIThroughTheGate(t *testing.T) {
	f := setupClients(t)
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("ovix-ui", cookie.NewStore([]byte("reseller-api-test"))))
	engine.Use(Gate("/"))
	engine.GET("/test-login/:id", func(c *gin.Context) {
		id, _ := strconv.Atoi(c.Param("id"))
		user := &model.User{}
		_ = database.GetDB().First(user, id).Error
		_ = session.SetLoginUser(c, user)
	})
	RegisterResellerRoutes(engine.Group("/panel/api"))
	ts := httptest.NewServer(engine)
	t.Cleanup(ts.Close)

	shop := loggedInClient(t, ts, f.shop)
	status, add := postJSON(t, shop, ts.URL+"/panel/api/reseller/clients/add",
		`{"email":"nimal","days":30,"inboundIds":[`+strconv.Itoa(f.inbound)+`],"trafficLimitGB":100}`)
	if status != http.StatusOK || !add.Success {
		t.Fatalf("add: status=%d reply=%+v", status, add)
	}
	if got := creditOf(t, f.shop); got != 10 {
		t.Fatalf("credit = %d, want 10", got)
	}
	_, renew := postJSON(t, shop, ts.URL+"/panel/api/reseller/clients/renew/nimal", `{"days":20}`)
	if renew.Success || renew.Msg != ErrInsufficientCredit.Error() {
		t.Fatalf("renew beyond balance = %+v, want %q", renew, ErrInsufficientCredit)
	}

	var owner model.User
	if err := database.GetDB().Order("id").First(&owner).Error; err != nil {
		t.Fatalf("owner: %v", err)
	}
	ownerClient := loggedInClient(t, ts, owner.Id)
	if status, _ := postJSON(t, ownerClient, ts.URL+"/panel/api/reseller/clients/add", `{}`); status != http.StatusForbidden {
		t.Fatalf("owner calling the reseller API: status = %d, want 403", status)
	}
}
