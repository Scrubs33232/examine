import type { Analysis, CalibrationResponse, LiveOdds } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // ignore
    }
    throw new ApiError(detail, res.status);
  }
  return res.json();
}

export async function analyzeUrl(url: string): Promise<Analysis> {
  const res = await fetch(`${API_URL}/api/analyze/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return handle<Analysis>(res);
}

export async function analyzeImage(file: File): Promise<Analysis> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/api/analyze/image`, {
    method: "POST",
    body: formData,
  });
  return handle<Analysis>(res);
}

export async function analyzeText(rawText: string): Promise<Analysis> {
  const res = await fetch(`${API_URL}/api/analyze/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw_text: rawText }),
  });
  return handle<Analysis>(res);
}

export async function getAnalysis(id: string): Promise<Analysis> {
  const res = await fetch(`${API_URL}/api/analyses/${id}`);
  return handle<Analysis>(res);
}

export async function getLiveOdds(id: string): Promise<LiveOdds> {
  const res = await fetch(`${API_URL}/api/analyses/${id}/live-odds`);
  return handle<LiveOdds>(res);
}

export async function getCalibration(): Promise<CalibrationResponse> {
  const res = await fetch(`${API_URL}/api/calibration`);
  return handle<CalibrationResponse>(res);
}

export interface OcrTextResult {
  raw_text: string;
  platform_guess: string;
  question_guess: string;
  ocr_available: boolean;
}

export async function extractOcrText(file: File): Promise<OcrTextResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/api/ocr/text`, {
    method: "POST",
    body: formData,
  });
  return handle<OcrTextResult>(res);
}
