export const dashboardConfig = {
  apiBaseUrl: "https://your-host.example.com/api",
  authHeader: "Authorization",
  authScheme: "Bearer",
  tokenStorageKey: "onboardx_dashboard_token",
  refreshMs: 15000,
  endpoints: {
    systemStatus: "/system/status",
    clusters: "/system/clusters",
    shards: "/system/shards",
    incidents: "/system/incidents",
    guildConfig: (guildId) => `/guilds/${encodeURIComponent(guildId)}`,
    guildModules: (guildId) => `/guilds/${encodeURIComponent(guildId)}/modules`,
  },
};

export function buildApiUrl(path) {
  return `${dashboardConfig.apiBaseUrl.replace(/\/+$/, "")}${path}`;
}

export function getStoredToken() {
  return localStorage.getItem(dashboardConfig.tokenStorageKey) || "";
}

export function setStoredToken(token) {
  if (!token) localStorage.removeItem(dashboardConfig.tokenStorageKey);
  else localStorage.setItem(dashboardConfig.tokenStorageKey, token);
}

export function createHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getStoredToken();
  if (token) headers[dashboardConfig.authHeader] = `${dashboardConfig.authScheme} ${token}`;
  return headers;
}
