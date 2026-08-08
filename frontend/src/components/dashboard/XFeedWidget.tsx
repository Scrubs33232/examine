"use client";

import { useEffect, useRef } from "react";

// X's official free embed (no API key) — renders a live timeline of a List
// you curate on x.com. Docs: https://publish.twitter.com (List embeds use
// the same widgets.js loader as tweet/timeline embeds).
export default function XFeedWidget({ listUrl }: { listUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !listUrl) return;

    container.innerHTML = "";

    const anchor = document.createElement("a");
    anchor.className = "twitter-timeline";
    anchor.setAttribute("data-theme", "dark");
    anchor.setAttribute("data-height", "600");
    anchor.href = listUrl;
    anchor.textContent = "Tracked accounts";
    container.appendChild(anchor);

    const existingScript = document.getElementById("twitter-widgets-js");
    if (existingScript) {
      // Script already loaded once — ask X's widget library to re-scan the DOM.
      (window as any).twttr?.widgets?.load(container);
    } else {
      const script = document.createElement("script");
      script.id = "twitter-widgets-js";
      script.src = "https://platform.twitter.com/widgets.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, [listUrl]);

  if (!listUrl) return null;

  return <div ref={containerRef} className="min-h-[400px] overflow-hidden rounded-2xl border border-border bg-surface p-2" />;
}
