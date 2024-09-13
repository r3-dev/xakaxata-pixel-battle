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
	mapSizeX = 20
	mapSizeY = 20
	mapSize  = mapSizeX * mapSizeY
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

const (
	StateMessage int = iota
	StateMigrationMessage
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
	mapSizeX int
	mapSizeY int
	mapSize  int

	// players
	players map[string]*Player

	// game state
	state          *State
	stateMigration []*StateMigration
}

func New() *Game {
	game := &Game{
		players:  make(map[string]*Player),
		state:    newState(),
		mapSizeX: mapSizeX,
		mapSizeY: mapSizeY,
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
		state.colorMap[i] = Color(rand.Intn(10))
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
	defer g.RemovePlayer(player)

	// Send initial state to client
	b := make([]byte, len(g.state.colorMap)+3)

	b[0] = byte(StateMessage)

	b[1] = byte(g.mapSizeX)
	b[2] = byte(g.mapSizeY)

	for i, c := range g.state.colorMap {
		b[i+3] = byte(c)
	}

	if err := ws.WriteMessage(websocket.BinaryMessage, b); err != nil {
		c.Logger().Error(err)
	}

	for {
		// Read
		msgType, msg, err := ws.ReadMessage()
		if err != nil {
			c.Logger().Error(err)
		}

		if msgType == websocket.BinaryMessage {
			b := msg
			if len(b) != 3 {
				continue
			}

			switch int(b[0]) {
			case StateMigrationMessage:
				g.MigrateState(int(b[1]), Color(b[2]))
			}
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
			if g.stateMigration == nil {
				continue
			}

			// convert g.state.colorMap to []byte slice
			b := make([]byte, len(g.stateMigration)*2+1)

			b[0] = byte(StateMigrationMessage)

			for i, c := range g.stateMigration {
				b[i*2+1] = byte(c.index)
				b[i*2+2] = byte(c.color)
			}

			println("Send new state")
			// loop over g.players and send state to each player
			for _, player := range g.players {
				if err := player.ws.WriteMessage(websocket.BinaryMessage, b); err != nil {
					panic(err)
				}
			}

			g.stateMigration = nil
		}
	}
}
