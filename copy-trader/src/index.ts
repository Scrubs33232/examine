import { config } from "./config.js";
import { BotController } from "./bot.js";
import { startApiServer } from "./api.js";
import { startSignalServer } from "./signalServer.js";

async function main(): Promise<void> {
  console.log("========================================================");
  console.log(config.dryRun ? " copy-trader — DRY RUN (no funds at risk)" : " copy-trader — LIVE — executing real trades with real SOL");
  console.log("========================================================");

  const bot = new BotController();
  const snapshot = await bot.getStatusSnapshot();
  console.log(`[startup] bot wallet: ${snapshot.walletPubkey} (${snapshot.walletBalanceSol?.toFixed(4) ?? "?"} SOL)`);
  console.log(`[startup] watching: ${snapshot.targetWallets.map((w) => `${w.slice(0, 4)}…${w.slice(-4)}`).join(", ")}`);
  console.log(
    `[startup] slippage: ${snapshot.slippageBps / 100}% | buy cap: ${snapshot.buySolCap} SOL | jito: ${snapshot.jitoEnabled ? "on" : "off"}`
  );

  const httpServer = startApiServer(bot);
  startSignalServer(httpServer, bot);

  if (config.autoStart) {
    // A failure here (e.g. no target wallets configured yet — the normal
    // state on first setup) must not take the control API down with it.
    // Log it and leave the bot idle; the website's Start button (or adding
    // a wallet, which auto-starts if it was already running) picks up from here.
    try {
      await bot.start();
    } catch (err) {
      console.warn(`[startup] auto-start skipped: ${(err as Error).message}`);
    }
  } else {
    console.log("[startup] AUTO_START=false — waiting for POST /api/start (or the website's Start button)");
  }

  const shutdown = () => {
    console.log("\n[shutdown] stopping...");
    bot.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
