import type { CalibrationBucket } from "@/lib/types";

const SIZE = 320;
const PAD = 36;
const PLOT = SIZE - PAD * 2;

// Matches tailwind.config.ts colors — SVG attributes can't resolve Tailwind
// classes, so the palette is duplicated here.
const COLOR_BORDER = "#1e2632";
const COLOR_MUTED = "#7c8798";
const COLOR_BULL = "#22e0a0";
const COLOR_BEAR = "#ff5c72";

function toX(v: number) {
  return PAD + v * PLOT;
}
function toY(v: number) {
  return PAD + (1 - v) * PLOT;
}

export default function ReliabilityDiagram({ buckets }: { buckets: CalibrationBucket[] }) {
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-md" role="img" aria-label="Reliability diagram">
      {/* axes */}
      <line x1={PAD} y1={SIZE - PAD} x2={SIZE - PAD} y2={SIZE - PAD} stroke={COLOR_BORDER} strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={SIZE - PAD} stroke={COLOR_BORDER} strokeWidth={1} />

      {/* perfect-calibration reference diagonal */}
      <line
        x1={toX(0)}
        y1={toY(0)}
        x2={toX(1)}
        y2={toY(1)}
        stroke={COLOR_MUTED}
        strokeWidth={1}
        strokeDasharray="4 4"
        opacity={0.5}
      />

      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <text key={`x${t}`} x={toX(t)} y={SIZE - PAD + 14} textAnchor="middle" fontSize={9} fill={COLOR_MUTED} fontFamily="monospace">
          {Math.round(t * 100)}
        </text>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <text key={`y${t}`} x={PAD - 8} y={toY(t) + 3} textAnchor="end" fontSize={9} fill={COLOR_MUTED} fontFamily="monospace">
          {Math.round(t * 100)}
        </text>
      ))}

      {buckets.map((b) => {
        const r = 3 + (b.count / maxCount) * 9;
        const wellCalibrated = Math.abs(b.predicted_avg - b.actual_rate) < 0.1;
        const color = wellCalibrated ? COLOR_BULL : COLOR_BEAR;
        return (
          <circle key={b.range_label} cx={toX(b.predicted_avg)} cy={toY(b.actual_rate)} r={r} fill={color} fillOpacity={0.75} stroke={color}>
            <title>
              {b.range_label}: predicted {Math.round(b.predicted_avg * 100)}%, actual {Math.round(b.actual_rate * 100)}% ({b.count} resolved)
            </title>
          </circle>
        );
      })}

      <text x={SIZE / 2} y={SIZE - 6} textAnchor="middle" fontSize={9} fill={COLOR_MUTED} fontFamily="monospace">
        Predicted probability (%)
      </text>
      <text x={12} y={SIZE / 2} textAnchor="middle" fontSize={9} fill={COLOR_MUTED} fontFamily="monospace" transform={`rotate(-90 12 ${SIZE / 2})`}>
        Actual outcome rate (%)
      </text>
    </svg>
  );
}
