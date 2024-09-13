package game

import (
	"context"
	"encoding/binary"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

var (
	tickRate     = 100 * time.Millisecond
	tickRateLazy = 5000 * time.Millisecond
	mapSizeX     = 1
	mapSizeY     = 1
	mapSize      = mapSizeX * mapSizeY * 256 * 256
	coolDown     = 5 * time.Second
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
	PlayerStateMessage
	PlayerCounterMessage
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
	ID         string
	ws         *websocket.Conn
	cooldownAt time.Time
}

func (p *Player) SendPlayerState() {

	secondsLeft := int(p.cooldownAt.Sub(time.Now()).Seconds())

	if secondsLeft < 0 {
		secondsLeft = 0
	}

	p.ws.WriteMessage(websocket.BinaryMessage, []byte{byte(PlayerStateMessage), byte(secondsLeft)})
}

func (p *Player) SendPlayerCounter(counter int) {
	bs := make([]byte, 5)
	bs[0] = byte(PlayerCounterMessage)

	binary.LittleEndian.PutUint32(bs[1:], uint32(counter))

	p.ws.WriteMessage(websocket.BinaryMessage, bs)
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
	cooldownDB     *redis.Client
}

func New() *Game {
	var rdb_player_cooldowns = redis.NewClient(&redis.Options{
		Addr:     os.Getenv("REDIS_HOST"),
		Username: os.Getenv("REDIS_USERNAME"),
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       2, // use default DB
	})

	game := &Game{
		players:        make(map[string]*Player),
		state:          newState(),
		mapSizeX:       mapSizeX,
		mapSizeY:       mapSizeY,
		stateMigration: make(map[int]*StateMigration),
		cooldownDB:     rdb_player_cooldowns,
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
		// state.colorMap[i] = Color(rand.Intn(10))
		state.colorMap[i] = Color(0)
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
	g.SetPlayerCooldownAt(player.ID, player.cooldownAt)
	delete(g.players, player.ID)
}

func (g *Game) MigrateState(chunk int, i int, c Color) {
	g.stateMigration[i] = &StateMigration{
		chunk: chunk,
		index: i,
		color: c,
	}

	compIndex := chunk*256 + i

	g.state.colorMap[compIndex] = c
}

func (g *Game) SetPlayerCooldownAt(id string, value time.Time) {
	err := g.cooldownDB.Set(context.TODO(), id, value, 0).Err()
	if err != nil {
		panic(err)
	}
}

func (g *Game) GetPlayerCooldownById(id string) time.Time {
	val, err := g.cooldownDB.Get(context.TODO(), id).Result()
	if err != nil {
		return time.Now()
	}

	t, err := time.Parse(time.RFC3339, val)
	if err != nil {
		panic(err)
	}

	return t
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
		ID:         user_id,
		ws:         ws,
		cooldownAt: g.GetPlayerCooldownById(user_id),
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

	player.SendPlayerState()
	player.SendPlayerCounter(len(g.players))

	for {
		// Read
		msgType, msg, err := ws.ReadMessage()
		if err != nil {
			c.Logger().Error(err)
			return err
		}

		if msgType == websocket.BinaryMessage {
			b := msg
			if len(b) != 4 {
				continue
			}

			switch int(b[0]) {
			case StateMigrationMessage:
				if player.cooldownAt.After(time.Now()) {
					continue
				}

				chunk := int(b[1])
				i := int(b[2])
				c := Color(b[3])

				g.MigrateState(chunk, i, c)

				player.cooldownAt = time.Now().Add(coolDown)

				player.SendPlayerState()
			}
		}
	}
}

func gameLoop(g *Game) {
	ticker := time.NewTicker(tickRate)
	defer ticker.Stop()

	tickerLazy := time.NewTicker(tickRateLazy)

	for {
		select {
		case <-ticker.C:
			if len(g.stateMigration) == 0 {
				continue
			}

			// convert g.state.colorMap to []byte slice
			b := make([]byte, len(g.stateMigration)*3+1)

			b[0] = byte(StateMigrationMessage)

			i := 1
			for _, v := range g.stateMigration {
				b[i] = byte(v.chunk)
				b[i+1] = byte(v.index)
				b[i+2] = byte(v.color)
				i = i + 3
			}

			// loop over g.players and send state to each player
			for _, player := range g.players {
				if err := player.ws.WriteMessage(websocket.BinaryMessage, b); err != nil {
					panic(err)
				}
			}

			g.stateMigration = make(map[int]*StateMigration) // reset stateMigration
		case <-tickerLazy.C:
			for _, player := range g.players {
				player.SendPlayerCounter(len(g.players))
			}
		}
	}
}
