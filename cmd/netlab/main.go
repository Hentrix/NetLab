package main

import (
	"flag"
	"log"
	"net/http"
	"netlab/internal/netlab"
	"os"
	"strings"
	"time"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:8080", "HTTP listen address; public exposure requires HTTPS/auth proxy")
	data := flag.String("data", "./data", "state/images/runtime directory")
	web := flag.String("web", "./web", "static web directory")
	flag.Parse()
	token := strings.TrimSpace(os.Getenv("NETLAB_ADMIN_TOKEN"))
	if token == "" {
		log.Fatal("NETLAB_ADMIN_TOKEN is required. Never expose an unauthenticated API")
	}
	s, err := netlab.NewServer(*data, *web, token)
	if err != nil {
		log.Fatal(err)
	}
	srv := &http.Server{Addr: *listen, Handler: s.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 16}
	log.Printf("NetLab MVP listening on http://%s", *listen)
	log.Fatal(srv.ListenAndServe())
}
