import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

// Cache loaded files in memory
const cache = new Map<string, { data: Uint8Array; contentType: string }>();

function getStaticDir(): string {
  const candidates = [
    resolve(import.meta.dir, "../../static"),
    resolve(process.cwd(), "static"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0];
}

const staticDir = getStaticDir();

export function serveStaticFile(
  fileName: string,
): { data: Uint8Array; contentType: string } | null {
  // Prevent path traversal
  if (fileName.includes("..") || fileName.includes("/")) return null;

  const cached = cache.get(fileName);
  if (cached) return cached;

  const filePath = resolve(staticDir, fileName);
  if (!existsSync(filePath)) return null;

  const ext = fileName.substring(fileName.lastIndexOf("."));
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  try {
    const buf = readFileSync(filePath);
    const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const result = { data, contentType };
    cache.set(fileName, result);
    return result;
  } catch {
    return null;
  }
}
