let detailChart = null;
let assetData   = null;
let activeTf    = "1d";

const ticker = new URLSearchParams(window.location.search).get("ticker") || "spx";

// ── Crosshair plugin ──────────────────────────────────────────────────────────

const crosshairPlugin = {
  id: "crosshair",
  afterDatasetsDraw(chart) {
    if (chart._crosshairX == null) return;
    const { ctx, chartArea: { top, bottom } } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(chart._crosshairX, top);
    ctx.lineTo(chart._crosshairX, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#475569";
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.restore();
  },
  afterEvent(chart, args) {
    const { event } = args;
    const x = event.type === "mousemove" ? event.x : null;
    if (chart._crosshairX !== x) {
      chart._crosshairX = x;
      args.changed = true;
    }
  },
};

Chart.register(crosshairPlugin);

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtPrice(price, unit) {
  if (price == null) return "—";
  if (unit === "pts") {
    return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (price >= 1000) {
    return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return "$" + price.toFixed(2);
}

function fmtVolume(n) {
  if (!n) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-US");
}

function fmtAxisLabel(ts, tf) {
  const d = new Date(ts);
  if (tf === "1d") {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }
  if (tf === "7d" || tf === "30d" || tf === "3m") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function fmtTooltipTitle(ts, tf) {
  const d = new Date(ts);
  if (tf === "1d") {
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ── Chart ─────────────────────────────────────────────────────────────────────

function renderChart(prices, tf) {
  const unit   = assetData.unit;
  const values = prices.map(p => p[1]);
  const isPos  = values[values.length - 1] >= values[0];
  const color  = isPos ? "#22c55e" : "#ef4444";

  const canvas = document.getElementById("detail-chart");
  const ctx    = canvas.getContext("2d");
  const grad   = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 380);
  grad.addColorStop(0, color + "40");
  grad.addColorStop(1, color + "05");

  if (detailChart) detailChart.destroy();

  detailChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: prices.map(p => fmtAxisLabel(p[0], tf)),
      datasets: [{
        data: values,
        borderColor: color,
        borderWidth: 2,
        backgroundColor: grad,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: "#0b0e18",
        pointHoverBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1c2235",
          borderColor: "#252d45",
          borderWidth: 1,
          titleColor: "#64748b",
          titleFont: { size: 11 },
          bodyColor: "#e2e8f0",
          bodyFont: { size: 14, weight: "600" },
          padding: 10,
          displayColors: false,
          callbacks: {
            title: items => fmtTooltipTitle(prices[items[0].dataIndex][0], tf),
            label: item  => fmtPrice(item.parsed.y, unit),
          },
        },
      },
      scales: {
        x: {
          grid:   { color: "#1c2235" },
          border: { display: false },
          ticks: {
            color: "#475569",
            font:  { size: 11 },
            maxTicksLimit: 8,
            maxRotation: 0,
          },
        },
        y: {
          position: "right",
          grid:   { color: "#1c2235" },
          border: { display: false },
          ticks: {
            color: "#475569",
            font:  { size: 11 },
            callback: v => fmtPrice(v, unit),
          },
        },
      },
    },
  });
}

// ── Timeframe toggle ──────────────────────────────────────────────────────────

function switchTimeframe(tf) {
  activeTf = tf;
  document.querySelectorAll(".tf-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tf === tf);
  });

  const prices = assetData.timeframes[tf];
  if (!prices || prices.length === 0) {
    console.warn("No data for timeframe:", tf);
    return;
  }
  renderChart(prices, tf);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function updateStats() {
  const unit   = assetData.unit;
  const stats  = assetData.stats || {};
  const tf1d   = assetData.timeframes["1d"] || [];
  const tf1y   = assetData.timeframes["1y"] || [];

  // Prev close: from stats, or second-to-last point of 30d data
  const tf30d     = assetData.timeframes["30d"] || [];
  const prevClose = stats.prev_close ?? (tf30d.length > 1 ? tf30d[tf30d.length - 2][1] : null);
  document.getElementById("stat-prev-close").textContent = fmtPrice(prevClose, unit);

  // 52w high/low: from stats, or from 1y data
  const vals1y  = tf1y.map(p => p[1]);
  const high52w = stats.high_52w ?? (vals1y.length ? Math.max(...vals1y) : null);
  const low52w  = stats.low_52w  ?? (vals1y.length ? Math.min(...vals1y) : null);
  document.getElementById("stat-high-52w").textContent = fmtPrice(high52w, unit);
  document.getElementById("stat-low-52w").textContent  = fmtPrice(low52w,  unit);

  // Day high/low from 1d data
  const vals1d = tf1d.map(p => p[1]);
  document.getElementById("stat-day-high").textContent = vals1d.length ? fmtPrice(Math.max(...vals1d), unit) : "—";
  document.getElementById("stat-day-low").textContent  = vals1d.length ? fmtPrice(Math.min(...vals1d), unit) : "—";

  // Volume
  document.getElementById("stat-vol").textContent = fmtVolume(stats.volume);
}

// ── Header price + change ─────────────────────────────────────────────────────

function updateHeader() {
  const unit  = assetData.unit;
  const tf30d = assetData.timeframes["30d"] || [];
  const tf1d  = assetData.timeframes["1d"]  || [];

  const latest = (tf1d.length  ? tf1d[tf1d.length   - 1][1] : null)
              ?? (tf30d.length ? tf30d[tf30d.length - 1][1] : null);
  const prev   = tf30d.length > 1 ? tf30d[tf30d.length - 2][1] : null;

  if (latest != null) {
    document.getElementById("detail-price").textContent = fmtPrice(latest, unit);
  }
  if (latest != null && prev != null) {
    const pct  = (latest - prev) / prev * 100;
    const isPos = pct >= 0;
    const el   = document.getElementById("detail-change");
    el.textContent = `${isPos ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%`;
    el.classList.add(isPos ? "positive" : "negative");
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const loading = document.getElementById("chart-loading");
  loading.style.display = "flex";

  try {
    const res = await fetch(`data/${ticker}.json?t=${Date.now()}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    assetData = await res.json();

    document.title = `${assetData.name} — Market Dashboard`;
    document.getElementById("asset-name").textContent   = assetData.name;
    document.getElementById("asset-symbol").textContent = assetData.symbol;

    updateHeader();
    updateStats();
    switchTimeframe("1d");
  } catch (err) {
    console.error("Failed to load asset data:", err);
    loading.textContent = "Data unavailable";
    return;
  }

  loading.style.display = "none";
}

document.querySelectorAll(".tf-btn").forEach(btn => {
  btn.addEventListener("click", () => switchTimeframe(btn.dataset.tf));
});

init();
