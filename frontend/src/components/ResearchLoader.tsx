"use client";

import { useEffect, useState } from "react";

const STAGES = [
  "Detecting platform & extracting market data",
  "Pulling current odds & liquidity",
  "Analyzing news & sentiment signals",
  "Running calibrated probability model",
  "Calculating edge, EV & Kelly size",
];

export default function ResearchLoader() {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, STAGES.length - 1));
    }, 1100);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="w-full max-w-md px-6">
        <div className="relative mb-8 h-1 w-full overflow-hidden rounded-full bg-surface-raised">
          <div className="absolute inset-y-0 w-1/3 animate-scan-line rounded-full bg-gradient-to-r from-transparent via-accent to-transparent" />
        </div>

        <div className="mb-6 text-center font-mono text-xs uppercase tracking-widest text-muted">
          Researching market
        </div>

        <ul className="space-y-3 font-mono text-sm">
          {STAGES.map((stage, i) => {
            const done = i < stageIndex;
            const active = i === stageIndex;
            return (
              <li key={stage} className="flex items-center gap-3">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                    done
                      ? "border-bull bg-bull/10 text-bull"
                      : active
                        ? "border-accent text-accent animate-pulse-soft"
                        : "border-border text-muted"
                  }`}
                >
                  {done ? "✓" : "•"}
                </span>
                <span className={done ? "text-foreground" : active ? "text-foreground" : "text-muted"}>
                  {stage}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
