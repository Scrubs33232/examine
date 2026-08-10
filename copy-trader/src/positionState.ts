/** Per-(sourceWallet,mint) exit-tracking state that ledger.ts's fill replay
 * doesn't capture: when the position was first opened, the highest value
 * it's reached (for trailing stop), and which take-profit ladder rungs have
 * already fired. Keyed the same way ledger.ts attributes positions, so it
 * stays consistent with the P&L accounting.
 *
 * Persisted to disk (gitignored, like ledger.json/settings.json) so restarts
 * don't reset trailing peaks or re-fire already-taken ladder rungs. Entries
 * are dropped once bot.ts confirms a position is fully closed. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config } from "./config.js";

export interface PositionState {
  sourceWallet: string;
  mint: string;
  firstEntryAt: number;
  peakValueLamports: string;
  /** roiPct values (from settingsStore's takeProfitLadders) already executed
   * for this position — each rung fires at most once. */
  takenLadderRungs: number[];
}

const STATE_PATH = config.positionStatePath;

function key(sourceWallet: string, mint: string): string {
  return `${sourceWallet}:${mint}`;
}

function load(): Map<string, PositionState> {
  if (!existsSync(STATE_PATH)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf-8")) as PositionState[];
    return new Map(raw.map((s) => [key(s.sourceWallet, s.mint), s]));
  } catch {
    return new Map();
  }
}

function save(states: Map<string, PositionState>): void {
  writeFileSync(STATE_PATH, JSON.stringify([...states.values()], null, 2));
}

class PositionStateStore {
  private states = load();

  /** Fetches (or lazily creates, on first observation of a position) the
   * tracking state for a position, then updates its peak value if
   * `currentValueLamports` is a new high. Returns the state *after* the
   * update, so callers see the peak that includes this tick's value. */
  observe(sourceWallet: string, mint: string, currentValueLamports: bigint): PositionState {
    const k = key(sourceWallet, mint);
    let state = this.states.get(k);
    if (!state) {
      state = { sourceWallet, mint, firstEntryAt: Date.now(), peakValueLamports: currentValueLamports.toString(), takenLadderRungs: [] };
      this.states.set(k, state);
    } else if (currentValueLamports > BigInt(state.peakValueLamports)) {
      state.peakValueLamports = currentValueLamports.toString();
    }
    save(this.states);
    return state;
  }

  markRungTaken(sourceWallet: string, mint: string, roiPct: number): void {
    const state = this.states.get(key(sourceWallet, mint));
    if (!state) return;
    if (!state.takenLadderRungs.includes(roiPct)) state.takenLadderRungs.push(roiPct);
    save(this.states);
  }

  /** Called once bot.ts confirms a position's tracked token balance has
   * hit zero — clears trailing-peak/ladder/entry-time state so a *future*
   * fresh position in the same (wallet, mint) pair starts clean rather than
   * inheriting a stale peak or already-taken rungs from the last time. */
  clear(sourceWallet: string, mint: string): void {
    if (this.states.delete(key(sourceWallet, mint))) save(this.states);
  }
}

export const positionStateStore = new PositionStateStore();
