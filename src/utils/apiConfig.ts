// API Configuration for Proxy Server
const API_CONFIG = {
  proxyBaseUrl: import.meta.env.VITE_PROXY_URL || 'http://localhost:3001',
  isProxyEnabled: import.meta.env.VITE_USE_PROXY === 'true' // Explicitly check for 'true'
};

// Auto-disable proxy if server is not reachable
let proxyServerAvailable = false; // Default to false for safety

const checkProxyServer = async () => {
  if (!API_CONFIG.isProxyEnabled) return false;
  
  try {
    const response = await fetch(`${API_CONFIG.proxyBaseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000) // 3 second timeout
    });
    return response.ok;
  } catch (error) {
    return false;
  }
};

// Check proxy server availability on module load (but don't block)
if (API_CONFIG.isProxyEnabled) {
  checkProxyServer().then(available => {
    proxyServerAvailable = available;
  });
}

// Updated API config with fallback - always returns current state
const getApiConfig = () => {
  const actuallyEnabled = API_CONFIG.isProxyEnabled && proxyServerAvailable;
  
  return {
    proxyBaseUrl: API_CONFIG.proxyBaseUrl,
    isProxyEnabled: actuallyEnabled
  };
};

export { API_CONFIG, getApiConfig };
