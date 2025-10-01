// API Configuration for Proxy Server with LAN-friendly defaults
const resolveProxyBaseUrl = () => {
  // Prefer explicit env when it is not localhost, otherwise build from current host
  const envUrl = (import.meta as any).env?.VITE_PROXY_URL as string | undefined;
  const isLocalhost = (url?: string) => !!url && /^https?:\/\/localhost(?::|$)/i.test(url);

  // Compute a dynamic default like http://<current-hostname>:3051
  const dynamicDefault = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:3051`
    : 'http://157.180.9.225:3051';

  if (envUrl && envUrl.trim() && !isLocalhost(envUrl)) {
    return envUrl.trim();
  }
  return dynamicDefault;
};

const API_CONFIG = {
  proxyBaseUrl: resolveProxyBaseUrl(),
  isProxyEnabled: (import.meta as any).env?.VITE_USE_PROXY !== 'false' // Enable proxy by default, only disable if explicitly set to 'false'
};

// Updated API config: enforce proxy when explicitly enabled.
const getApiConfig = () => ({
  proxyBaseUrl: API_CONFIG.proxyBaseUrl,
  isProxyEnabled: API_CONFIG.isProxyEnabled
});

export { API_CONFIG, getApiConfig };
