package db

import (
	"context"
	"log"
	"os"

	"github.com/redis/go-redis/v9"
)

const (
	authDbId = iota
	usersDbId
	playerCooldownsDbId
	gameStateDbId
)

type Rdb struct {
	Auth            *redis.Client
	Users           *redis.Client
	PlayerCooldowns *redis.Client
	GameState       *redis.Client
}

func NewRdb() *Rdb {
	var rdb = &Rdb{
		Auth:            defaultClient(authDbId),
		Users:           defaultClient(usersDbId),
		PlayerCooldowns: defaultClient(playerCooldownsDbId),
		GameState:       defaultClient(gameStateDbId),
	}

	return rdb
}

func defaultClient(id int) *redis.Client {
	var (
		defaultAddr = os.Getenv("REDIS_HOST")
		defaultUser = os.Getenv("REDIS_USERNAME")
		defaultPass = os.Getenv("REDIS_PASSWORD")
	)

	conn := redis.NewClient(&redis.Options{
		Addr:     defaultAddr,
		Username: defaultUser,
		Password: defaultPass,
		DB:       id,
	})

	err := conn.Ping(context.Background()).Err()
	if err != nil {
		log.Fatal("Error connecting redis: ", err)
	}

	return conn
}
