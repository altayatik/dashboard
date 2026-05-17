import {
  initStageScale,
  initTheme,
  initTopClock,
  $,
  CFG,
  timeParts
} from "./shared/core.js";

import { iconChart, iconWeather, iconClock, iconRoad } from "./shared/icons.js";
import { wxText } from "./shared/weather-utils.js";
import { HOME_CLOCKS, formatTime12h } from "./shared/world-clock-utils.js";

const LS_WEATHER = "dash_weather_embedded_v1";
const LS_MARKETS = "dash_markets_embedded_v1";
const LS_TRAFFIC = "dash_traffic_embedded_v1";
const DATA_API_BASE = "https://dashboard-data-api.vercel.app";
const DATA_SCRIPT_TIMEOUT_MS = 4500;
const STATIC_DATA_URLS = {
  weather: new URL("./data/weather.json", import.meta.url),
  markets: new URL("./data/markets.json", import.meta.url)
};

function afterPageLoad(fn) {
  const run = () => window.setTimeout(fn, 0);
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
}

function greetingForHour24(h) {
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 21) return "Good evening";
  return "Good night";
}

function fmtPrice(p) {
  if (p == null || !Number.isFinite(Number(p))) return "--";
  return `$${Number(p).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/* ---------- Footer helpers ---------- */
function toDateObj(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function fmtMMDD(d) {
  return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit" }).format(d);
}

function fmtHHMM24(d) {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

function marketStatusText(inHours) {
  if (inHours === true) return "Open";
  if (inHours === false) return "Closed";
  return "";
}

function buildFooterLine(state) {
  const parts = [];
  if (state.market) parts.push(state.market);
  if (state.traffic) parts.push(state.traffic);
  if (state.loaded) parts.push(state.loaded);
  return parts.join(" · ");
}

/* ---------------- World clock (main card) ---------------- */

function renderWorldClockStrip(container) {
  if (!container) return;

  container.innerHTML = HOME_CLOCKS.map((c) => `
    <div class="wcTile">
      <div class="wcCity">${c.label}</div>
      <div class="wcTime" data-tz="${c.tz}">--:--</div>
    </div>
  `).join("");
}

function tickWorldClockStrip(container) {
  if (!container) return;
  const nodes = container.querySelectorAll("[data-tz]");
  for (const n of nodes) {
    const tz = n.getAttribute("data-tz");
    n.textContent = formatTime12h(tz);
  }
}

/* ---------------- Traffic (main card) ---------------- */

function shortTrafficStatus(s) {
  const v = String(s || "").toLowerCase();
  if (v.startsWith("light")) return "LIGHT";
  if (v.startsWith("medium")) return "MEDIUM";
  if (v.startsWith("heavy")) return "HEAVY";
  if (v.startsWith("severe")) return "SEVERE";
  return (s || "--").toString().toUpperCase();
}

function renderTraffic(el, trafficObj) {
  if (!el.trafficList) return;

  const routes = Array.isArray(trafficObj?.routes) ? trafficObj.routes : null;
  if (!routes || routes.length === 0) return;

  el.trafficList.innerHTML = routes.slice(0, 3).map(r => `
    <div class="wcTile">
      <div class="wcCity">${r.label || r.id || "--"}</div>
      <div class="wcTime">${shortTrafficStatus(r.status)}</div>
    </div>
  `).join("");
}

/* ---------------- Data from embedded scripts + cache ---------------- */

function renderFromEmbedded(el, footerState) {
  const w = window.DASH_DATA?.weather;
  const m = window.DASH_DATA?.markets;
  const t = window.DASH_DATA?.traffic;

  if (w?.current) {
    const code = w.current.weather_code;
    const temp = Math.round(w.current.temperature_2m);
    const hi = Math.round(w.daily?.temperature_2m_max?.[0] ?? temp);
    const lo = Math.round(w.daily?.temperature_2m_min?.[0] ?? temp);

    if (el.wxIcon) el.wxIcon.innerHTML = iconWeather(code);
    if (el.wxTemp) el.wxTemp.textContent = `${temp}°`;
    if (el.wxDesc) el.wxDesc.textContent = wxText(code);
    if (el.wxHi) el.wxHi.textContent = `${hi}°`;
    if (el.wxLo) el.wxLo.textContent = `${lo}°`;

    localStorage.setItem(LS_WEATHER, JSON.stringify({ current: { code, temp, hi, lo, text: wxText(code) } }));
  }

  if (m?.symbols?.SPY?.price != null) {
    if (el.spy) el.spy.textContent = fmtPrice(m.symbols.SPY.price);
    if (el.iau) el.iau.textContent = fmtPrice(m.symbols.IAU?.price);

    const d = toDateObj(m.updated_iso);
    const status = marketStatusText(m.in_hours);

    footerState.market = d
      ? `Market ${fmtMMDD(d)} ${fmtHHMM24(d)}${status ? ` (${status})` : ""}`
      : (status ? `Market (${status})` : "Market");

    localStorage.setItem(LS_MARKETS, JSON.stringify({ ...m }));
  }

  if (t?.routes?.length) {
    renderTraffic(el, t);

    const d = toDateObj(t.updated_iso);
    footerState.traffic = d ? `Traffic ${fmtHHMM24(d)}` : "Traffic";

    localStorage.setItem(LS_TRAFFIC, JSON.stringify(t));
  }

  if (el.footerLine) el.footerLine.textContent = buildFooterLine(footerState);
}

function renderFromCache(el, footerState) {
  try {
    const w = JSON.parse(localStorage.getItem(LS_WEATHER));
    if (w?.current) {
      if (el.wxTemp) el.wxTemp.textContent = `${w.current.temp}°`;
      if (el.wxDesc) el.wxDesc.textContent = w.current.text;
      if (el.wxHi) el.wxHi.textContent = `${w.current.hi}°`;
      if (el.wxLo) el.wxLo.textContent = `${w.current.lo}°`;
      if (el.wxIcon) el.wxIcon.innerHTML = iconWeather(w.current.code);
    }
  } catch {}

  try {
    const m = JSON.parse(localStorage.getItem(LS_MARKETS));
    if (m?.symbols) {
      if (el.spy) el.spy.textContent = fmtPrice(m.symbols.SPY?.price);
      if (el.iau) el.iau.textContent = fmtPrice(m.symbols.IAU?.price);

      const d = toDateObj(m.updated_iso);
      const status = marketStatusText(m.in_hours);

      footerState.market = d
        ? `Market ${fmtMMDD(d)} ${fmtHHMM24(d)}${status ? ` (${status})` : ""}`
        : "";
    }
  } catch {}

  try {
    const t = JSON.parse(localStorage.getItem(LS_TRAFFIC));
    if (t?.routes?.length) {
      renderTraffic(el, t);
      const d = toDateObj(t.updated_iso);
      footerState.traffic = d ? `Traffic ${fmtHHMM24(d)}` : "";
    }
  } catch {}
}

function loadDataScript(kind) {
  return new Promise((resolve) => {
    window.DASH_DATA = window.DASH_DATA || {};

    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      script.remove();
      resolve(null);
    }, DATA_SCRIPT_TIMEOUT_MS);

    script.src = `${DATA_API_BASE}/api/${kind}`;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      resolve(window.DASH_DATA?.[kind] || null);
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };

    document.head.appendChild(script);
  });
}

function refreshEmbeddedData(el, footerState) {
  for (const kind of ["weather", "markets", "traffic"]) {
    loadDataScript(kind).then((payload) => {
      if (!payload) return;
      renderFromEmbedded(el, footerState);
      if (el.footerLine) el.footerLine.textContent = buildFooterLine(footerState);
    });
  }
}

async function loadStaticFallbacks(el, footerState) {
  for (const [kind, url] of Object.entries(STATIC_DATA_URLS)) {
    if (window.DASH_DATA?.[kind]) continue;

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      window.DASH_DATA = window.DASH_DATA || {};
      window.DASH_DATA[kind] = await response.json();
      renderFromEmbedded(el, footerState);
      if (el.footerLine) el.footerLine.textContent = buildFooterLine(footerState);
    } catch {}
  }
}

function makeCardLink(node, href) {
  if (!node) return;
  const go = () => (window.location.href = href);

  node.addEventListener("click", go);
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const isEink = document.body.classList.contains("eink");
  if (!isEink) initStageScale();

  const el = {
    greeting: $("greeting"),
    dateLine: $("dateLine"),
    clock: $("clock"),
    themeBtn: $("themeToggle"),

    wxIcon: $("wxIcon"),
    wxTemp: $("wxTemp"),
    wxDesc: $("wxDesc"),
    wxHi: $("wxHi"),
    wxLo: $("wxLo"),

    mktIcon: $("mktIcon"),
    spy: $("spy"),
    iau: $("iau"),

    wcIcon: $("wcIcon"),
    wcStrip: $("wcList"),

    trafficIcon: $("trafficIcon"),
    trafficList: $("trafficList"),

    footerLine: $("footerLine")
  };

  initTheme(el.themeBtn);
  initTopClock({ clockEl: el.clock, dateLineEl: el.dateLine, themeBtn: el.themeBtn });

  const tp = timeParts();
  if (el.greeting) el.greeting.textContent = `${greetingForHour24(tp.hour24)}, ${CFG.name}!`;

  if (el.mktIcon) el.mktIcon.innerHTML = iconChart();
  if (el.wcIcon) el.wcIcon.innerHTML = iconClock();
  if (el.trafficIcon) el.trafficIcon.innerHTML = iconRoad();

  renderWorldClockStrip(el.wcStrip);
  tickWorldClockStrip(el.wcStrip);

  const msToNextMinute = (60 - new Date().getSeconds()) * 1000 + 50;
  setTimeout(() => {
    tickWorldClockStrip(el.wcStrip);
    setInterval(() => tickWorldClockStrip(el.wcStrip), 60 * 1000);
  }, msToNextMinute);

  const footerState = {
    market: "",
    traffic: "",
    loaded: `Loaded ${tp.hour}:${tp.minute}`
  };

  renderFromCache(el, footerState);
  renderFromEmbedded(el, footerState);
  loadStaticFallbacks(el, footerState);
  afterPageLoad(() => refreshEmbeddedData(el, footerState));

  if (el.footerLine) el.footerLine.textContent = buildFooterLine(footerState);

  const base = isEink ? "../" : "./";
  makeCardLink($("weatherCard"), `${base}weather/`);
  makeCardLink($("marketsCard"), `${base}market/`);
  makeCardLink($("worldClockCard"), `${base}world-clock/`);

  // ✅ NEW: Traffic tile clickable
  makeCardLink($("trafficCard"), `${base}traffic/`);
});
