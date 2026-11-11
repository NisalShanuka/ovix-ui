package reseller

import (
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"

	"ovix.store/ovix-ui/internal/database"
	"ovix.store/ovix-ui/internal/database/dbtest"
	"ovix.store/ovix-ui/internal/database/model"
	"ovix.store/ovix-ui/internal/web/session"
)

// newGateEngine mirrors web.go: sessions, then the gate on the whole engine,
// with stand-in handlers for an owner API, the reseller API, the SPA and /ws.
func newGateEngine(t *testing.T) *httptest.Server {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dbtest.InitDB(t, filepath.Join(t.TempDir(), "ovix-ui.db"))

	engine := gin.New()
	engine.Use(sessions.Sessions("ovix-ui", cookie.NewStore([]byte("gate-test-secret"))))
	engine.Use(Gate("/"))

	ok := func(c *gin.Context) { c.String(http.StatusOK, "reached") }
	engine.GET("/test-login/:id", func(c *gin.Context) {
		id, _ := strconv.Atoi(c.Param("id"))
		user := &model.User{}
		if err := database.GetDB().First(user, id).Error; err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
		if err := session.SetLoginUser(c, user); err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Status(http.StatusOK)
	})
	engine.GET("/panel/api/clients/list", ok)
	engine.POST("/panel/api/server/restartXrayService", ok)
	engine.GET("/panel/api/reseller/me", ok)
	engine.GET("/panel/api/ovix/session", ok)
	engine.GET("/panel/api/ovix/resellers/list", ok)
	engine.POST("/panel/api/reseller/clients/add", ok)
	engine.GET("/panel/", ok)
	engine.GET("/panel/csrf-token", ok)
	engine.POST("/logout", ok)
	engine.GET("/ws", ok)

	ts := httptest.NewServer(engine)
	t.Cleanup(ts.Close)
	return ts
}

func seedUser(t *testing.T, name string, reseller bool) int {
	t.Helper()
	user := &model.User{Username: name, Password: "x"}
	if err := database.GetDB().Create(user).Error; err != nil {
		t.Fatalf("seed user %s: %v", name, err)
	}
	if reseller {
		if err := database.GetDB().Create(&model.OvixAdmin{UserId: user.Id, Role: model.OvixRoleReseller}).Error; err != nil {
			t.Fatalf("seed reseller %s: %v", name, err)
		}
	}
	return user.Id
}

func loggedInClient(t *testing.T, ts *httptest.Server, userID int) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar: %v", err)
	}
	client := &http.Client{Jar: jar}
	resp, err := client.Get(ts.URL + "/test-login/" + strconv.Itoa(userID))
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", resp.StatusCode)
	}
	return client
}

func statusOf(t *testing.T, client *http.Client, method, url string) int {
	t.Helper()
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func TestGateLimitsResellersToTheResellerSurface(t *testing.T) {
	ts := newGateEngine(t)
	ownerID := seedUser(t, "owner-test", false)
	resellerID := seedUser(t, "reseller-test", true)

	cases := []struct {
		method       string
		path         string
		ownerWant    int
		resellerWant int
	}{
		{http.MethodGet, "/panel/api/clients/list", http.StatusOK, http.StatusForbidden},
		{http.MethodPost, "/panel/api/server/restartXrayService", http.StatusOK, http.StatusForbidden},
		{http.MethodGet, "/ws", http.StatusOK, http.StatusForbidden},
		{http.MethodGet, "/panel/api/reseller/me", http.StatusOK, http.StatusOK},
		{http.MethodGet, "/panel/api/ovix/session", http.StatusOK, http.StatusOK},
		{http.MethodGet, "/panel/api/ovix/resellers/list", http.StatusOK, http.StatusForbidden},
		{http.MethodPost, "/panel/api/reseller/clients/add", http.StatusOK, http.StatusOK},
		{http.MethodGet, "/panel/", http.StatusOK, http.StatusOK},
		{http.MethodGet, "/panel/csrf-token", http.StatusOK, http.StatusOK},
		{http.MethodPost, "/logout", http.StatusOK, http.StatusOK},
	}
	owner := loggedInClient(t, ts, ownerID)
	reseller := loggedInClient(t, ts, resellerID)
	anonymous := &http.Client{}
	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			if got := statusOf(t, owner, tc.method, ts.URL+tc.path); got != tc.ownerWant {
				t.Errorf("owner status = %d, want %d", got, tc.ownerWant)
			}
			if got := statusOf(t, reseller, tc.method, ts.URL+tc.path); got != tc.resellerWant {
				t.Errorf("reseller status = %d, want %d", got, tc.resellerWant)
			}
			// Anonymous callers are left to the routes' own auth checks.
			if got := statusOf(t, anonymous, tc.method, ts.URL+tc.path); got != http.StatusOK {
				t.Errorf("anonymous status = %d, want 200 (gate must not handle them)", got)
			}
		})
	}
}

func TestGateRespectsBasePath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dbtest.InitDB(t, filepath.Join(t.TempDir(), "ovix-ui.db"))
	resellerID := seedUser(t, "reseller-base", true)

	engine := gin.New()
	engine.Use(sessions.Sessions("ovix-ui", cookie.NewStore([]byte("gate-test-secret"))))
	engine.Use(Gate("/secret/"))
	ok := func(c *gin.Context) { c.String(http.StatusOK, "reached") }
	engine.GET("/test-login/:id", func(c *gin.Context) {
		user := &model.User{}
		_ = database.GetDB().First(user, resellerID).Error
		_ = session.SetLoginUser(c, user)
	})
	engine.GET("/secret/panel/api/reseller/me", ok)
	engine.GET("/secret/panel/api/clients/list", ok)
	ts := httptest.NewServer(engine)
	t.Cleanup(ts.Close)

	reseller := loggedInClient(t, ts, resellerID)
	if got := statusOf(t, reseller, http.MethodGet, ts.URL+"/secret/panel/api/reseller/me"); got != http.StatusOK {
		t.Errorf("reseller API under base path = %d, want 200", got)
	}
	if got := statusOf(t, reseller, http.MethodGet, ts.URL+"/secret/panel/api/clients/list"); got != http.StatusForbidden {
		t.Errorf("owner API under base path = %d, want 403", got)
	}
}
