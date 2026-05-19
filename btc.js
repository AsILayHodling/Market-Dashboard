let detailChart = null;

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

function fmtLarge(n) {
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9)  return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6)  return "$" + (n / 1e6).toFixed(2) + "M";
  return "$" + n.toLocaleString("en-US");
}

function fmtBtcPrice(p) {
  return "$" + Math.round(p).toLocaleString("en-US");
}

function fmtAxisLabel(timestamp, days) {
  const d = new Date(timestamp);
  if (days === 1) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }
  if (days <= 90) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function fmtTooltipTitle(timestamp, days) {
  const d = new Date(timestamp);
  if (days === 1) {
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function thinData(prices, maxPoints) {
  if (prices.length <= maxPoints) return prices;
  const step = Math.ceil(prices.length / maxPoints);
  const thinned = prices.filter((_, i) => i % step === 0);
  // Always include the last point
  if (thinned[thinned.length - 1] !== prices[prices.length - 1]) {
    thinned.push(prices[prices.length - 1]);
  }
  return thinned;
}

// ── Chart rendering ───────────────────────────────────────────────────────────

function renderChart(allPrices, days) {
  const prices = thinData(allPrices, 400);
  const values = prices.map(p => p[1]);
  const isPositive = values[values.length - 1] >= values[0];
  const color = isPositive ? "#22c55e" : "#ef4444";

  const canvas = document.getElementById("detail-chart");
  const ctx = canvas.getContext("2d");
  const h = canvas.offsetHeight || 380;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + "40");
  grad.addColorStop(1, color + "05");

  if (detailChart) detailChart.destroy();

  detailChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: prices.map(p => fmtAxisLabel(p[0], days)),
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
            title: items => fmtTooltipTitle(prices[items[0].dataIndex][0], days),
            label: item => fmtBtcPrice(item.parsed.y),
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
            callback: v => "$" + Math.round(v).toLocaleString("en-US"),
          },
        },
      },
    },
  });
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function loadTimeframe(days) {
  document.getElementById("chart-loading").style.display = "block";
  document.getElementById("detail-chart").style.opacity  = "0.3";

  document.querySelectorAll(".tf-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.days === String(days));
  });

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    renderChart(data.prices, days === "max" ? Infinity : Number(days));
  } catch (err) {
    console.error("Chart fetch failed:", err);
  } finally {
    document.getElementById("chart-loading").style.display = "none";
    document.getElementById("detail-chart").style.opacity  = "1";
  }
}

async function loadStats() {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin"
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const [coin] = await res.json();

    const isPos = coin.price_change_percentage_24h >= 0;

    document.getElementById("detail-price").textContent = fmtBtcPrice(coin.current_price);

    const changeEl = document.getElementById("detail-change");
    changeEl.textContent =
      `${isPos ? "▲" : "▼"} ${Math.abs(coin.price_change_percentage_24h).toFixed(2)}%` +
      `  (${isPos ? "+" : ""}${fmtBtcPrice(coin.price_change_24h)})`;
    changeEl.classList.add(isPos ? "positive" : "negative");

    document.getElementById("stat-mcap").textContent   = fmtLarge(coin.market_cap);
    document.getElementById("stat-vol").textContent    = fmtLarge(coin.total_volume);
    document.getElementById("stat-high").textContent   = fmtBtcPrice(coin.high_24h);
    document.getElementById("stat-low").textContent    = fmtBtcPrice(coin.low_24h);
    document.getElementById("stat-ath").textContent    = fmtBtcPrice(coin.ath);
    document.getElementById("stat-supply").textContent =
      (coin.circulating_supply / 1e6).toFixed(2) + "M BTC";
  } catch (err) {
    console.error("Stats fetch failed:", err);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.querySelectorAll(".tf-btn").forEach(btn => {
  btn.addEventListener("click", () => loadTimeframe(btn.dataset.days));
});

loadStats();
loadTimeframe(1);
