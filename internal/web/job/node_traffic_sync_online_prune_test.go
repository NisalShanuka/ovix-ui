package job

import (
	"path/filepath"
	"testing"

	"github.com/op/go-logging"

	"ovix.store/ovix-ui/internal/database"
	"ovix.store/ovix-ui/internal/database/dbtest"
	"ovix.store/ovix-ui/internal/database/model"
	xuilogger "ovix.store/ovix-ui/internal/logger"
	"ovix.store/ovix-ui/internal/web/runtime"
	"ovix.store/ovix-ui/internal/web/service"
	"ovix.store/ovix-ui/internal/xray"
)

// The sync tick is the only place that sees which nodes it no longer fetches, so it
// must drop their online sets itself: a disabled node here, a deleted one below.
func TestNodeTrafficSyncDropsOnlineClientsOfUnsyncedNodes(t *testing.T) {
	xuilogger.InitLogger(logging.ERROR)
	dbtest.InitDB(t, filepath.Join(t.TempDir(), "ovix-ui.db"))
	runtime.SetManager(runtime.NewManager(runtime.LocalDeps{APIPort: func() int { return 0 }, SetNeedRestart: func() {}}))
	t.Cleanup(func() { runtime.SetManager(nil) })
	process := xray.NewTestProcess(nil, "")
	t.Cleanup(service.SetXrayProcessForTest(process))

	disabled := &model.Node{Name: "disabled", Address: "127.0.0.1", Port: 1, ApiToken: "tok", Enable: true, Status: "online"}
	if err := database.GetDB().Create(disabled).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := database.GetDB().Model(disabled).Update("enable", false).Error; err != nil {
		t.Fatalf("disable node: %v", err)
	}
	process.SetNodeOnlineTree(disabled.Id, map[string][]string{"g-disabled": {"a@x"}})
	process.SetNodeOnlineTree(disabled.Id+100, map[string][]string{"g-deleted": {"b@x"}})

	NewNodeTrafficSyncJob().Run()

	if got := process.GetMergedNodeTrees(); len(got) != 0 {
		t.Fatalf("online sets after a sync tick = %v, want none for a disabled or deleted node", got)
	}
}
