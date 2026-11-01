// Pengecek asal request di sisi server (pagar). Dipakai di semua endpoint /api.
const ALLOWED_HOSTS = [
  "nyr-cidmusik-v1.vercel.app"
];

function extractHost(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

export function isAllowedRequest(req) {
  const originHost = extractHost(req.headers.origin);
  const refererHost = extractHost(req.headers.referer);
  const requestHost = (req.headers.host || "").split(":")[0];
  const candidate = originHost || refererHost || requestHost;
  return ALLOWED_HOSTS.includes(candidate);
}

export function withProxyGuard(handler) {
  return async (req, res) => {
    if (!isAllowedRequest(req)) {
      res.status(403).json({ error: "link tidak resmi! Tidak dapat dibuka!" });
      return;
    }
    return handler(req, res);
  };
}
