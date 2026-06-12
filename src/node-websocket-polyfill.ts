import WebSocket from "ws";

if (!globalThis.WebSocket) {
  Object.assign(globalThis, { WebSocket });
}
