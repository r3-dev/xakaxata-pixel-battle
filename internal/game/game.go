package game

import (
	"fmt"
	"math/rand"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
)

var (
	tickRate = 1000 * time.Millisecond
	mapSize  = 400
	coolDown = 5 * time.Second
)

type Color int

const (
	White Color = iota
	Green
	Yellow
	Red
	Orange
	Purple
	Blue
	LightBlue
	Pink
	Black
)

// game state with colormap index
type State struct {
	colorMap []Color
}

// state migration
type StateMigration struct {
	index int
	color Color
}

// player
type Player struct {
	ID string
	ws *websocket.Conn
}

// game state
type Game struct {
	mapSize int

	// players
	players map[string]*Player

	// game state
	state          *State
	stateMigration []*StateMigration
}

func New() *Game {
	game := &Game{
		players: make(map[string]*Player),
		state:   newState(),
		mapSize: mapSize,
	}

	go gameLoop(game)

	return game
}

func newState() *State {
	state := &State{
		colorMap: make([]Color, mapSize),
	}

	// set callorsMap to random color
	for i := 0; i < mapSize; i++ {
		state.colorMap[i] = Color(rand.Intn(9))
	}

	return state
}

func (g *Game) GetState() *State {
	return g.state
}

func (g *Game) AddPlayer(player *Player) {
	g.players[player.ID] = player
}

func (g *Game) RemovePlayer(player *Player) {
	delete(g.players, player.ID)
}

func (g *Game) MigrateState(i int, c Color) {
	g.stateMigration = append(g.stateMigration, &StateMigration{
		index: i,
		color: c,
	})
}

var (
	upgrader = websocket.Upgrader{}
)

func (g *Game) WsHandler(c echo.Context) error {
	ws, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return err
	}
	defer ws.Close()

	// Send initial state to client
	b := make([]byte, len(g.state.colorMap))
	for i, c := range g.state.colorMap {
		b[i] = byte(c)
	}
	if err := ws.WriteMessage(websocket.BinaryMessage, b); err != nil {
		c.Logger().Error(err)
	}

	// add player to game
	sess, err := session.Get("session", c)
	if err != nil {
		panic(err)
	}

	if sess.Values["user_id"] == nil {
		return c.Redirect(http.StatusSeeOther, "/")
	}

	user_id := sess.Values["user_id"].(string)

	player := &Player{
		ID: user_id,
		ws: ws,
	}

	g.AddPlayer(player)

	for {
		// Read
		_, msg, err := ws.ReadMessage()
		if err != nil {
			c.Logger().Error(err)
		}

		fmt.Printf("%s\n", msg)
	}

}

func gameLoop(g *Game) {
	ticker := time.NewTicker(tickRate)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			// convert g.state.colorMap to []byte slice
			// b := make([]byte, len(g.stateMigration))

			// for i, c := range g.state.colorMap {
			// 	b[i] = byte(c)
			// }

			// // loop over g.players and send state to each player

			// for _, player := range g.players {
			// 	if err := player.ws.WriteMessage(1, b); err != nil {
			// 		panic(err)
			// 	}
			// }
		}
	}
}
