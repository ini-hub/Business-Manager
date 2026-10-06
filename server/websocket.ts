import { WebSocketServer, WebSocket } from "ws";
import { Server, IncomingMessage } from "http";
import { verifyToken } from "./auth";
import { parseCookies } from "./lib/cookies";
import { isSessionActive, onSessionRevoked } from "./lib/authSessions";

let wss: WebSocketServer | null = null;

interface AuthenticatedWebSocket extends WebSocket {
  __businessId: string;
  __sid?: string;
  isAlive?: boolean;
}

// Map businessId -> set of authenticated WebSocket connections
const businessClients = new Map<string, Set<AuthenticatedWebSocket>>();


async function getAuthFromRequest(request: IncomingMessage): Promise<{ businessId: string; sid?: string } | null> {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies["jwt_token"];
  if (!token) return null;
  const claims = verifyToken(token);
  if (!claims?.organisationId) return null;
  if (claims.sid && !(await isSessionActive(claims.sid))) return null;
  return { businessId: claims.organisationId, sid: claims.sid };
}

function removeSocket(businessId: string, ws: AuthenticatedWebSocket): void {
  const bucket = businessClients.get(businessId);
  if (!bucket) return;
  bucket.delete(ws);
  if (bucket.size === 0) businessClients.delete(businessId);
}

export function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  // Close open sockets the moment their session is revoked (logout, password reset).
  onSessionRevoked((sid) => {
    for (const bucket of Array.from(businessClients.values())) {
      for (const client of Array.from(bucket)) {
        if (client.__sid === sid) client.close(4401, "session_revoked");
      }
    }
  });

  const heartbeat = setInterval(() => {
    wss?.clients.forEach((client) => {
      const ws = client as AuthenticatedWebSocket;
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));

  server.on("upgrade", async (request, socket, head) => {
    try {
      const url = request.url || "";
      if (!url.includes("/ws/notifications")) return;

      const auth = await getAuthFromRequest(request);
      if (!auth) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss?.handleUpgrade(request, socket, head, (ws) => {
        (ws as AuthenticatedWebSocket).__businessId = auth.businessId;
        (ws as AuthenticatedWebSocket).__sid = auth.sid;
        wss?.emit("connection", ws, request);
      });
    } catch (err) {
      console.error("[WS Upgrade Error]", err);
      socket.destroy();
    }
  });

  wss.on("connection", (ws: AuthenticatedWebSocket) => {
    const businessId = ws.__businessId;

    if (!businessClients.has(businessId)) {
      businessClients.set(businessId, new Set());
    }
    businessClients.get(businessId)!.add(ws);

    // Heartbeat: a socket that misses a pong (dead phone, dropped proxy) is terminated
    // so it can't linger in businessClients until the OS gives up on the TCP connection.
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("close", () => {
      removeSocket(businessId, ws);
    });

    ws.on("error", (err) => {
      console.error("[WS] Socket error:", err);
      removeSocket(businessId, ws);
    });
  });
}

export function getConnectedClientCount(): number {
  let n = 0;
  for (const bucket of Array.from(businessClients.values())) n += bucket.size;
  return n;
}

function broadcast(businessId: string, payload: object): void {
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

export function broadcastNotification(businessId: string, payload: any): void {
  broadcast(businessId, { __msgType: "notification", ...payload });
}

export function broadcastDataChange(
  businessId: string,
  resource: string,
  storeId?: string,
  action?: string,
): void {
  broadcast(businessId, { __msgType: "data_change", resource, storeId, action });
}
