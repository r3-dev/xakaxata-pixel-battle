package game

import (
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
)

var (
	upgrader = websocket.Upgrader{}
)

func (g *Game) WsHandler(c echo.Context) error {
	ws, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return err
	}
	defer ws.Close()

	// authorize
	sess, err := session.Get("session", c)
	if err != nil {
		return (err)
	}

	if sess.Values["user_id"] == nil {
		return c.Redirect(http.StatusSeeOther, "/")
	}

	user_id := sess.Values["user_id"].(string)

	player := &Player{
		ID:         user_id,
		ws:         ws,
		cooldownAt: g.GetPlayerCooldownById(user_id),
		messages:   make(chan Message),
	}

	go player.SendMessagesLoop(g)

	g.AddPlayer(player)
	defer g.RemovePlayer(player)

	g.SendState(player)

	player.SendPlayerState()
	player.SendPlayerCounter(len(g.players))

	return player.ListenInput(g)
}
