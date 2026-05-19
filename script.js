const charts = {};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtPrice(price, symbol, unit) {
  if (unit === "pts") {
    // Index points (SPX, NDX, DJI) — comma-separated, 2 decimals
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (symbol === "BTC") {
    return "$" + Math.round(price).toLocaleString("en-US");
  }
  // Commodities and everything else
  return "$" + price.toFixed(2);
}

function fmtChangePct(pct) {
  const arrow = pct >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(pct).toFixed(2)}%`;
}

function fmtTreasuryChange(ppChange) {
  // ppChange is a percentage-point delta; multiply by 100 to get basis points
  const bps  = Math.abs(ppChange * 100).toFixed(1);
  const arrow = ppChange >= 0 ? "▲" : "▼";
  const sign  = ppChange >= 0 ? "+" : "−";
  return `${arrow} ${sign}${bps} bps`;
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function sparkline(canvasId, data, isPositive) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data || data.length < 2) return;

  if (charts[canvasId]) charts[canvasId].destroy();

  const ctx   = canvas.getContext("2d");
  const color = isPositive ? "#22c55e" : "#ef4444";
  const grad  = ctx.createLinearGradient(0, 0, 0, 58);
  grad.addColorStop(0, color + "55");
  grad.addColorStop(1, color + "08");

  charts[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels: data.map((_, i) => i),
      datasets: [{
        data,
        borderColor: color,
        borderWidth: 1.5,
        backgroundColor: grad,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend:  { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: { display: false },
        y: { display: false },
      },
    },
  });
}

function renderYieldCurve(treasuries) {
  const keys   = ["2yr", "5yr", "10yr", "30yr"];
  const labels = ["2-Year", "5-Year", "10-Year", "30-Year"];
  const rates  = keys.map(k => treasuries[k]?.rate ?? null);

  if (rates.every(r => r === null)) return;

  const canvas = document.getElementById("yield-curve");
  if (!canvas) return;
  if (charts["yield-curve"]) charts["yield-curve"].destroy();

  charts["yield-curve"] = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: rates,
        borderColor: "#a78bfa",
        backgroundColor: "#a78bfa1a",
        borderWidth: 2.5,
        pointRadius: 6,
        pointBackgroundColor: "#a78bfa",
        pointBorderColor: "#141825",
        pointBorderWidth: 2,
        fill: true,
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1c2235",
          borderColor: "#252d45",
          borderWidth: 1,
          titleColor: "#64748b",
          bodyColor: "#e2e8f0",
          callbacks: { label: ctx => `${ctx.parsed.y.toFixed(2)}%` },
        },
      },
      scales: {
        x: {
          grid:  { color: "#252d45" },
          ticks: { color: "#64748b", font: { size: 11 } },
        },
        y: {
          grid:  { color: "#252d45" },
          ticks: {
            color: "#64748b",
            font:  { size: 11 },
            callback: v => v.toFixed(2) + "%",
          },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// DOM update helpers
// ---------------------------------------------------------------------------

function updateAssetCard(key, asset) {
  const priceEl  = document.getElementById(`price-${key}`);
  const changeEl = document.getElementById(`change-${key}`);
  if (!priceEl || !changeEl || !asset) return;

  const isPos = asset.change_pct >= 0;
  priceEl.textContent  = fmtPrice(asset.price, asset.symbol, asset.unit);
  changeEl.textContent = fmtChangePct(asset.change_pct);
  changeEl.className   = `card-change ${isPos ? "positive" : "negative"}`;
  sparkline(`chart-${key}`, asset.history, isPos);
}

function updateTreasuryCard(key, t) {
  const rateEl   = document.getElementById(`rate-${key}`);
  const changeEl = document.getElementById(`change-${key}`);
  if (!rateEl || !changeEl || !t) return;

  const isPos = t.change >= 0;
  rateEl.textContent   = t.rate.toFixed(2) + "%";
  changeEl.textContent = fmtTreasuryChange(t.change);
  changeEl.className   = `card-change ${isPos ? "positive" : "negative"}`;
  sparkline(`chart-${key}`, t.history, isPos);
}

// ---------------------------------------------------------------------------
// Data load
// ---------------------------------------------------------------------------

async function loadData() {
  try {
    const res = await fetch("data/market.json?t=" + Date.now());
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    // Timestamp
    const ts = new Date(data.updated_at);
    document.getElementById("updated-at").textContent =
      "Updated " + ts.toLocaleString("en-US", {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
        timeZoneName: "short",
      });

    // Assets — keys must match fetch_data.py output keys
    const assetKeys = ["btc", "spx", "ndx", "dji", "wti", "brent"];
    for (const key of assetKeys) {
      updateAssetCard(key, data.assets[key]);
    }

    // Treasuries
    const t = data.treasuries || {};
    for (const key of ["2yr", "5yr", "10yr", "30yr"]) {
      updateTreasuryCard(key, t[key]);
    }

    renderYieldCurve(t);

  } catch (err) {
    console.error("Failed to load market data:", err);
    document.getElementById("updated-at").textContent = "Data unavailable";
  }
}

loadData();
setInterval(loadData, 15 * 60 * 1000);
