package geo

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"ovix.store/ovix-ui/internal/config"
	"ovix.store/ovix-ui/internal/web/entity"
	"ovix.store/ovix-ui/internal/xray"
)

// OnlineSource returns the clients connected right now with their source IPs.
type OnlineSource func() ([]xray.OnlineUser, bool, error)

var (
	defaultOnce    sync.Once
	defaultUpdater *Updater
)

func updater() *Updater {
	defaultOnce.Do(func() {
		defaultUpdater = &Updater{Dir: config.GetBinFolderPath(), Loc: &Locator{}}
		_ = defaultUpdater.LoadExisting()
	})
	return defaultUpdater
}

// RegisterRoutes mounts the client map API (map data and proxied base map
// tiles), owner-only like every /panel/api route the reseller gate does not list.
func RegisterRoutes(api *gin.RouterGroup, online OnlineSource, serverIP func() string) {
	api.GET("/ovix/geo/tile/:z/:x/:y", NewTileProxy().Serve)
	api.GET("/ovix/geo/map", func(c *gin.Context) {
		u := updater()
		u.RefreshInBackground(time.Now())
		c.JSON(http.StatusOK, entity.Msg{Success: true, Obj: mapFor(u, online, serverIP())})
	})
}

func mapFor(u *Updater, online OnlineSource, serverIP string) MapView {
	users, ok, err := online()
	if err != nil || !ok {
		users = nil
	}
	view := BuildMap(u.Loc, users, serverIP)
	ready, updated := u.Loc.Ready()
	view.Ready, view.Downloading = ready, u.Downloading()
	if ready {
		view.Updated = updated.Unix()
	}
	return view
}
