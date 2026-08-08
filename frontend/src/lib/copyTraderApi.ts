// Client for the copy-trader bot's local control API (copy-trader/src/api.ts).
// That server is unauthenticated by design (matches the rest of this app's
// local-dev-only posture) — it should never be pointed at anything but
// localhost without adding auth first, since /api/start risks real funds.

const API_URL = process.env.NEXT_PUBLIC_COPYTRADER_API_URL ?? "http://localhost:8787";
const WS_URL = API_URL.replace(/^http/, "ws");

export type BotStatus = "stopped" | "running" | "error";
export type BotEventKind = "trade-detected" | "sizing" | "execution" | "info" | "error";

export interface BotEvent {
  id: string;
  at: number;
  kind: BotEventKind;
  message: string;
  data?: Record<string, unknown>;
}

export interface BotStatusSnapshot {
  status: BotStatus;
  dryRun: boolean;
  walletPubkey: string;
  walletBalanceSol: number | null;
  targetWallets: string[];
  slippageBps: number;
  buySolCap: number;
  buyPortfolioPercent: number;
  jitoEnabled: boolean;
  startedAt: number | null;
  lastError: string | null;
}

export interface CopyTraderSettings {
  dryRun: boolean;
  buySolCap: number;
  buyPortfolioPercent: number;
  feeBufferSol: number;
  slippageBps: number;
  minLiquiditySol: number;
  maxPriceImpactPct: number;
  maxSafeWalletSol: number;
  jitoBlockEngineUrl: string;
  jitoTipSol: number;
  priorityFeePercentile: number;
  walletPriorityEnabled: boolean;
  walletPriorityMinTrades: number;
  walletPriorityMinMultiplier: number;
  walletPriorityMaxMultiplier: number;
  stopLossEnabled: boolean;
  stopLossPct: number;
  takeProfitEnabled: boolean;
  takeProfitPct: number;
}

export interface WalletStats {
  wallet: string;
  buyCount: number;
  closedTradeCount: number;
  realizedPnlLamports: string;
  realizedPnlSol: number;
  winRate: number;
  avgRoiPct: number;
  priorityMultiplier: number;
}

export interface LedgerSummary {
  totalRealizedPnlLamports: string;
  totalRealizedPnlSol: number;
  totalClosedTrades: number;
  wallets: WalletStats[];
}

export interface OpenPosition {
  sourceWallet: string;
  mint: string;
  dex: "pumpfun" | "raydium";
  costBasisLamports: string;
  costBasisSol: number;
  tokenRawAmount: string;
  currentValueLamports: string | null;
  currentValueSol: number | null;
  unrealizedPnlSol: number | null;
  unrealizedPnlPct: number | null;
}

export interface Fill {
  id: string;
  at: number;
  sourceWallet: string;
  mint: string;
  direction: "buy" | "sell";
  dex: "pumpfun" | "raydium";
  solAmount: number;
  tokenRawAmount: string;
  signature: string;
}

export class CopyTraderApiError extends Error {}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) throw new CopyTraderApiError(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function getStatus(): Promise<BotStatusSnapshot> {
  return handle(await fetch(`${API_URL}/api/status`));
}

export async function getRecentEvents(limit = 50): Promise<BotEvent[]> {
  return handle(await fetch(`${API_URL}/api/trades?limit=${limit}`));
}

export async function startBot(): Promise<void> {
  const res = await fetch(`${API_URL}/api/start`, { method: "POST" });
  const body = await handle<{ ok: boolean; error?: string }>(res);
  if (!body.ok) throw new CopyTraderApiError(body.error ?? "failed to start");
}

export async function stopBot(): Promise<void> {
  await fetch(`${API_URL}/api/stop`, { method: "POST" });
}

export async function addTargetWallet(address: string): Promise<string[]> {
  const res = await fetch(`${API_URL}/api/target-wallets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new CopyTraderApiError(body.error ?? `${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { wallets: string[] };
  return body.wallets;
}

export async function removeTargetWallet(address: string): Promise<string[]> {
  const res = await fetch(`${API_URL}/api/target-wallets/${encodeURIComponent(address)}`, { method: "DELETE" });
  const body = await handle<{ wallets: string[] }>(res);
  return body.wallets;
}

export async function getSettings(): Promise<CopyTraderSettings> {
  return handle(await fetch(`${API_URL}/api/settings`));
}

export async function updateSettings(patch: Partial<CopyTraderSettings>): Promise<CopyTraderSettings> {
  return handle(
    await fetch(`${API_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  );
}

export async function getLedgerSummary(): Promise<LedgerSummary> {
  return handle(await fetch(`${API_URL}/api/ledger/summary`));
}

export async function getRecentFills(limit = 50): Promise<Fill[]> {
  return handle(await fetch(`${API_URL}/api/ledger/fills?limit=${limit}`));
}

export async function getOpenPositions(): Promise<OpenPosition[]> {
  return handle(await fetch(`${API_URL}/api/ledger/positions`));
}

/** Live event stream via SSE. Returns an unsubscribe function. EventSource
 * reconnects on its own (the server sends a `retry:` hint), so no manual
 * reconnect logic is needed here. */
export function subscribeToEvents(onEvent: (event: BotEvent) => void, onConnectionChange?: (connected: boolean) => void): () => void {
  const source = new EventSource(`${API_URL}/api/stream`);
  source.onopen = () => onConnectionChange?.(true);
  source.onerror = () => onConnectionChange?.(false);
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      // ignore malformed event
    }
  };
  return () => source.close();
}

export interface MirrorSignalMessage {
  id: string;
  at: number;
  direction: "buy" | "sell";
  dex: "pumpfun" | "raydium";
  mint: string;
  sellFractionOfHoldings: number | null;
  sourceSignature: string;
}

/** Raw WebSocket to copy-trader's /signals broadcaster (copy-trader/src/signalServer.ts).
 * Unlike EventSource, plain WebSocket doesn't reconnect itself, so this
 * handles backoff reconnect manually. Returns an unsubscribe function. */
export function subscribeToMirrorSignals(
  onSignal: (signal: MirrorSignalMessage) => void,
  onConnectionChange?: (connected: boolean) => void
): () => void {
  let ws: WebSocket | null = null;
  let closedByCaller = false;
  let attempt = 0;

  function connect() {
    ws = new WebSocket(`${WS_URL}/signals`);

    ws.onopen = () => {
      attempt = 0;
      onConnectionChange?.(true);
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "connected") return; // initial handshake ack, not a trade signal
        onSignal(data as MirrorSignalMessage);
      } catch {
        // ignore malformed message
      }
    };

    ws.onclose = () => {
      onConnectionChange?.(false);
      if (closedByCaller) return;
      attempt += 1;
      setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt));
    };

    ws.onerror = () => ws?.close();
  }

  connect();
  return () => {
    closedByCaller = true;
    ws?.close();
  };
}
