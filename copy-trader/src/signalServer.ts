/** Broadcasts detected target-wallet trades to any connected browser over a
 * WebSocket, for the non-custodial "mirror with your own wallet" flow
 * (frontend/src/app/copy-trader/mirror). This server never asks who's
 * listening, never collects a public key, and never sizes a trade for
 * anyone — it relays only what's already public on-chain data (direction,
 * dex, mint, and the target's sell fraction). Each connected client computes
 * its own position size from its own live balance and its own configured
 * risk settings, then signs with its own wallet extension. No private key,
 * no API key, and no balance ever reaches this server. */
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import type { BotController } from "./bot.js";
import type { TargetTradeEvent } from "./types.js";

export function startSignalServer(httpServer: HttpServer, bot: BotController): void {
  const wss = new WebSocketServer({ server: httpServer, path: "/signals" });

  bot.on("target-trade", (event: TargetTradeEvent) => {
    const payload = JSON.stringify({
      id: randomUUID(),
      at: Date.now(),
      direction: event.direction,
      dex: event.dex,
      mint: event.mint,
      sellFractionOfHoldings: event.sellFractionOfHoldings,
      sourceSignature: event.signature,
    });

    let sent = 0;
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
        sent += 1;
      }
    }
    if (sent > 0) console.log(`[signals] broadcast ${event.direction} ${event.mint} to ${sent} connected client(s)`);
  });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "connected" }));
  });

  console.log(`[signals] mirror-trade signal server listening on ws://localhost:${config.apiPort}/signals`);
}
