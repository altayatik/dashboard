// config.js
window.DASH_CONFIG = {
  name: "Altay",
  dataApiBase: "https://dashboard-data-api.vercel.app",

  // Set these to your location (example: Chicago)
  lat: 41.8781,
  lon: -87.6298,

  // Change to your TZ (must match Open-Meteo timezone string)
  timezone: "America/Chicago",

  // 12h or 24h time display
  use24h: true,

  // Optional: show seconds (e-ink usually doesn't need it)
  showSeconds: false
};
