export const PLATFORM_LABELS: Record<string, string> = {
  polymarket: "Polymarket",
  kalshi: "Kalshi",
  predictit: "PredictIt",
  manifold: "Manifold",
  unknown: "Unknown",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}
