/** Optional Telegram/Discord webhook alerts for trade execution and skips.
 * Fire-and-forget by design: a notification failure must never affect
 * trading — every call here is wrapped so it only ever logs a warning, and
 * callers never `await` these in a way that blocks the trading path. Both
 * webhooks are optional and independent; either, both, or neither may be
 * configured in .env. */
import { config } from "./config.js";

function send(promise: Promise<Response>, label: string): void {
  promise
    .then((res) => {
      if (!res.ok) console.warn(`[notifier] ${label} webhook returned ${res.status}`);
    })
    .catch((err) => console.warn(`[notifier] ${label} webhook failed: ${(err as Error).message}`));
}

function sendTelegram(text: string): void {
  if (!config.telegramBotToken || !config.telegramChatId) return;
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  send(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.telegramChatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
    }),
    "Telegram"
  );
}

function sendDiscord(text: string): void {
  if (!config.discordWebhookUrl) return;
  send(
    fetch(config.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    }),
    "Discord"
  );
}

function broadcast(text: string): void {
  sendTelegram(text);
  sendDiscord(text);
}

export function notifyTradeExecuted(params: {
  direction: "buy" | "sell";
  mint: string;
  dex: string;
  sourceWallet: string;
  signature?: string;
  solAmount?: number;
  dryRun: boolean;
}): void {
  const { direction, mint, dex, sourceWallet, signature, solAmount, dryRun } = params;
  const emoji = direction === "buy" ? "🟢" : "🔴";
  const tag = dryRun ? " (DRY RUN)" : "";
  const amountStr = solAmount !== undefined ? ` — ${solAmount.toFixed(4)} SOL` : "";
  const sigStr = signature ? `\nhttps://solscan.io/tx/${signature}` : "";
  broadcast(
    `${emoji} *${direction.toUpperCase()}*${tag} on ${dex}${amountStr}\n` +
      `Mint: \`${mint}\`\n` +
      `Mirrored from: \`${sourceWallet.slice(0, 4)}…${sourceWallet.slice(-4)}\`${sigStr}`
  );
}

export function notifyTradeSkipped(params: { mint: string; sourceWallet: string; reason: string }): void {
  const { mint, sourceWallet, reason } = params;
  broadcast(`⏭️ Skipped buy on \`${mint}\` (from \`${sourceWallet.slice(0, 4)}…${sourceWallet.slice(-4)}\`): ${reason}`);
}

export function notifyExit(params: { label: string; mint: string; sourceWallet: string; pnlPct: number }): void {
  const { label, mint, sourceWallet, pnlPct } = params;
  const emoji = pnlPct >= 0 ? "✅" : "🛑";
  broadcast(
    `${emoji} *${label}* triggered on \`${mint}\` (from \`${sourceWallet.slice(0, 4)}…${sourceWallet.slice(-4)}\`) — ` +
      `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% vs cost basis`
  );
}

export function notifyError(message: string): void {
  broadcast(`⚠️ copy-trader error: ${message}`);
}
