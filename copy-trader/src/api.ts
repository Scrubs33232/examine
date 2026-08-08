/** Minimal local HTTP + SSE control API for the bot — no framework
 * dependency needed for four endpoints. Backs the website's Copy Trader
 * page. Not authenticated: this matches the rest of the app (the FastAPI
 * backend and Next.js dashboard are also unauthenticated localhost-only
 * dev servers) — do not expose this port beyond localhost without adding
 * auth first, since /api/start puts real funds at risk.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { config } from "./config.js";
import { settingsStore } from "./settingsStore.js";
import { ledger } from "./ledger.js";
import type { BotController } from "./bot.js";

function withCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** Returns the underlying http.Server (already listening) so signalServer.ts
 * can attach a WebSocket upgrade handler to the same port instead of
 * opening a second one. */
export function startApiServer(bot: BotController): Server {
  const sseClients = new Set<ServerResponse>();

  bot.on("event", (event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of sseClients) res.write(payload);
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    withCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    try {
      if (url.pathname === "/api/status" && req.method === "GET") {
        sendJson(res, 200, await bot.getStatusSnapshot());
        return;
      }

      if (url.pathname === "/api/trades" && req.method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? "50");
        sendJson(res, 200, bot.getRecentEvents(Number.isFinite(limit) ? limit : 50));
        return;
      }

      if (url.pathname === "/api/start" && req.method === "POST") {
        await bot.start();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/api/stop" && req.method === "POST") {
        bot.stop();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/api/target-wallets" && req.method === "POST") {
        const body = (await readJsonBody(req)) as { address?: unknown };
        if (typeof body.address !== "string" || !body.address.trim()) {
          sendJson(res, 400, { error: "body must include { address: string }" });
          return;
        }
        try {
          const wallets = await bot.addTargetWallet(body.address.trim());
          sendJson(res, 200, { wallets });
        } catch (err) {
          sendJson(res, 400, { error: (err as Error).message });
        }
        return;
      }

      if (url.pathname.startsWith("/api/target-wallets/") && req.method === "DELETE") {
        const address = decodeURIComponent(url.pathname.slice("/api/target-wallets/".length));
        const wallets = await bot.removeTargetWallet(address);
        sendJson(res, 200, { wallets });
        return;
      }

      if (url.pathname === "/api/settings" && req.method === "GET") {
        sendJson(res, 200, settingsStore.get());
        return;
      }

      if (url.pathname === "/api/settings" && req.method === "PUT") {
        const body = await readJsonBody(req);
        sendJson(res, 200, settingsStore.update(body as object));
        return;
      }

      if (url.pathname === "/api/ledger/summary" && req.method === "GET") {
        sendJson(res, 200, ledger.getSummary());
        return;
      }

      if (url.pathname === "/api/ledger/fills" && req.method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? "50");
        sendJson(res, 200, ledger.getRecentFills(Number.isFinite(limit) ? limit : 50));
        return;
      }

      if (url.pathname === "/api/ledger/positions" && req.method === "GET") {
        sendJson(res, 200, await bot.getOpenPositionsWithPnl());
        return;
      }

      if (url.pathname === "/api/stream" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("retry: 2000\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  });

  server.listen(config.apiPort, () => {
    console.log(`[api] control API listening on http://localhost:${config.apiPort}`);
  });

  return server;
}
