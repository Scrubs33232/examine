// Desktop notifications for exit-condition alerts, so they still surface if
// the dashboard tab isn't focused. Opt-in — permission is only requested on
// an explicit user click, and the preference is remembered per browser.

const STORAGE_KEY = "examine_desktop_alerts_v1";

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function desktopAlertsEnabled(): boolean {
  if (!isNotificationSupported()) return false;
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1" && Notification.permission === "granted";
}

export async function enableDesktopAlerts(): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  const granted = permission === "granted";
  if (granted) window.localStorage.setItem(STORAGE_KEY, "1");
  return granted;
}

export function disableDesktopAlerts(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, "0");
}

export function notifyExitAlert(symbol: string, message: string): void {
  if (!desktopAlertsEnabled()) return;
  try {
    new Notification(`Examine — ${symbol}`, { body: message, tag: `examine-alert-${symbol}` });
  } catch {
    // Notification construction can throw in some contexts (e.g. service-worker-only origins) — non-fatal.
  }
}
