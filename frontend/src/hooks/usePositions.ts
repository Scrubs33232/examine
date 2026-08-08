"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDexScreenerData } from "@/lib/dexscreener";
import { checkExitConditions, type ExitAlert } from "@/lib/exitConditions";
import { loadPositions, savePositions, type Position } from "@/lib/positions";

const POLL_INTERVAL_MS = 15_000;

export interface PositionWithLive extends Position {
  currentPriceUsd: number | null;
  pnlPct: number | null;
}

export interface AlertThresholds {
  takeProfitPct: number;
  stopLossPct: number;
}

export function usePositions(thresholds: AlertThresholds, onAlert: (position: Position, alert: ExitAlert) => void) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const alertedRef = useRef<Set<string>>(new Set());
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  useEffect(() => {
    setPositions(loadPositions());
  }, []);

  const addPosition = useCallback((mint: string, symbol: string, entryPriceUsd: number) => {
    setPositions((prev) => {
      const next = [...prev.filter((p) => p.mint !== mint), { mint, symbol, entryPriceUsd, addedAt: Date.now() }];
      savePositions(next);
      return next;
    });
    alertedRef.current.delete(`${mint}:take_profit`);
    alertedRef.current.delete(`${mint}:stop_loss`);
  }, []);

  const removePosition = useCallback((mint: string) => {
    setPositions((prev) => {
      const next = prev.filter((p) => p.mint !== mint);
      savePositions(next);
      return next;
    });
    alertedRef.current.delete(`${mint}:take_profit`);
    alertedRef.current.delete(`${mint}:stop_loss`);
  }, []);

  useEffect(() => {
    if (positions.length === 0) return;

    let cancelled = false;

    async function poll() {
      const updates: Record<string, number | null> = {};
      for (const position of positions) {
        const dex = await fetchDexScreenerData(position.mint);
        if (cancelled) return;
        const price = dex?.priceUsd ?? null;
        updates[position.mint] = price;

        if (price !== null) {
          const alertKey = (reason: string) => `${position.mint}:${reason}`;
          const alert = checkExitConditions(position.entryPriceUsd, price, thresholds.takeProfitPct, thresholds.stopLossPct);
          if (alert && !alertedRef.current.has(alertKey(alert.reason))) {
            alertedRef.current.add(alertKey(alert.reason));
            onAlertRef.current(position, alert);
          }
        }
      }
      if (!cancelled) setPrices((prev) => ({ ...prev, ...updates }));
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, thresholds.takeProfitPct, thresholds.stopLossPct]);

  const positionsWithLive: PositionWithLive[] = positions.map((p) => {
    const currentPriceUsd = prices[p.mint] ?? null;
    const pnlPct = currentPriceUsd !== null ? ((currentPriceUsd - p.entryPriceUsd) / p.entryPriceUsd) * 100 : null;
    return { ...p, currentPriceUsd, pnlPct };
  });

  return { positions: positionsWithLive, addPosition, removePosition };
}
