// Serve the admin dashboard HTML from cloud-gateway/admin.html

import { readFileSync } from "fs";
import { resolve } from "path";

function loadHtml(): string {
  const candidates = [
    resolve(import.meta.dir, "../../admin.html"),
    resolve(import.meta.dir, "../../../admin.html"),
    resolve(process.cwd(), "admin.html"),
  ];

  for (const p of candidates) {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      // try next
    }
  }

  return `<!DOCTYPE html><html><body><h1>Admin page not found</h1></body></html>`;
}

export const adminHtml: string = loadHtml();
