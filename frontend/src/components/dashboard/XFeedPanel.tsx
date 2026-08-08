"use client";

import { useEffect, useState } from "react";
import XFeedWidget from "./XFeedWidget";

const STORAGE_KEY = "examine_x_list_url_v1";

export default function XFeedPanel() {
  const [listUrl, setListUrl] = useState("");
  const [input, setInput] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) ?? "";
    setListUrl(saved);
    setInput(saved);
  }, []);

  function save() {
    const trimmed = input.trim();
    setListUrl(trimmed);
    window.localStorage.setItem(STORAGE_KEY, trimmed);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">X Feed</h2>

      {!listUrl && (
        <p className="mb-3 font-mono text-[10px] text-muted">
          Free, no API key — paste the URL of a{" "}
          <a href="https://x.com/i/lists/create" target="_blank" rel="noopener noreferrer" className="text-accent underline">
            List you curate on x.com
          </a>{" "}
          (e.g. crypto KOLs, news accounts) to embed its live timeline here.
        </p>
      )}

      <div className="mb-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://x.com/i/lists/..."
          className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none"
        />
        <button onClick={save} className="rounded-lg border border-border bg-surface-raised px-3 py-1.5 font-mono text-xs text-muted hover:text-foreground">
          Save
        </button>
      </div>

      <XFeedWidget listUrl={listUrl} />
    </div>
  );
}
