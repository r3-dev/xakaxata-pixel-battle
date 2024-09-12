package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"go-echo-sandbox/ui"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/sessions"
	"github.com/joho/godotenv"
	"github.com/labstack/echo-contrib/session"
	"github.com/nrednav/cuid2"
	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/twitch"
	"golang.org/x/time/rate"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

func GenerateSecureToken(length int) string {
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return hex.EncodeToString(b)
}

type OAuthConfig struct {
	TwitchLoginConfig oauth2.Config
}

var AppOAuthConfig OAuthConfig

func TwitchConfig() oauth2.Config {
	AppOAuthConfig.TwitchLoginConfig = oauth2.Config{
		RedirectURL:  "http://localhost:8080/api/auth/callback",
		ClientID:     os.Getenv("TWITCH_CLIENT_ID"),
		ClientSecret: os.Getenv("TWITCH_CLIENT_SECRET"),
		Scopes:       []string{"user:read:email"},
		Endpoint:     twitch.Endpoint,
	}

	return AppOAuthConfig.TwitchLoginConfig
}

func main() {
	if os.Getenv("TWITCH_CLIENT_ID") == "" {
		err := godotenv.Load(".env")
		if err != nil {
			log.Fatalf("Some error occured. Err: %s", err)
		}
	}

	rdb_auth := redis.NewClient(&redis.Options{
		Addr:     os.Getenv("REDIS_HOST"),
		Username: os.Getenv("REDIS_USERNAME"),
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       0, // use default DB
	})

	rdb_users := redis.NewClient(&redis.Options{
		Addr:     os.Getenv("REDIS_HOST"),
		Username: os.Getenv("REDIS_USERNAME"),
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       1, // use default DB
	})

	err := rdb_auth.Ping(context.TODO()).Err()
	if err != nil {
		log.Fatal("Error connectint redis:", err)
	}

	err = rdb_users.Ping(context.TODO()).Err()
	if err != nil {
		log.Fatal("Error connectint redis: ", err)
	}

	e := echo.New()
	e.Renderer = ui.UiTemplates
	e.Static("/static", "ui/.dist")

	e.Use(middleware.RateLimiter(middleware.NewRateLimiterMemoryStore(rate.Limit(20))))
	e.Use(session.Middleware(sessions.NewCookieStore([]byte("secret"))))

	TwitchConfig()

	e.GET("/", func(c echo.Context) error {
		return c.Render(http.StatusOK, "IndexPage", "HakaHata")
	})

	e.GET("/me", func(c echo.Context) (err error) {
		sess, err := session.Get("session", c)
		if err != nil {
			return err
		}

		if sess.Values["user_id"] == nil {
			return c.Redirect(http.StatusSeeOther, "/")
		}

		user_id := sess.Values["user_id"].(string)

		user_data := TwitchUser{}

		err = rdb_users.Get(c.Request().Context(), user_id).Scan(&user_data)
		if err != nil {
			return c.Redirect(http.StatusSeeOther, "/")
		}

		return c.JSON(http.StatusOK, user_data)
	})

	e.GET("/login", func(c echo.Context) error {
		return c.Redirect(http.StatusSeeOther, "/api/auth/login")
	})

	e.GET("/logout", func(c echo.Context) error {
		return c.Redirect(http.StatusSeeOther, "/api/auth/logout")
	})

	e.GET("/api/auth/login", func(c echo.Context) error {
		state_key := cuid2.Generate()
		state_value := GenerateSecureToken(8)

		// generate session for user
		sess, err := session.Get("session", c)
		if err != nil {
			return err
		}

		sess.Options = &sessions.Options{
			Path:     "/",
			MaxAge:   86400 * 7,
			HttpOnly: true,
		}

		sess.Values["twitch_auth_state"] = state_key
		if err := sess.Save(c.Request(), c.Response()); err != nil {
			return err
		}

		// save state to kv store by session id
		err = rdb_auth.Set(c.Request().Context(), state_key, state_value, 0).Err()
		if err != nil {
			panic(err)
		}

		url := AppOAuthConfig.TwitchLoginConfig.AuthCodeURL(state_value)

		return c.Redirect(http.StatusSeeOther, url)
	})

	e.GET("/api/auth/callback", func(c echo.Context) error {
		state := c.QueryParam("state")

		sess, err := session.Get("session", c)
		if err != nil {
			return err
		}

		id, ok := sess.Values["twitch_auth_state"].(string)
		if !ok {
			return c.String(http.StatusUnauthorized, "Session ID Not Found")
		}

		delete(sess.Values, "twitch_auth_state")

		saved_state, err := rdb_auth.Get(c.Request().Context(), id).Result()
		if err != nil {
			panic(err)
		}

		err = rdb_auth.Del(c.Request().Context(), id).Err()
		if err != nil {
			panic(err)
		}

		if state != saved_state {
			return c.String(http.StatusUnauthorized, "States don't Match!")
		}

		code := c.QueryParam("code")

		twitchcon := TwitchConfig()

		token, err := twitchcon.Exchange(c.Request().Context(), code)
		if err != nil {
			return c.String(http.StatusUnauthorized, "Code-Token Exchange Failed")
		}

		req, err := http.NewRequest("GET", "https://api.twitch.tv/helix/users", nil)
		if err != nil {
			return c.String(http.StatusInternalServerError, "User Data Fetch Failed")
		}

		req.Header.Add("Authorization", "Bearer "+token.AccessToken)
		req.Header.Add("Client-id", twitchcon.ClientID)

		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return c.String(res.StatusCode, "User Data Fetch Failed")
		}

		userDatabody, err := io.ReadAll(res.Body)
		if err != nil {
			return c.String(http.StatusInternalServerError, "JSON Parsing Failed")
		}

		users := TwitchUserDataResponse{}

		err = json.Unmarshal(userDatabody, &users)
		if err != nil {
			return c.String(http.StatusInternalServerError, "JSON Parsing Failed")
		}

		if len(users.Data) == 0 {
			return c.String(http.StatusInternalServerError, "User Data Fetch Failed")
		}

		user := users.Data[0]

		err = rdb_users.Set(c.Request().Context(), user.ID, user, 0).Err()
		if err != nil {
			panic(err)
		}

		sess.Values["user_id"] = user.ID
		if err := sess.Save(c.Request(), c.Response()); err != nil {
			return err
		}

		return c.Redirect(http.StatusSeeOther, "/me")
	})

	e.GET("/api/auth/logout", func(c echo.Context) error {
		sess, err := session.Get("session", c)
		if err != nil {
			return err
		}

		delete(sess.Values, "user_id")

		sess.Options = &sessions.Options{
			Path:     "/",
			MaxAge:   3600,
			SameSite: http.SameSiteStrictMode,
		}

		err = sess.Save(c.Request(), c.Response())
		if err != nil {
			return err
		}

		return c.Redirect(http.StatusSeeOther, "/")
	})

	e.Logger.Fatal(e.Start(":3000"))
}

type TwitchUserDataResponse struct {
	Data []TwitchUser `json:"data"`
}

type TwitchUser struct {
	ID              string    `json:"id"`
	Login           string    `json:"login"`
	DisplayName     string    `json:"display_name"`
	Type            string    `json:"type"`
	BroadcasterType string    `json:"broadcaster_type"`
	Description     string    `json:"description"`
	ProfileImageURL string    `json:"profile_image_url"`
	OfflineImageURL string    `json:"offline_image_url"`
	ViewCount       int64     `json:"view_count"`
	Email           string    `json:"email"`
	CreatedAt       time.Time `json:"created_at"`
}

func (t TwitchUser) MarshalBinary() (data []byte, err error) {
	return json.Marshal(t)
}

func (t *TwitchUser) UnmarshalBinary(data []byte) error {
	return json.Unmarshal(data, t)
}
