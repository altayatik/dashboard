import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DASHBOARD_PORT || 8000);
const HOST = "127.0.0.1";
const UPSTREAM = "https://dashboard-data-api.vercel.app";
const LOCAL_SERVICES = {
  weather: () => import("../dashboard-data-api/services/weather.js").then(({ getWeather }) => getWeather()),
  markets: () => import("../dashboard-data-api/services/markets.js").then(({ getMarkets }) => getMarkets()),
  traffic: () => import("../dashboard-data-api/services/traffic.js").then(({ getTraffic }) => getTraffic())
};
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png"
};

function extractPayload(text, kind) {
  try {
    return JSON.parse(text);
  } catch {
    const marker = `window.DASH_DATA.${kind}`;
    const markerIndex = text.indexOf(marker);
    const equalsIndex = markerIndex >= 0 ? text.indexOf("=", markerIndex + marker.length) : -1;
    if (equalsIndex < 0) throw new Error(`${kind} returned an unsupported response`);
    return JSON.parse(text.slice(equalsIndex + 1).trim().replace(/;+\s*$/, ""));
  }
}

async function upstreamData(kind) {
  if (process.env.DASHBOARD_USE_REMOTE !== "1" && LOCAL_SERVICES[kind]) {
    return LOCAL_SERVICES[kind]();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), kind === "markets" ? 10000 : 7000);
  try {
    const response = await fetch(`${UPSTREAM}/api/${kind}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`${kind} HTTP ${response.status}`);
    return extractPayload(await response.text(), kind);
  } finally {
    clearTimeout(timer);
  }
}

async function dashboardSnapshot() {
  const kinds = ["weather", "markets", "traffic"];
  const results = await Promise.allSettled(kinds.map(upstreamData));
  return {
    updated_iso: new Date().toISOString(),
    ...Object.fromEntries(kinds.map((kind, index) => [
      kind,
      results[index].status === "fulfilled" ? results[index].value : null
    ])),
    partial: results.some((result) => result.status === "rejected"),
    errors: results.map((result) => result.status === "rejected" ? result.reason?.message || "Unavailable" : null)
  };
}

let cachedSnapshot = null;
let refreshInFlight = null;

function refreshSnapshot() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = dashboardSnapshot()
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(JSON.stringify(value));
}

async function serveStatic(requestPath, response) {
  const decoded = decodeURIComponent(requestPath);
  const requested = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const absolute = path.resolve(ROOT, `.${requested}`);
  if (!absolute.startsWith(`${ROOT}${path.sep}`) && absolute !== ROOT) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    let body = await fs.readFile(absolute);
    if (path.basename(absolute) === "index.html" && cachedSnapshot) {
      body = Buffer.from(
        body.toString("utf8").replace(
          "window.__PRELOADED_DASHBOARD__ = null;",
          `window.__PRELOADED_DASHBOARD__ = ${JSON.stringify(cachedSnapshot)};`
        )
      );
    }
    response.writeHead(200, {
      "Content-Type": MIME[path.extname(absolute)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);
  if (url.pathname === "/api/dashboard") {
    try {
      if (cachedSnapshot) {
        sendJson(response, 200, cachedSnapshot);
        void refreshSnapshot();
      } else {
        sendJson(response, 200, await refreshSnapshot());
      }
    } catch (error) {
      sendJson(response, 502, { error: error.message || "Dashboard data unavailable" });
    }
    return;
  }
  await serveStatic(url.pathname, response);
});

await refreshSnapshot().catch((error) => {
  console.warn(`Initial data preload failed: ${error.message}`);
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard preview: http://${HOST}:${PORT}/`);
});

setInterval(() => {
  void refreshSnapshot();
}, 5 * 60 * 1000).unref();
