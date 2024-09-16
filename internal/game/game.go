package game

import (
	"context"
	"fmt"
	"go-echo-sandbox/internal/db"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

var (
	mapSizeX = 1
	mapSizeY = 1
	mapSize  = mapSizeX * mapSizeY * 256 * 256
	coolDown = 1 * time.Second
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
	current    []Color
	migrations map[int]*StateMigration
}

// state migration
type StateMigration struct {
	x     int
	y     int
	chunk int
	color Color
}

// game state
type Game struct {
	mapSizeX int
	mapSizeY int
	mapSize  int

	players map[string]*Player

	state *State

	db *redis.Client
}

func New(rdb *db.Rdb) *Game {
	game := &Game{
		players:  make(map[string]*Player),
		state:    initState(rdb),
		mapSizeX: mapSizeX,
		mapSizeY: mapSizeY,
		db:       rdb.PlayerCooldowns,
	}

	go loop(game)

	return game
}

func initState(rdb *db.Rdb) *State {
	state := &State{
		current:    make([]Color, mapSize),
		migrations: make(map[int]*StateMigration),
	}

	binaryState := make([]byte, mapSize)

	err := rdb.PlayerCooldowns.Get(context.TODO(), "game_state").Scan(&binaryState)
	if err != nil {
		fmt.Printf("failed to get game state: %v\n", err)
	}

	// set callorsMap to random color
	for i := 0; i < mapSize; i++ {
		state.current[i] = Color(binaryState[i])
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
	compIndex := chunk*256 + i

	g.state.migrations[compIndex] = &StateMigration{
		y:     chunk,
		x:     i,
		color: c,
	}

	g.state.current[compIndex] = c
}

func (g *Game) SendState(p *Player) {
	// Send initial state to client
	b := make([]byte, len(g.state.current)+3)

	b[0] = byte(StateMessage)

	b[1] = byte(g.mapSizeX)
	b[2] = byte(g.mapSizeY)

	for i, c := range g.state.current {
		b[i+3] = byte(c)
	}
	p.SendMessage(Message{Type: websocket.BinaryMessage, Data: b})
}

func (g *Game) SetPlayerCooldownAt(id string, value time.Time) {
	err := g.db.Set(context.TODO(), id, value, 0).Err()
	if err != nil {
		panic(err)
	}
}

func (g *Game) GetPlayerCooldownById(id string) time.Time {
	val, err := g.db.Get(context.TODO(), id).Result()
	if err != nil {
		return time.Now()
	}

	t, err := time.Parse(time.RFC3339, val)
	if err != nil {
		return time.Now()
	}

	return t
}
