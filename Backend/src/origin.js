export function isAllowedOrigin(origin, config) {
  if (origin === config.APP_ORIGIN) return true;
  if (config.NODE_ENV !== "development") return false;

  // Local Vite URLs use either hostname; keep the scheme and port restricted.
  try {
    const requested = new URL(origin);
    const configured = new URL(config.APP_ORIGIN);
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return (
      requested.origin === origin &&
      loopback.has(requested.hostname) &&
      loopback.has(configured.hostname) &&
      requested.protocol === configured.protocol &&
      requested.port === configured.port
    );
  } catch {
    return false;
  }
}
