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
	chunk int
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
	stateMigration map[int]*StateMigration
}

func New() *Game {
	game := &Game{
		players:        make(map[string]*Player),
		state:          newState(),
		mapSizeX:       mapSizeX,
		mapSizeY:       mapSizeY,
		stateMigration: make(map[int]*StateMigration),
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

func (g *Game) MigrateState(chunk int, i int, c Color) {
	g.stateMigration[i] = &StateMigration{
		chunk: chunk,
		index: i,
		color: c,
	}
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
			if len(b) != 4 {
				continue
			}

			switch int(b[0]) {
			case StateMigrationMessage:
				chunk := int(b[1])
				i := int(b[2])
				c := Color(b[3])

				fmt.Printf("Migrate state %d %d", i, c)

				g.MigrateState(chunk, i, c)
			}
		}
	}
}

func gameLoop(g *Game) {
	ticker := time.NewTicker(tickRate)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if len(g.stateMigration) == 0 {
				continue
			}

			// convert g.state.colorMap to []byte slice
			b := make([]byte, len(g.stateMigration)*2+1)

			b[0] = byte(StateMigrationMessage)

			i := 1
			for _, v := range g.stateMigration {
				b[i] = byte(v.chunk)
				b[i+1] = byte(v.index)
				b[i+2] = byte(v.color)
				i = i + 3
			}

			println("Send new state")
			// loop over g.players and send state to each player
			for _, player := range g.players {
				if err := player.ws.WriteMessage(websocket.BinaryMessage, b); err != nil {
					panic(err)
				}
			}

			g.stateMigration = make(map[int]*StateMigration) // reset stateMigration
		}
	}
}
