import { WebSocketServer, WebSocket } from "ws";
import { Server, IncomingMessage } from "http";
import { verifyToken } from "./auth";

let wss: WebSocketServer | null = null;

// Map businessId -> set of authenticated WebSocket connections
const businessClients = new Map<string, Set<WebSocket>>();

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  for (const cookie of cookieHeader.split(";")) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key) list[key.trim()] = rest.join("=");
  }
  return list;
}

function getBusinessIdFromRequest(request: IncomingMessage): string | null {
  const cookies = parseCookieHeader(request.headers.cookie);
  const token = cookies["jwt_token"];
  if (!token) return null;
  const claims = verifyToken(token);
  return claims?.organisationId ?? null;
}

function removeSocket(businessId: string, ws: WebSocket): void {
  const bucket = businessClients.get(businessId);
  if (!bucket) return;
  bucket.delete(ws);
  if (bucket.size === 0) businessClients.delete(businessId);
}

export function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    try {
      const url = request.url || "";
      if (!url.includes("/ws/notifications")) return;

      const businessId = getBusinessIdFromRequest(request);
      if (!businessId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss?.handleUpgrade(request, socket, head, (ws) => {
        (ws as any).__businessId = businessId;
        wss?.emit("connection", ws, request);
      });
    } catch (err) {
      console.error("[WS Upgrade Error]", err);
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    const businessId: string = (ws as any).__businessId;

    if (!businessClients.has(businessId)) {
      businessClients.set(businessId, new Set());
    }
    businessClients.get(businessId)!.add(ws);

    console.log(`[WS] Connection for business ${businessId}. Clients in bucket: ${businessClients.get(businessId)?.size}`);

    ws.on("close", () => {
      removeSocket(businessId, ws);
      console.log(`[WS] Connection closed for business ${businessId}`);
    });

    ws.on("error", (err) => {
      console.error("[WS] Socket error:", err);
      removeSocket(businessId, ws);
    });
  });
}

export function broadcastNotification(businessId: string, payload: any): void {
  if (!wss) return;

  const bucket = businessClients.get(businessId);
  if (!bucket || bucket.size === 0) return;

  const dataString = JSON.stringify(payload);
  for (const client of Array.from(bucket)) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(dataString);
      } catch (err) {
        console.error("[WS Broadcast Error]", err);
      }
    }
  }
}
