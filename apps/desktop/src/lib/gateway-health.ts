/** Returns true when the URL points to localhost / 127.0.0.1 (i.e. a locally spawned gateway) */
export function isLocalGatewayUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"].includes(hostname);
  } catch {
    return true; // default to local if URL is malformed
  }
}

/** Check if gateway is reachable and healthy */
export async function checkGatewayHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Poll gateway health until it responds or timeout */
export async function waitForGateway(
  url: string,
  timeoutMs = 10_000,
  intervalMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkGatewayHealth(url)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
