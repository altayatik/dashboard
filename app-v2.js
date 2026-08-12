const CONFIG = window.DASH_CONFIG || {};
const IS_LOCAL_PREVIEW = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const API_BASE = (IS_LOCAL_PREVIEW ? window.location.origin : (CONFIG.dataApiBase || "https://dashboard-data-api.vercel.app")).replace(/\/$/, "");
const TIMEZONE = CONFIG.timezone || "America/Chicago";
const NAME = CONFIG.name || "Altay";
const THEME_KEY = "altay_dashboard_theme";
const THEME_MODE_KEY = "altay_dashboard_theme_mode";
const TIME_KEY = "altay_dashboard_time_format";
const SNAPSHOT_KEY = "altay_dashboard_snapshot_v3";
const KEEP_AWAKE_KEY = "altay_dashboard_keep_awake";
const SUNNYDAY_SCORE_KEY = "sunnyday:score-bridge:v1";
const SUNNYDAY_URL = "https://altayatik.com/sunnyday/";
const THEMES = {
  daybreak: "Daybreak",
  afterdark: "After dark",
  weather: "Weather",
  eink: "E-ink"
};
const WORLD_CLOCKS = [
  { city: "Los Angeles", tz: "America/Los_Angeles" },
  { city: "New York", tz: "America/New_York" },
  { city: "London", tz: "Europe/London" },
  { city: "Istanbul", tz: "Europe/Istanbul" }
];
const DETAIL_CLOCKS = [
  ...WORLD_CLOCKS,
  { city: "Dubai", tz: "Asia/Dubai" },
  { city: "Tokyo", tz: "Asia/Tokyo" }
];
let currentSnapshot = null;
let hasRenderedSnapshot = false;
let themeMode = "auto";
let solarSchedule = null;
let screenWakeLock = null;
let wakeLockRequest = null;
let silkKeepAliveAudio = null;
let silkKeepAliveActive = false;

const $ = (id) => document.getElementById(id);
const number = (value) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const round = (value, fallback = "—") => number(value) == null ? fallback : Math.round(number(value));
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
})[char]);

function setWakeLockState(state, label) {
  const button = $("keepAwakeButton");
  if (!button) return;
  button.dataset.state = state;
  button.setAttribute("aria-pressed", String(state === "active"));
  button.setAttribute("aria-label", label);
  button.title = label;
  const text = button.querySelector(".keep-awake-label");
  if (text) text.textContent = state === "active" ? "AWAKE" : "DISPLAY";
}

function displayKeepAliveIsActive() {
  return Boolean((screenWakeLock && !screenWakeLock.released) || silkKeepAliveActive);
}

function updateDisplayKeepAliveState(fallback = "needs-action") {
  if (displayKeepAliveIsActive()) setWakeLockState("active", "Display keep-alive is active");
  else setWakeLockState(fallback, fallback === "unsupported" ? "Keep awake is unavailable in this browser" : "Tap to keep display awake");
}

async function requestScreenWakeLock() {
  if (!("wakeLock" in navigator)) {
    updateDisplayKeepAliveState("unsupported");
    return false;
  }
  if (document.visibilityState !== "visible") return false;
  if (screenWakeLock?.released) screenWakeLock = null;
  if (screenWakeLock) return true;
  if (wakeLockRequest) return wakeLockRequest;

  setWakeLockState("ready", "Requesting display wake lock");
  wakeLockRequest = navigator.wakeLock.request("screen").then((sentinel) => {
    screenWakeLock = sentinel;
    updateDisplayKeepAliveState();
    sentinel.addEventListener("release", () => {
      if (screenWakeLock === sentinel) screenWakeLock = null;
      updateDisplayKeepAliveState();
    });
    return true;
  }).catch(() => {
    updateDisplayKeepAliveState();
    return false;
  }).finally(() => {
    wakeLockRequest = null;
  });
  return wakeLockRequest;
}

function silentWavUrl(seconds = 12) {
  const sampleRate = 8000;
  const sampleCount = sampleRate * seconds;
  const buffer = new ArrayBuffer(44 + sampleCount);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + sampleCount, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  write(36, "data");
  view.setUint32(40, sampleCount, true);
  new Uint8Array(buffer, 44).fill(128);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

async function startSilkMediaKeepAlive() {
  if (!silkKeepAliveAudio) {
    silkKeepAliveAudio = document.createElement("audio");
    silkKeepAliveAudio.className = "silk-keep-alive";
    silkKeepAliveAudio.preload = "auto";
    silkKeepAliveAudio.playsInline = true;
    silkKeepAliveAudio.muted = true;
    silkKeepAliveAudio.src = silentWavUrl();
    silkKeepAliveAudio.addEventListener("playing", () => {
      silkKeepAliveActive = true;
      updateDisplayKeepAliveState();
    });
    silkKeepAliveAudio.addEventListener("pause", () => {
      silkKeepAliveActive = false;
      updateDisplayKeepAliveState();
    });
    silkKeepAliveAudio.addEventListener("ended", () => {
      silkKeepAliveActive = false;
      silkKeepAliveAudio.currentTime = 0;
      silkKeepAliveAudio.play().catch(() => updateDisplayKeepAliveState());
    });
    document.body.appendChild(silkKeepAliveAudio);
  }
  try {
    await silkKeepAliveAudio.play();
    return true;
  } catch {
    updateDisplayKeepAliveState();
    return false;
  }
}

function initScreenWakeLock() {
  const button = $("keepAwakeButton");
  if (!button) return;
  const isSilk = /\bSilk\//i.test(navigator.userAgent) || new URLSearchParams(window.location.search).get("display") === "echo";
  let enabled = isSilk || localStorage.getItem(KEEP_AWAKE_KEY) === "1";

  button.addEventListener("click", () => {
    enabled = true;
    localStorage.setItem(KEEP_AWAKE_KEY, "1");
    requestScreenWakeLock();
    if (isSilk) {
      silkKeepAliveAudio && (silkKeepAliveAudio.muted = false);
      startSilkMediaKeepAlive();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (enabled && document.visibilityState === "visible") {
      requestScreenWakeLock();
      if (isSilk) startSilkMediaKeepAlive();
    }
  });
  document.addEventListener("pointerdown", () => {
    if (!enabled) return;
    if (!screenWakeLock) requestScreenWakeLock();
    if (isSilk) {
      silkKeepAliveAudio && (silkKeepAliveAudio.muted = false);
      startSilkMediaKeepAlive();
    }
  }, { once: true, capture: true });
  window.setInterval(() => {
    if (enabled && document.visibilityState === "visible" && !screenWakeLock) requestScreenWakeLock();
    if (enabled && isSilk && document.visibilityState === "visible" && (!silkKeepAliveAudio || silkKeepAliveAudio.paused)) startSilkMediaKeepAlive();
  }, 60 * 1000);

  if (enabled) {
    requestScreenWakeLock();
    if (isSilk) startSilkMediaKeepAlive();
  }
  else if (!("wakeLock" in navigator)) setWakeLockState("unsupported", "Keep awake is unavailable in this browser");
}

function initBuildFreshness() {
  const currentBuild = document.documentElement.dataset.build;
  if (!currentBuild) return;
  const versionPath = document.body.classList.contains("is-eink-route") ? "../version.json" : "version.json";
  const check = async () => {
    try {
      const url = new URL(versionPath, window.location.href);
      url.searchParams.set("t", String(Date.now()));
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return;
      const latest = await response.json();
      if (!latest?.build || latest.build === currentBuild) return;
      const destination = new URL(window.location.href);
      destination.searchParams.set("build", latest.build);
      window.location.replace(destination);
    } catch {
      // The dashboard remains usable when the version check is offline.
    }
  };
  window.setInterval(check, 5 * 60 * 1000);
  check();
}

function weatherText(code) {
  if (code === 0) return "Clear sky";
  if (code <= 2) return "Mostly clear";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 67) return "Rain moving through";
  if (code >= 71 && code <= 77) return "Snow in the air";
  if (code >= 80 && code <= 82) return "Passing showers";
  if (code >= 95) return "Thunderstorms";
  return "Mixed conditions";
}

function weatherGlyph(code, isDay = true) {
  if (code === 0 || code === 1) return isDay ? "☀" : "◐";
  if (code <= 3) return "☁";
  if (code === 45 || code === 48) return "≋";
  if (code >= 51 && code <= 67) return "☂";
  if (code >= 71 && code <= 77) return "✳";
  if (code >= 80 && code <= 82) return "☂";
  if (code >= 95) return "ϟ";
  return "○";
}

function weatherKind(code, isDay = true) {
  if ((code === 0 || code === 1) && isDay) return "sun";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 95) return "storm";
  return "cloud";
}

function dateParts(date = new Date(), timezone = TIMEZONE) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function timeStringMinutes(value) {
  const match = String(value || "").match(/T(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function automaticThemeForNow() {
  const parts = dateParts();
  const nowMinutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  const sunrise = timeStringMinutes(solarSchedule?.sunrise) ?? 7 * 60;
  const sunset = timeStringMinutes(solarSchedule?.sunset) ?? 20 * 60;
  return nowMinutes < sunrise || nowMinutes >= sunset ? "afterdark" : "daybreak";
}

function updateAutomaticTheme() {
  if (themeMode !== "auto" || document.body.classList.contains("is-eink-route")) return;
  const next = automaticThemeForNow();
  if (document.documentElement.dataset.theme !== next) setTheme(next, false);
  $("themeButtonLabel").textContent = next === "afterdark" ? "Auto · Night" : "Auto · Day";
}

function tickClock() {
  const parts = dateParts();
  const hour = Number(parts.hour) % 24;
  $("dateEyebrow").textContent = `${parts.weekday.toUpperCase()} · ${parts.month.toUpperCase()} ${parts.day}`;
  $("localTime").textContent = `${parts.hour}:${parts.minute}`;
  $("localSeconds").textContent = parts.second;
  $("greeting").textContent = `${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 21 ? "Good evening" : "Good night"}, ${NAME}.`;
  renderWorldClocks();
  updateAutomaticTheme();
}

let use24Hour = localStorage.getItem(TIME_KEY) !== "12";
function renderWorldClocks() {
  const now = new Date();
  const homeDay = dateParts(now).day;
  $("clockList").innerHTML = WORLD_CLOCKS.map(({ city, tz }) => {
    const parts = dateParts(now, tz);
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: !use24Hour
    }).format(now);
    const offset = Number(parts.day) < Number(homeDay) ? "Yesterday" : Number(parts.day) > Number(homeDay) ? "Tomorrow" : "Today";
    return `<div class="clock-row"><p>${esc(city)}<span>${offset} · ${parts.weekday.slice(0, 3)}</span></p><time datetime="${parts.hour}:${parts.minute}">${esc(time)}</time></div>`;
  }).join("");
  $("timeFormatButton").textContent = use24Hour ? "24H" : "12H";
}

function lineGeometry(values, width, height, pad = 5) {
  const clean = values.map(number).filter((value) => value != null);
  if (clean.length < 2) return null;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const points = clean.map((value, index) => {
    const x = pad + (index / (clean.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return { x, y };
  });
  const curve = points.reduce((path, point, index) => {
    if (index === 0) return `M${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    const previous = points[index - 1];
    const beforePrevious = points[index - 2] || previous;
    const next = points[index + 1] || point;
    const control1 = {
      x: previous.x + (point.x - beforePrevious.x) / 6,
      y: previous.y + (point.y - beforePrevious.y) / 6
    };
    const control2 = {
      x: point.x - (next.x - previous.x) / 6,
      y: point.y - (next.y - previous.y) / 6
    };
    return `${path} C${control1.x.toFixed(2)},${control1.y.toFixed(2)} ${control2.x.toFixed(2)},${control2.y.toFixed(2)} ${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }, "");
  const baseline = height - pad;
  return {
    min,
    max,
    points,
    curve,
    polyline: points.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" "),
    area: `M${points[0].x.toFixed(2)},${baseline} L${points[0].x.toFixed(2)},${points[0].y.toFixed(2)} ${curve.slice(curve.indexOf(" C"))} L${points.at(-1).x.toFixed(2)},${baseline} Z`
  };
}

function renderWeatherChart(hourly) {
  const samples = (hourly?.time || []).map((time, index) => ({
    time,
    value: number(hourly?.temperature_2m?.[index])
  })).filter((sample) => sample.value != null).slice(0, 12);
  const values = samples.map((sample) => sample.value);
  const times = samples.map((sample) => sample.time);
  const geometry = lineGeometry(values, 560, 118, 8);
  if (!geometry) {
    $("weatherChart").innerHTML = '<p class="panel-note">Hourly trend unavailable.</p>';
    $("weatherTimes").innerHTML = "";
    return;
  }
  const dots = geometry.points.filter((_, index) => index === 0 || index === geometry.points.length - 1)
    .map(({ x, y }) => `<circle class="chart-dot" cx="${x}" cy="${y}" r="4"></circle>`).join("");
  $("weatherChart").innerHTML = `
    <svg viewBox="0 0 560 118" preserveAspectRatio="none" role="img" aria-label="Temperatures from ${Math.round(geometry.min)} to ${Math.round(geometry.max)} degrees">
      <defs><linearGradient id="weatherArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      <path class="chart-guide" d="M8 8H552 M8 59H552 M8 110H552"></path>
      <path class="chart-area" d="${geometry.area}"></path>
      <path class="chart-line" d="${geometry.curve}"></path>${dots}
    </svg>`;
  $("weatherRange").textContent = `${Math.round(geometry.max)}° HIGH · ${Math.round(geometry.min)}° LOW`;
  const shown = times.filter((_, index) => index % 2 === 0).slice(0, 6);
  $("weatherTimes").innerHTML = shown.map((time) => {
    const label = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: TIMEZONE }).format(new Date(time));
    return `<span>${esc(label)}</span>`;
  }).join("");
}

function renderWeather(weather) {
  const current = weather?.current || {};
  const daily = weather?.daily || {};
  const code = number(current.weather_code) ?? 3;
  solarSchedule = {
    sunrise: daily.sunrise?.[0] || null,
    sunset: daily.sunset?.[0] || null
  };
  document.documentElement.dataset.weather = weatherKind(code, current.is_day !== 0);
  $("locationLabel").textContent = weather?.location?.label === "Default" ? "Chicago, IL" : (weather?.location?.label || "Chicago, IL");
  $("weatherGlyph").textContent = weatherGlyph(code, current.is_day !== 0);
  $("weatherSummary").textContent = weatherText(code);
  $("temperature").textContent = round(current.temperature_2m);
  $("feelsLike").textContent = `${round(current.apparent_temperature)}°`;
  $("highTemp").textContent = `${round(daily.temperature_2m_max?.[0])}°`;
  $("lowTemp").textContent = `${round(daily.temperature_2m_min?.[0])}°`;
  $("humidity").textContent = `${round(current.relative_humidity_2m)}%`;
  $("wind").textContent = `${round(current.wind_speed_10m)} mph`;
  $("rainChance").textContent = `${round(daily.precipitation_probability_max?.[0])}%`;
  $("pressure").textContent = `${round(current.pressure_msl)} hPa`;
  $("weatherStatus").textContent = weather.stale ? "CACHED" : "LIVE";
  renderWeatherChart(weather.hourly);
  renderForecast(daily);
  updateAutomaticTheme();
  document.querySelector(".weather-panel")?.classList.remove("is-loading");
}

function renderForecast(daily) {
  const dates = daily?.time || [];
  const highs = daily?.temperature_2m_max || [];
  const lows = daily?.temperature_2m_min || [];
  const codes = daily?.weather_code || [];
  const rain = daily?.precipitation_probability_max || [];
  const days = dates.slice(1, 6);
  if (!days.length) {
    $("forecastDays").innerHTML = '<p class="panel-note">Forecast unavailable.</p>';
    return;
  }
  $("forecastDays").innerHTML = days.map((date, offset) => {
    const index = offset + 1;
    const day = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)).toUpperCase();
    return `<div class="forecast-day">
      <span>${day}</span><div class="forecast-icon" title="${esc(weatherText(codes[index]))}">${weatherGlyph(codes[index])}</div>
      <div><div class="forecast-temp"><span>${round(highs[index])}°</span><span>${round(lows[index])}°</span></div><div class="precip">${round(rain[index], 0)}% rain</div></div>
    </div>`;
  }).join("");
  const dryDays = rain.slice(1, 6).filter((chance) => number(chance) != null && number(chance) < 25).length;
  $("forecastNarrative").textContent = dryDays >= 4 ? "Mostly dry, with room to make plans." : dryDays >= 2 ? "A mixed week. Keep one eye on the sky." : "An umbrella-forward kind of week.";
  document.querySelector(".forecast-panel")?.classList.remove("is-loading");
}

function money(value) {
  const n = number(value);
  return n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(value) {
  const n = number(value);
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function marketSeries(symbolData, fallbackHistory) {
  const history = symbolData?.history || fallbackHistory || [];
  return history.map((point) => number(point?.close ?? point)).filter((point) => point != null);
}

function renderMarkets(markets) {
  const symbols = markets?.symbols || {};
  const spy = symbols.SPY || {};
  const spyHistory = marketSeries(spy, markets?.history?.SPY);
  $("spyPrice").textContent = money(spy.price ?? spyHistory.at(-1));
  const spyChange = number(spy.percent_change) ?? (spyHistory.length > 1 ? ((spyHistory.at(-1) - spyHistory.at(-2)) / spyHistory.at(-2)) * 100 : null);
  $("spyDelta").textContent = `${percent(spyChange)} today`;
  $("spyDelta").className = `delta ${spyChange > 0 ? "positive" : spyChange < 0 ? "negative" : ""}`;

  const geometry = lineGeometry(spyHistory, 180, 60, 3);
  $("spyChart").innerHTML = geometry ? `<svg viewBox="0 0 180 60" preserveAspectRatio="none" role="img" aria-label="SPY recent price trend"><path class="market-area" d="${geometry.area}"></path><polyline class="market-line" points="${geometry.polyline}"></polyline></svg>` : "";

  $("tickerList").innerHTML = ["QQQ", "IAU", "SLV"].map((symbol) => {
    const item = symbols[symbol] || {};
    const series = marketSeries(item, markets?.history?.[symbol]);
    const change = number(item.percent_change) ?? (series.length > 1 ? ((series.at(-1) - series.at(-2)) / series.at(-2)) * 100 : null);
    return `<div class="ticker-row"><span>${symbol}</span><b>${money(item.price ?? series.at(-1))}</b><em class="${change > 0 ? "positive" : change < 0 ? "negative" : ""}">${percent(change)}</em></div>`;
  }).join("");
  $("marketState").textContent = markets?.in_hours === true ? "MARKET OPEN" : markets?.stale ? "LAST CLOSE" : "MARKET CLOSED";
  $("marketNote").textContent = markets?.stale ? "Showing the latest verified close while the live feed recovers." : "Quotes may be delayed. Five-day movement is shown for context.";
  document.querySelector(".market-panel")?.classList.remove("is-loading");
}

function trafficFill(status) {
  return { light: 32, medium: 58, heavy: 78, severe: 96 }[String(status || "").toLowerCase()] || 22;
}

function renderTraffic(traffic) {
  const routes = Array.isArray(traffic?.routes) ? traffic.routes.slice(0, 3) : [];
  if (routes.length) {
    $("routeList").innerHTML = routes.map((route) => {
      const level = String(route.status || "unknown").toLowerCase();
      const detail = number(route.delay_min) != null ? `+${round(route.delay_min)} min` : (route.status || "—");
      return `<div class="route" data-level="${esc(level)}"><span>${esc(route.label || route.id)}</span><div class="route-track"><i style="--fill:${trafficFill(level)}%"></i></div><strong>${esc(detail)}</strong></div>`;
    }).join("");
  }
  const reversible = routes.find((route) => route.id === "I90_94")?.reversible_lanes;
  $("reversibleLanes").innerHTML = `<span>↔</span><p><small>KENNEDY REVERSIBLES</small><strong>${esc(reversible?.label || "Direction unavailable")}</strong></p>`;
  if (traffic?.updated_iso) {
    $("trafficUpdated").textContent = `AS OF ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE }).format(new Date(traffic.updated_iso))}`;
  }
  document.querySelector(".commute-panel")?.classList.remove("is-loading");
}

const FALLBACK = {
  weather: {
    stale: true,
    location: { label: "Chicago, IL" },
    current: { temperature_2m: 72, apparent_temperature: 73, relative_humidity_2m: 66, weather_code: 2, wind_speed_10m: 9, pressure_msl: 1013 },
    daily: { time: ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01"], weather_code: [2, 1, 2, 61, 1, 2], temperature_2m_max: [78, 81, 83, 76, 80, 82], temperature_2m_min: [65, 64, 67, 63, 62, 66], precipitation_probability_max: [12, 8, 18, 61, 10, 20] },
    hourly: { time: Array.from({ length: 12 }, (_, index) => new Date(Date.now() + index * 3600000).toISOString()), temperature_2m: [72, 73, 75, 77, 78, 78, 76, 74, 71, 69, 68, 67] }
  },
  markets: { stale: true, in_hours: false, symbols: {} },
  traffic: { stale: true, routes: [] }
};

async function getJson(url, timeout = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function loadDataScript(kind, timeout = 7000) {
  return new Promise((resolve, reject) => {
    window.DASH_DATA = window.DASH_DATA || {};
    delete window.DASH_DATA[kind];

    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      script.remove();
      console.warn(`[dashboard] ${kind} data request timed out`);
      reject(new Error(`${kind} request timed out`));
    }, timeout);

    script.src = `${API_BASE}/api/${kind}?format=script&v=${Date.now()}`;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      script.remove();
      const payload = window.DASH_DATA?.[kind];
      if (payload) resolve(payload);
      else {
        console.warn(`[dashboard] ${kind} script loaded without a payload`);
        reject(new Error(`${kind} returned no data`));
      }
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      script.remove();
      console.warn(`[dashboard] ${kind} data script failed to load`);
      reject(new Error(`${kind} request failed`));
    };
    document.head.appendChild(script);
  });
}

function readCachedSnapshot() {
  try {
    const cached = JSON.parse(localStorage.getItem(SNAPSHOT_KEY));
    return cached?.weather || cached?.markets || cached?.traffic ? cached : null;
  } catch {
    return null;
  }
}

function saveSnapshot(snapshot) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {}
}

function renderSnapshot(snapshot, { cached = false } = {}) {
  const next = {
    updated_iso: snapshot?.updated_iso || new Date().toISOString(),
    weather: snapshot?.weather || currentSnapshot?.weather || FALLBACK.weather,
    markets: snapshot?.markets || currentSnapshot?.markets || FALLBACK.markets,
    traffic: snapshot?.traffic || currentSnapshot?.traffic || FALLBACK.traffic,
    partial: Boolean(snapshot?.partial)
  };
  currentSnapshot = next;
  renderWeather(next.weather);
  renderMarkets(next.markets);
  renderTraffic(next.traffic);
  hasRenderedSnapshot = true;

  const now = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE }).format(new Date());
  $("lastSync").textContent = `${cached ? "Updating" : next.partial ? "Partial signal" : "Synced"} · ${now}`;
  $("dataHealth").textContent = cached
    ? "Showing the latest reading · refreshing quietly"
    : next.partial
      ? "Some sources are using their last good reading"
      : "All dashboard sources connected";
}

let activeRefresh = null;
async function refreshDashboard({ manual = false, background = false } = {}) {
  if (activeRefresh) return activeRefresh;
  const button = $("refreshButton");
  if (manual) button.classList.add("is-spinning");
  if (!hasRenderedSnapshot && !background) {
    document.querySelectorAll(".weather-panel, .market-panel, .commute-panel, .forecast-panel")
      .forEach((panel) => panel.classList.add("is-loading"));
    $("lastSync").textContent = "Connecting live sources…";
  } else if (manual) {
    $("lastSync").textContent = "Refreshing quietly…";
  }

  activeRefresh = (async () => {
    let snapshot;
    try {
      snapshot = await getJson(`${API_BASE}/api/dashboard`, 9000);
    } catch {
      const results = await Promise.allSettled([
        loadDataScript("weather", 7000),
        loadDataScript("markets", 10000),
        loadDataScript("traffic", 7000)
      ]);
      snapshot = {
        weather: results[0].status === "fulfilled" ? results[0].value : null,
        markets: results[1].status === "fulfilled" ? results[1].value : null,
        traffic: results[2].status === "fulfilled" ? results[2].value : null,
        partial: results.some((result) => result.status === "rejected")
      };
    }

    renderSnapshot(snapshot);
    saveSnapshot(currentSnapshot);
  })().catch((error) => {
    console.warn("[dashboard] background refresh failed", error);
    if (!hasRenderedSnapshot) renderSnapshot(FALLBACK, { cached: true });
    $("dataHealth").textContent = "Live refresh paused · showing the latest reading";
  }).finally(() => {
    button.classList.remove("is-spinning");
    activeRefresh = null;
  });

  return activeRefresh;
}

function detailSparkline(values) {
  const geometry = lineGeometry(values, 260, 46, 3);
  if (!geometry) return "";
  return `<svg viewBox="0 0 260 46" preserveAspectRatio="none" aria-hidden="true"><path class="market-area" d="${geometry.area}"></path><polyline class="market-line" points="${geometry.polyline}"></polyline></svg>`;
}

function detailWeather(weather) {
  const current = weather?.current || {};
  const hourly = weather?.hourly || {};
  const daily = weather?.daily || {};
  const hours = (hourly.time || []).slice(0, 6).map((time, index) => {
    const label = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: TIMEZONE }).format(new Date(time));
    const code = hourly.weather_code?.[index] ?? current.weather_code;
    return `<div class="detail-hour"><time>${esc(label)}</time><b>${weatherGlyph(code)} ${round(hourly.temperature_2m?.[index])}°</b><span>${round(hourly.precipitation_probability?.[index], 0)}% rain</span></div>`;
  }).join("");
  const days = (daily.time || []).slice(0, 7).map((date, index) => {
    const label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
    return `<div class="detail-day"><span>${label.toUpperCase()}</span><i>${weatherGlyph(daily.weather_code?.[index])}</i><b>${round(daily.temperature_2m_max?.[index])}° · ${round(daily.temperature_2m_min?.[index])}°</b></div>`;
  }).join("");
  return `<div class="detail-hero">
    <div>
      <p class="detail-lead">${esc(weatherText(current.weather_code))} in ${esc(weather?.location?.label === "Default" ? "Chicago" : weather?.location?.label || "Chicago")}</p>
      <div class="detail-big-number">${round(current.temperature_2m)}°</div>
      <div class="detail-metrics">
        <div class="detail-metric"><span>FEELS LIKE</span><strong>${round(current.apparent_temperature)}°</strong></div>
        <div class="detail-metric"><span>HUMIDITY</span><strong>${round(current.relative_humidity_2m)}%</strong></div>
        <div class="detail-metric"><span>WIND</span><strong>${round(current.wind_speed_10m)} mph</strong></div>
        <div class="detail-metric"><span>PRESSURE</span><strong>${round(current.pressure_msl)} hPa</strong></div>
      </div>
    </div>
    <div>
      <p class="detail-section-title">NEXT SIX HOURS</p>
      <div class="detail-hour-grid">${hours}</div>
      <div class="detail-day-grid">${days}</div>
    </div>
  </div>`;
}

function detailMarkets(markets) {
  const symbols = markets?.symbols || {};
  return `<div class="detail-list">${["SPY", "QQQ", "IAU", "SLV"].map((symbol) => {
    const item = symbols[symbol] || {};
    const series = marketSeries(item, markets?.history?.[symbol]);
    const change = number(item.percent_change) ?? (series.length > 1 ? ((series.at(-1) - series.at(-2)) / series.at(-2)) * 100 : null);
    return `<div class="detail-tile">
      <div><small>${symbol === "SPY" ? "S&P 500 ETF" : symbol === "QQQ" ? "NASDAQ 100 ETF" : symbol === "IAU" ? "GOLD TRUST" : "SILVER TRUST"}</small><h3>${symbol}</h3><em class="${change > 0 ? "positive" : change < 0 ? "negative" : ""}">${percent(change)} today</em></div>
      <strong>${money(item.price ?? series.at(-1))}</strong>
      <div class="detail-spark">${detailSparkline(series)}</div>
    </div>`;
  }).join("")}</div>`;
}

function detailTraffic(traffic) {
  const routes = Array.isArray(traffic?.routes) ? traffic.routes : [];
  const reversible = routes.find((route) => route.id === "I90_94")?.reversible_lanes;
  return `<div class="traffic-detail-list">${routes.slice(0, 3).map((route) => `
    <div class="traffic-detail-card">
      <span>${esc(route.status || "Traffic")}</span>
      <h3>${esc(route.label || route.id)}</h3>
      <strong>+${round(route.delay_min, 0)} min</strong>
      <span>estimated traffic delay</span>
    </div>`).join("")}</div>
    <div class="detail-metrics">
      <div class="detail-metric"><span>KENNEDY REVERSIBLES</span><strong>${esc(reversible?.label || "Direction unavailable")}</strong></div>
      <div class="detail-metric"><span>LAST READING</span><strong>${traffic?.updated_iso ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE }).format(new Date(traffic.updated_iso)) : "—"}</strong></div>
    </div>`;
}

function detailWorld() {
  const now = new Date();
  return `<div class="world-detail-grid">${DETAIL_CLOCKS.map(({ city, tz }) => {
    const parts = dateParts(now, tz);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: !use24Hour }).format(now);
    return `<div class="detail-tile"><div><small>${parts.weekday.toUpperCase()} · ${parts.month.toUpperCase()} ${parts.day}</small><h3>${esc(city)}</h3></div><time>${esc(time)}</time></div>`;
  }).join("")}</div>`;
}

function detailForecast(daily) {
  const days = (daily?.time || []).slice(0, 7).map((date, index) => {
    const label = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
    return `<div class="detail-day"><span>${label.toUpperCase()}</span><i>${weatherGlyph(daily.weather_code?.[index])}</i><b>${round(daily.temperature_2m_max?.[index])}° · ${round(daily.temperature_2m_min?.[index])}°</b><span>${round(daily.precipitation_probability_max?.[index], 0)}% rain</span></div>`;
  }).join("");
  return `<p class="detail-lead">Seven days at a glance. Highs are shown first.</p><div class="detail-day-grid">${days}</div>`;
}

function openDetail(kind) {
  const dialog = $("detailDialog");
  if (!dialog || !currentSnapshot) return;
  const views = {
    weather: { kicker: "CHICAGO WEATHER", title: weatherText(currentSnapshot.weather?.current?.weather_code), html: detailWeather(currentSnapshot.weather) },
    markets: { kicker: "MARKET PULSE", title: "Selected signals", html: detailMarkets(currentSnapshot.markets) },
    traffic: { kicker: "CHICAGO TRAFFIC", title: "Road conditions", html: detailTraffic(currentSnapshot.traffic) },
    world: { kicker: "WORLD WINDOWS", title: "Six cities, right now", html: detailWorld() },
    forecast: { kicker: "THE WEEK AHEAD", title: "Seven-day forecast", html: detailForecast(currentSnapshot.weather?.daily) }
  };
  const view = views[kind];
  if (!view) return;
  $("dialogKicker").textContent = view.kicker;
  $("dialogTitle").textContent = view.title;
  $("dialogContent").innerHTML = view.html;
  dialog.showModal();
}

function initDetailPanels() {
  const dialog = $("detailDialog");
  if (!dialog) return;
  document.addEventListener("click", (event) => {
    const panel = event.target.closest("[data-detail]");
    if (!panel || event.target.closest("button, a, form")) return;
    if (panel.dataset.detail === "weather") {
      window.location.assign(SUNNYDAY_URL);
      return;
    }
    if (panel.classList.contains("is-loading")) return;
    openDetail(panel.dataset.detail);
  });
  document.addEventListener("keydown", (event) => {
    const panel = event.target.closest("[data-detail]");
    if (!panel || panel !== event.target || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    if (panel.dataset.detail === "weather") {
      window.location.assign(SUNNYDAY_URL);
      return;
    }
    if (panel.classList.contains("is-loading")) return;
    openDetail(panel.dataset.detail);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function renderSunnyDayScore(payload) {
  const score = number(payload?.score);
  if (!$("sunnyDayScore") || score == null || score < 0 || score > 100) return;
  $("sunnyDayScoreValue").textContent = String(Math.round(score));
  $("sunnyDayScoreLabel").textContent = String(payload?.label || "SUNNYDAY").toUpperCase();
  $("sunnyDayScore")?.classList.add("is-ready");
}

function initSunnyDayScore() {
  if (!$("sunnyDayScore")) return;
  try {
    const cached = JSON.parse(localStorage.getItem(SUNNYDAY_SCORE_KEY) || "null");
    if (cached?.type === "sunnyday:score") renderSunnyDayScore(cached);
  } catch {
    // The live score bridge will replace a missing or invalid cached value.
  }
  const bridgeOrigin = new URL($("sunnyDayBridge")?.src || SUNNYDAY_URL).origin;
  window.addEventListener("message", (event) => {
    if (event.origin !== bridgeOrigin || event.data?.type !== "sunnyday:score") return;
    renderSunnyDayScore(event.data);
  });
}

function initMobileTabs() {
  const tabs = $("mobileTabs");
  const grid = document.querySelector(".dashboard-grid");
  if (!tabs || !grid) return;
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mobile-view-value]");
    if (!button) return;
    const view = button.dataset.mobileViewValue;
    grid.dataset.mobileView = view;
    tabs.querySelectorAll("[data-mobile-view-value]").forEach((item) => {
      item.setAttribute("aria-selected", String(item === button));
    });
  });
}

function setTheme(theme, persist = true) {
  const migratedTheme = theme === "field" ? "weather" : theme;
  const safeTheme = THEMES[migratedTheme] ? migratedTheme : "daybreak";
  document.documentElement.dataset.theme = safeTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
  $("themeButtonLabel").textContent = THEMES[safeTheme];
  if (persist && !document.body.classList.contains("is-eink-route")) localStorage.setItem(THEME_KEY, safeTheme);
}

function initThemeMenu() {
  const menu = $("themeMenu");
  const button = $("themeButton");
  button.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  menu.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-theme-value]");
    if (!choice) return;
    if (choice.dataset.themeValue === "auto") {
      themeMode = "auto";
      localStorage.setItem(THEME_MODE_KEY, "auto");
      updateAutomaticTheme();
    } else {
      themeMode = "fixed";
      localStorage.setItem(THEME_MODE_KEY, "fixed");
      setTheme(choice.dataset.themeValue);
    }
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".theme-control")) {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const forcedEink = document.body.classList.contains("is-eink-route");
  themeMode = forcedEink ? "fixed" : (localStorage.getItem(THEME_MODE_KEY) || "auto");
  if (forcedEink) setTheme("eink", false);
  else if (themeMode === "auto") updateAutomaticTheme();
  else setTheme(localStorage.getItem(THEME_KEY) || "daybreak", false);
  initThemeMenu();
  initSunnyDayScore();
  initDetailPanels();
  initMobileTabs();
  initScreenWakeLock();
  initBuildFreshness();
  tickClock();
  setInterval(tickClock, 1000);
  $("timeFormatButton").addEventListener("click", () => {
    use24Hour = !use24Hour;
    localStorage.setItem(TIME_KEY, use24Hour ? "24" : "12");
    renderWorldClocks();
  });
  $("refreshButton").addEventListener("click", () => refreshDashboard({ manual: true }));
  const preloaded = window.__PRELOADED_DASHBOARD__ || readCachedSnapshot();
  if (preloaded) {
    renderSnapshot(preloaded, { cached: true });
    saveSnapshot(currentSnapshot);
  }
  refreshDashboard({ background: Boolean(preloaded) });
  setInterval(() => refreshDashboard({ background: true }), 5 * 60 * 1000);
});
