//go:build js && wasm

package main

// The mission service built for the browser (GOOS=js GOARCH=wasm), for the shared copy of the product
// that is published as plain files with no server behind it. It is the same code as the server: the same
// routes, planner, supply budgets and simulation. Only the way requests arrive differs. The page hands
// over the terrain files once (belMissionInit) and then sends each request as a call (belMissionRequest),
// which is answered by the same handler the server uses.
//
// What it cannot do: the 1 m elevation check, which needs the science service to read NASA's file, and
// saving missions to disk. Missions live in the page and are gone when it is closed.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"syscall/js"

	"beyondearthlabs/mission/internal/mission"
	"beyondearthlabs/mission/internal/terrain"
)

func main() {
	var handler http.Handler

	js.Global().Set("belMissionInit", js.FuncOf(func(_ js.Value, args []js.Value) any {
		meta := []byte(args[0].String())
		bin := make([]byte, args[1].Get("length").Int())
		js.CopyBytesToGo(bin, args[1])
		grid, err := terrain.FromBytes(meta, bin)
		if err != nil {
			return err.Error()
		}
		s := &server{engine: &mission.Engine{Grid: grid}, missions: map[string]*mission.Mission{}}
		handler = s.routes()
		return ""
	}))

	js.Global().Set("belMissionRequest", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if handler == nil {
			return map[string]any{"status": 503, "body": `{"error":"the mission service has not been given its terrain yet"}`}
		}
		req := httptest.NewRequest(args[0].String(), args[1].String(), strings.NewReader(args[2].String()))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return map[string]any{"status": rec.Code, "body": rec.Body.String()}
	}))

	js.Global().Set("belMissionReady", true)
	select {} // stay alive to answer calls
}
