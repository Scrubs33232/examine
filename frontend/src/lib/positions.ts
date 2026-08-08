// Client-side (localStorage) position bookkeeping. A "position" here is
// purely a note you (or a buy button you clicked) recorded — nothing here
// trades. Scoped per browser, not per wallet, since it's just a memory aid.

export interface Position {
  mint: string;
  symbol: string;
  entryPriceUsd: number;
  addedAt: number;
}

const STORAGE_KEY = "examine_positions_v1";

export function loadPositions(): Position[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Position[]) : [];
  } catch {
    return [];
  }
}

export function savePositions(positions: Position[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // storage unavailable/full — non-fatal, just won't persist across reloads.
  }
}
