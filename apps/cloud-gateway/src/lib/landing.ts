// Serve the landing page HTML from cloud-gateway/landing.html
// The file is at the repo root of cloud-gateway (COPY . . in Docker includes it).

import { readFileSync } from "fs";
import { resolve } from "path";

function loadHtml(): string {
  const candidates = [
    resolve(import.meta.dir, "../../landing.html"),       // src/lib/ -> cloud-gateway/
    resolve(import.meta.dir, "../../../landing.html"),     // fallback
    resolve(process.cwd(), "landing.html"),                // cwd = /app in Docker
  ];

  for (const p of candidates) {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      // try next
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=https://github.com/createpjf/RouteBox"></head><body>Redirecting...</body></html>`;
}

export const landingHtml: string = loadHtml();
