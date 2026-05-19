import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    try {
      const url = request.url || "";
      // Handle websocket requests targeting "/ws/notifications"
      if (url.includes("/ws/notifications")) {
        wss?.handleUpgrade(request, socket, head, (ws) => {
          wss?.emit("connection", ws, request);
        });
      }
    } catch (err) {
      console.error("[WS Upgrade Error]", err);
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    clients.add(ws);
    console.log(`[WS] Notification connection established. Total clients: ${clients.size}`);

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`[WS] Notification connection closed. Total clients: ${clients.size}`);
    });

    ws.on("error", (err) => {
      console.error("[WS] Socket error:", err);
      clients.delete(ws);
    });
  });
}

export function broadcastNotification(payload: any) {
  if (!wss) return;

  const dataString = JSON.stringify(payload);
  for (const client of Array.from(clients)) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(dataString);
      } catch (err) {
        console.error("[WS Broadcast Error]", err);
      }
    }
  }
}
