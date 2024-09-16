package game

import (
	"encoding/binary"
	"time"

	"github.com/gorilla/websocket"
)

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

func (p *Player) ListenInput(g *Game) error {
	for {
		// Read
		msgType, msg, err := p.ws.ReadMessage()
		if err != nil {
			return nil
		}

		if msgType == websocket.BinaryMessage {
			b := msg
			if len(b) != 4 {
				continue
			}

			switch int(b[0]) {
			case StateMigrationMessage:
				if p.cooldownAt.After(time.Now()) {
					continue
				}

				chunk := int(b[1])
				i := int(b[2])
				c := Color(b[3])

				g.MigrateState(chunk, i, c)

				p.cooldownAt = time.Now().Add(coolDown)

				p.SendPlayerState()
			}
		}
	}
}
