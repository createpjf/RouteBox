// ---------------------------------------------------------------------------
// SSRF guard — 本地 provider 的 baseUrl 必须指向 loopback 或私有网段
// ---------------------------------------------------------------------------

/** 判断一个 IPv4 字符串是否属于 loopback / 私有 / link-local 网段 */
function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const oct = m.slice(1).map(Number);
  if (oct.some((n) => n > 255)) return false;
  const [a, b] = oct;
  if (a === 127) return true;                 // 127.0.0.0/8 loopback
  if (a === 10) return true;                  // 10.0.0.0/8
  if (a === 192 && b === 168) return true;    // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  // 169.254.0.0/16 (link-local, 含云元数据 169.254.169.254) 一律拒绝
  return false;
}

/** 校验 URL 仅指向本机/私有网络;否则抛错。用于本地 provider 配置与探测。
 *  注意:基于 hostname 静态判断,不做 DNS 解析,故不防御「域名解析到内网 IP」的 DNS rebinding。 */
export function assertSafeLocalUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported scheme: ${url.protocol}`);
  }
  let host = url.hostname.toLowerCase();
  // 去掉 IPv6 字面量的方括号
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);

  if (host === "localhost") return;
  if (host === "::1") return;                 // IPv6 loopback
  if (host.startsWith("fe80:")) return;       // IPv6 link-local (本机)
  if (isPrivateIpv4(host)) return;

  throw new Error(`Refusing non-local provider URL: ${rawUrl}`);
}
