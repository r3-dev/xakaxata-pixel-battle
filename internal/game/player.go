package game

import (
	"encoding/binary"
	"math"
	"time"

	"github.com/gorilla/websocket"
)

type Message struct {
	Type int
	Data []byte
}

type Player struct {
	ID         string
	ws         *websocket.Conn
	cooldownAt time.Time
	messages   chan Message
}

func (p *Player) SendPlayerState() {
	secondsLeft := math.Ceil((p.cooldownAt.Sub(time.Now()).Seconds()))

	if secondsLeft < 0 {
		secondsLeft = 0
	}

	p.messages <- Message{Type: websocket.BinaryMessage, Data: []byte{byte(PlayerStateMessage), byte(int(secondsLeft))}}
}

func (p *Player) SendPlayerCounter(counter int) {
	bs := make([]byte, 5)
	bs[0] = byte(PlayerCounterMessage)

	binary.LittleEndian.PutUint32(bs[1:], uint32(counter))

	p.messages <- Message{Type: websocket.BinaryMessage, Data: bs}
}

func (p *Player) SendMessage(msg Message) {
	p.messages <- msg
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
					p.SendPlayerState()
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

func (p *Player) SendMessagesLoop(g *Game) {
	for {
		select {
		case msg := <-p.messages:
			err := p.ws.WriteMessage(msg.Type, msg.Data)
			if err != nil {
				return
			}
		}
	}
}
