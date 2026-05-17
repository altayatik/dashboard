import { initStageScale, initTheme, initTopClock, initBack, $, CFG, timeParts } from "../shared/core.js";
import { iconChart } from "../shared/icons.js";

const API_BASE = "https://dashboard-data-api.vercel.app/api/markets";
const LS_MARKET_DETAIL = "dash_markets_detail_v1";
const LS_MARKET_HOME = "dash_markets_embedded_v1";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SCRIPT_TIMEOUT_MS = 7000;

const SYMBOLS = ["SPY", "QQQ", "IAU", "SLV"];

function afterPageLoad(fn) {
  const run = () => window.setTimeout(fn, 0);
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
}

function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Number(n).toFixed(2)}%`;
}

function sparklineSVG(values) {
  const v = (values || []).map(Number).filter(Number.isFinite);
  if (v.length < 2) return `<svg viewBox="0 0 100 28" aria-hidden="true"></svg>`;

  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = (max - min) || 1;

  const pts = v.map((val, i) => {
    const x = (i / (v.length - 1)) * 100;
    const y = 26 - ((val - min) / span) * 22; // 2..24-ish
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  return `
  <svg viewBox="0 0 100 28" aria-hidden="true">
    <path class="sparkBase" d="M0 26H100"></path>
    <polyline class="sparkLine" points="${pts}"></polyline>
  </svg>`;
}

// Expected (flexible) data shapes from your API:
// - markets.symbols[SYM].price
// - markets.symbols[SYM].history = [{date, close}, ...] OR markets.history[SYM] = [...]
function normalizeMarkets(raw) {
  const out = { updated: null, in_hours: null, symbols: {} };
  if (!raw) return out;

  out.updated = raw.updated_local || raw.updated_iso || raw.updated || null;
  out.in_hours = (raw.in_hours === true || raw.in_hours === false) ? raw.in_hours : null;

  const symObj = raw.symbols || {};
  for (const sym of SYMBOLS) {
    const s = symObj[sym] || {};
    const hist =
      Array.isArray(s.history) ? s.history :
      (raw.history && Array.isArray(raw.history[sym])) ? raw.history[sym] :
      [];

    const closes = hist.map(d => Number(d.close)).filter(Number.isFinite);
    const last = Number.isFinite(Number(s.price)) ? Number(s.price) : (closes.length ? closes[closes.length - 1] : null);

    const d1 = closes.length >= 2 ? ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100 : null;
    const d5 = closes.length >= 2 ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : null;

    out.symbols[sym] = {
      price: last,
      history: hist.slice(0, 5),
      closes,
      d1,
      d5,
      min: closes.length ? Math.min(...closes) : null,
      max: closes.length ? Math.max(...closes) : null
    };
  }

  return out;
}

function renderGrid(gridEl, data) {
  gridEl.innerHTML = "";

  for (const sym of SYMBOLS) {
    const s = data.symbols[sym] || {};
    const rows = (s.history || []).map(d => `
      <div class="mktRow">
        <div class="mktDate">${String(d.date ?? "").slice(5) || "—"}</div>
        <div class="mktClose">${fmtMoney(d.close)}</div>
      </div>
    `).join("");

    const block = document.createElement("div");
    block.className = "mktBlock";
    block.innerHTML = `
      <div class="mktHead">
        <div class="mktSym">${sym}</div>
        <div class="mktNow">${fmtMoney(s.price)}</div>
      </div>

      <div class="mktSub">
        <div class="mktDelta">
          <div><span class="k">1D</span> <span class="v">${fmtPct(s.d1)}</span></div>
          <div><span class="k">5D</span> <span class="v">${fmtPct(s.d5)}</span></div>
        </div>
        <div class="tiny muted">${fmtMoney(s.min)} – ${fmtMoney(s.max)}</div>
      </div>

      <div class="mktSpark">${sparklineSVG(s.closes)}</div>

      <div class="mktTable">
        <div class="mktRow mktRowHead">
          <div>Date</div>
          <div>Close</div>
        </div>
        ${rows || `<div class="tiny muted">No history</div>`}
      </div>
    `;
    gridEl.appendChild(block);
  }
}

function loadMarketsScript() {
  return new Promise((resolve, reject) => {
    window.DASH_DATA = window.DASH_DATA || {};
    delete window.DASH_DATA.markets;

    const s = document.createElement("script");
    const timer = window.setTimeout(() => {
      s.remove();
      reject(new Error("Markets request timed out"));
    }, SCRIPT_TIMEOUT_MS);

    // if your API supports params, keep them; otherwise it will ignore them safely
    s.src = `${API_BASE}?symbols=${encodeURIComponent(SYMBOLS.join(","))}&days=5`;
    s.async = true;

    s.onload = () => {
      window.clearTimeout(timer);
      resolve(window.DASH_DATA.markets);
    };
    s.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("Failed to load markets script"));
    };
    document.head.appendChild(s);
  });
}

function getCached() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_MARKET_DETAIL));
    if (!c?.savedAt) return null;
    if ((Date.now() - c.savedAt) > CACHE_TTL_MS) return null;
    return c.payload || null;
  } catch {
    return null;
  }
}

function setCached(payload) {
  try {
    localStorage.setItem(LS_MARKET_DETAIL, JSON.stringify({ savedAt: Date.now(), payload }));
  } catch {}
}

function getHomeCached() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_MARKET_HOME));
    return c?.symbols ? c : null;
  } catch {
    return null;
  }
}

async function getStaticFallback() {
  try {
    const r = await fetch("../data/markets.json", { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initStageScale();

  const el = {
    dateLine: $("dateLine"),
    clock: $("clock"),
    themeBtn: $("themeToggle"),

    backBtn: $("backBtn"),
    mktIcon: $("mktIcon"),
    mktStatus: $("mktStatus"),
    mktUpdated: $("mktUpdated"),
    mktGrid: $("mktGrid"),
    loaded: $("loaded")
  };

  initTheme(el.themeBtn);
  initTopClock({ clockEl: el.clock, dateLineEl: el.dateLine, themeBtn: el.themeBtn });
  initBack(el.backBtn, "../");

  el.mktIcon.innerHTML = iconChart();

  const tp = timeParts();
  el.loaded.textContent = `Loaded ${tp.hour}:${tp.minute}`;

  // Fast paint from cache
  const cached = getCached();
  if (cached) {
    const norm = normalizeMarkets(cached);
    renderGrid(el.mktGrid, norm);
    el.mktUpdated.textContent = `Updated ${norm.updated || "cached"}`;
    el.mktStatus.textContent = norm.in_hours === false ? "Market closed (cached snapshot)" : "Cached snapshot";
    return;
  }

  const fallback = getHomeCached() || await getStaticFallback();
  if (fallback) {
    const norm = normalizeMarkets(fallback);
    renderGrid(el.mktGrid, norm);
    el.mktUpdated.textContent = `Updated ${norm.updated || "offline snapshot"}`;
    el.mktStatus.textContent = "Refreshing…";
  }

  afterPageLoad(async () => {
    // Backend KV caching should prevent API abuse; defer so page load finishes first.
    try {
      if (!fallback) el.mktStatus.textContent = "Loading…";
      const raw = await loadMarketsScript();
      setCached(raw);

      const norm = normalizeMarkets(raw);
      renderGrid(el.mktGrid, norm);

      el.mktUpdated.textContent = `Updated ${norm.updated || "—"}`;
      el.mktStatus.textContent =
        norm.in_hours === true ? "Market open" :
        norm.in_hours === false ? "Market closed" :
        "Snapshot";
    } catch (err) {
      if (fallback) {
        const norm = normalizeMarkets(fallback);
        renderGrid(el.mktGrid, norm);
        el.mktStatus.textContent = "Offline snapshot";
        el.mktUpdated.textContent = `Updated ${norm.updated || String(err?.message || err)}`;
        return;
      }

      el.mktStatus.textContent = "Markets unavailable";
      el.mktUpdated.textContent = String(err?.message || err);
    }
  });
});
