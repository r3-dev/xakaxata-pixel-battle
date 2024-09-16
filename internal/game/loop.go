package game

import (
	"context"
	"time"

	"github.com/gorilla/websocket"
)

func loop(g *Game) {
	ticker := time.NewTicker(tickRate)
	defer ticker.Stop()

	tickerLazy := time.NewTicker(tickRateLazy)
	defer tickerLazy.Stop()

	for {
		select {
		case <-ticker.C:
			go g.mainLoop()
		case <-tickerLazy.C:
			go g.lazyLoop()
		}
	}
}

func (g *Game) mainLoop() {
	if len(g.state.migrations) == 0 {
		return
	}

	b := make([]byte, len(g.state.migrations)*3+1)

	b[0] = byte(StateMigrationMessage)

	i := 1
	for _, v := range g.state.migrations {
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

	g.state.migrations = make(map[int]*StateMigration) // reset migrations

	// current state as binary array
	var binSatate []byte
	for _, c := range g.state.current {
		binSatate = append(binSatate, byte(c))
	}

	// save current state to rdb
	err := g.db.Set(context.TODO(), "game_state", binSatate, 0).Err()
	if err != nil {
		panic(err)
	}
}

func (g *Game) lazyLoop() {
	for _, player := range g.players {
		player.SendPlayerCounter(len(g.players))
	}
}
