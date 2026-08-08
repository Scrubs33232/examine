// Client-side OCR via tesseract.js (WebAssembly) — runs entirely in the
// browser, no server-side Tesseract binary/installation required at all.
// First call in a session downloads the English language data (~2-4MB,
// cached by the browser afterward).

import { createWorker } from "tesseract.js";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function recognizeTextFromImage(file: File): Promise<string> {
  // Passing the raw File straight to worker.recognize() throws "Error
  // attempting to read image" in some bundler setups (confirmed while
  // building this, in this Next.js/webpack config) — a data URL is read
  // reliably across environments instead.
  const dataUrl = await fileToDataUrl(file);

  // tesseract.js's default worker/core auto-detection doesn't resolve
  // correctly under Next.js/webpack bundling (confirmed while building
  // this — it threw "Error attempting to read image" regardless of image
  // input). Self-hosting the worker + WASM core from /public and pointing
  // at them explicitly fixes it.
  //
  // langPath matters too: left unset, tesseract.js silently fetches the
  // ~3MB English model from the jsdelivr CDN on every first use. Any
  // network hiccup there (corporate proxy, ad-blocker, offline dev, CDN
  // outage) throws inside the worker and was surfacing to the user as a
  // bare "Something went wrong" with no indication OCR was the cause.
  // Self-hosting it removes that external dependency entirely.
  const worker = await createWorker("eng", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/tesseract-core-lstm.wasm.js",
    langPath: "/tesseract",
  });
  try {
    const {
      data: { text },
    } = await worker.recognize(dataUrl);
    return text;
  } finally {
    await worker.terminate();
  }
}
