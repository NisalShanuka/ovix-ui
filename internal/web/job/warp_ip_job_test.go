package job

import (
	"testing"

	"ovix.store/ovix-ui/internal/database"
	"ovix.store/ovix-ui/internal/database/model"
	"ovix.store/ovix-ui/internal/web/service"
)

func TestWarpIpJobInitializesMissingLastUpdate(t *testing.T) {
	setupIntegrationDB(t)

	settings := service.SettingService{}
	if err := settings.SetWarpUpdateInterval(1); err != nil {
		t.Fatalf("enable scheduled WARP rotation: %v", err)
	}

	job := &WarpIpJob{settingService: settings}
	job.Run()

	var stored model.Setting
	if err := database.GetDB().Where("key = ?", "warpLastUpdate").First(&stored).Error; err != nil {
		t.Fatalf("scheduled WARP rotation did not establish its baseline: %v", err)
	}
	if stored.Value == "" || stored.Value == "0" {
		t.Fatalf("warpLastUpdate = %q, want a non-zero baseline", stored.Value)
	}
}
