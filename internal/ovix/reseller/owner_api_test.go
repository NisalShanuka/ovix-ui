package reseller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
)

type apiReply struct {
	Success bool            `json:"success"`
	Msg     string          `json:"msg"`
	Obj     json.RawMessage `json:"obj"`
}

func callOwnerAPI(t *testing.T, engine *gin.Engine, method, path, body string) apiReply {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("%s %s status = %d body=%s", method, path, w.Code, w.Body.String())
	}
	var r apiReply
	if err := json.Unmarshal(w.Body.Bytes(), &r); err != nil {
		t.Fatalf("decode %s: %v", w.Body.String(), err)
	}
	return r
}

func TestOwnerAPICreateTopUpAndList(t *testing.T) {
	initAdminDB(t)
	inboundID := seedInbound(t, 20002)
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("ovix-ui", cookie.NewStore([]byte("owner-api-test"))))
	RegisterOwnerRoutes(engine.Group("/panel/api"))

	add := callOwnerAPI(t, engine, http.MethodPost, "/panel/api/ovix/resellers/add",
		`{"username":"shop1","password":"longenough","note":"Kandy","inboundIds":[`+strconv.Itoa(inboundID)+`]}`)
	if !add.Success {
		t.Fatalf("add failed: %s", add.Msg)
	}
	var created ResellerView
	_ = json.Unmarshal(add.Obj, &created)

	topup := callOwnerAPI(t, engine, http.MethodPost, "/panel/api/ovix/resellers/credit/"+strconv.Itoa(created.UserId), `{"delta":45}`)
	if !topup.Success || string(topup.Obj) != `{"credit":45}` {
		t.Fatalf("top up = %+v obj=%s", topup, topup.Obj)
	}

	list := callOwnerAPI(t, engine, http.MethodGet, "/panel/api/ovix/resellers/list", "")
	var views []ResellerView
	if err := json.Unmarshal(list.Obj, &views); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(views) != 1 || views[0].Username != "shop1" || views[0].Credit != 45 || views[0].Note != "Kandy" ||
		len(views[0].InboundIds) != 1 || views[0].InboundIds[0] != inboundID {
		t.Fatalf("list = %+v", views)
	}

	audit := callOwnerAPI(t, engine, http.MethodGet, "/panel/api/ovix/resellers/audit", "")
	if !strings.Contains(string(audit.Obj), `"action":"reseller.create"`) || !strings.Contains(string(audit.Obj), `"action":"reseller.credit"`) {
		t.Fatalf("audit log misses create/credit: %s", audit.Obj)
	}

	short := callOwnerAPI(t, engine, http.MethodPost, "/panel/api/ovix/resellers/password/"+strconv.Itoa(created.UserId), `{"password":"short"}`)
	if short.Success || short.Msg != ErrPasswordTooShort.Error() {
		t.Fatalf("short password reply = %+v", short)
	}
}
