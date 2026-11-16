package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"netlab/internal/netlab"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func main() {
	listen := flag.String("listen", "0.0.0.0:8080", "HTTP listen address; public exposure requires HTTPS/auth proxy")
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
	// The VPCS PTY may trigger SIGHUP in the daemon's process group on some
	// virtualized hosts. A terminal hangup must never stop the HTTP control API.
	// Keep handling SIGTERM/SIGINT normally for systemd shutdown.
	hup := make(chan os.Signal, 8)
	signal.Notify(hup, syscall.SIGHUP)
	defer signal.Stop(hup)
	go func() {
		for range hup {
			log.Print("NetLab received SIGHUP; ignoring terminal hangup")
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		sig := <-stop
		log.Printf("NetLab received termination signal: %s", sig)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("Shutdown error: %v", err)
		}
	}()
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	log.Printf("NetLab HTTP server stopped")
}
