package main

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pkg/errors"
	"math/rand"
	"net/http"
)

type sdp struct {
	Type string `json:"type"`
	SDP  string `json:"sdp"`
}

type iceCandidate struct {
	Candidate     string `json:"candidate"`
	SDPMLineIndex int    `json:"sdpMLineIndex"`
	SDPMid        string `json:"sdpMid"`
}

type message struct {
	ID        uuid.UUID    `json:"id,omitempty"`
	Action    string       `json:"action,omitempty"`
	Date      int          `json:"date,omitempty"`
	Username  string       `json:"username,omitempty"`
	Target    uuid.UUID    `json:"target,omitempty"`
	Candidate iceCandidate `json:"candidate,omitempty"`
	Text      string       `json:"text,omitempty"`
	Type      string       `json:"type,omitempty"`
	SDP       sdp          `json:"sdp,omitempty"`
	Status    string       `json:"status,omitempty"`
}

var connections = make(map[uuid.UUID]*websocket.Conn)
var usernames = make(map[uuid.UUID]string)
var connectedUsers = make(map[uuid.UUID]*websocket.Conn)
var appendToMakeUnique = 1

const letterBytes = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

func randStringBytes(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = letterBytes[rand.Intn(len(letterBytes))]
	}
	return string(b)
}

func wshandler(c *websocket.Conn) {
	var id uuid.UUID
	defer func() {
		if id != uuid.Nil {
			userupdate := struct {
				Type   string    `json:"type"`
				Action string    `json:"action"`
				ID     uuid.UUID `json:"id"`
			}{
				Type:   "userlist-update",
				Action: "delete",
				ID:     id,
			}

			ua, err := json.Marshal(userupdate)
			if err != nil {
				fmt.Println("Marshal ua delete", err)
			}
			for i, conn := range connections {
				if i != id {
					conn.WriteMessage(1, ua)
				}
			}
			delete(connections, id)
			delete(usernames, id)
		}
		c.Close()
	}()

	for {
		_, msg, err := c.ReadMessage()
		if err != nil {
			break
		}

		m := message{}
		err = json.Unmarshal(msg, &m)
		if err != nil {
			fmt.Println("Parse message", err)
			break
		}

		switch m.Type {
		case "id":
			if m.Action == "set" {
				id = m.ID
				connections[m.ID] = c
			}
			if m.Action == "request" {
				id = uuid.New()
				c.WriteMessage(1, []byte(`{"type": "id", "id": "`+id.String()+`" }`))
				connections[id] = c
			}
			// Public, textual message
		case "message":
			fmt.Println("GOT MESSAGE FOR SOME REASON")
			// m.Username = connect.Username
			// msg.Text = msg.text.replace(/(<([^>]+)>)/ig, "");
			break

			// Username change
		case "username":
			err := handleUsername(c, m)
			if err != nil {
				fmt.Println(err)
			}
		case "status":
			if m.Action == "set" {
				fmt.Println(m.ID, "is", m.Status)
			}
		default:
			if m.Target != uuid.Nil {
				msg, err := json.Marshal(m)
				if err != nil {
					fmt.Println("Marshal target", err)
					break
				}
				fmt.Println(m.ID, m.Target)
				connections[m.Target].WriteMessage(1, msg)
			} else {
				for i, conn := range connections {
					if i != m.ID {
						conn.WriteMessage(1, msg)
					}
				}
			}
			break
		}
	}

}
func main() {

	r := gin.Default()

	r.StaticFS("/static", http.Dir("./client/build/static"))
	r.StaticFile("/", "./client/build/index.html")
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "authorization, origin, content-type, accept")
		c.Header("Allow", "HEAD,GET,POST,PUT,PATCH,DELETE,OPTIONS")
		c.Header("Content-Type", "application/json")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusOK)
			return
		}
		c.Next()
	})
	var upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
	}
	r.GET("/ws", func(c *gin.Context) {
		upgrader.CheckOrigin = func(r *http.Request) bool {
			return true
		}
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			fmt.Printf("Failed to set websocket upgrade: %+v\n", err)
			return
		}
		wshandler(conn)
	})

	r.Run(":8080")
}

func handleUsername(c *websocket.Conn, m message) error {
	for _, u := range usernames {
		if u == m.Username {
			// Append nonsense
			m.Username += "-" + randStringBytes(5)
			appendToMakeUnique++
			m := message{
				ID:       m.ID,
				Type:     "username-reject",
				Username: m.Username,
			}
			msg, err := json.Marshal(m)
			if err != nil {
				return errors.Wrap(err, "handleUsername, reject marshal")
			}
			c.WriteMessage(1, msg)
			break
		}
	}

	usernames[m.ID] = m.Username

	userlist := struct {
		Type  string               `json:"type"`
		Users map[uuid.UUID]string `json:"users"`
	}{
		Type:  "userlist-populate",
		Users: usernames,
	}

	ul, err := json.Marshal(userlist)
	if err != nil {
		return errors.Wrap(err, "handleUsername, ul marshal")
	}
	c.WriteMessage(1, ul)

	// update userlist globally
	userupdate := struct {
		Type     string    `json:"type"`
		Action   string    `json:"action"`
		ID       uuid.UUID `json:"id"`
		Username string    `json:"username"`
	}{
		Type:     "userlist-update",
		Action:   "add",
		ID:       m.ID,
		Username: m.Username,
	}

	ua, err := json.Marshal(userupdate)
	if err != nil {
		return errors.Wrap(err, "handleUsername, ua marshal")
	}
	fmt.Println(string(ua))
	for i, conn := range connections {
		if i != m.ID {
			conn.WriteMessage(1, ua)
		}
	}
	return nil
}
