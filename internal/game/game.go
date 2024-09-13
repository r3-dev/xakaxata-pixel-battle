package game

import (
	"fmt"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

var (
	tickRate = 100
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
	return &Game{
		players: make(map[string]*Player),
		state:   newState(),
		mapSize: mapSize,
	}
}

func newState() *State {
	state := &State{
		colorMap: make([]Color, mapSize),
	}

	for i := 0; i < mapSize; i++ {
		state.colorMap[i] = White
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

	// get game from context
	for {
		// Write
		err := ws.WriteMessage(websocket.TextMessage, []byte("Hello, Client!"))
		if err != nil {
			c.Logger().Error(err)
		}

		// Read
		_, msg, err := ws.ReadMessage()
		if err != nil {
			c.Logger().Error(err)
		}
		fmt.Printf("%s\n", msg)
	}
}
