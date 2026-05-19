"""
Fetches market data from:
  - CoinGecko   (BTC — free, no key required)
  - Massive.com (S&P 500, Nasdaq 100, Dow Jones — requires MASSIVE_API_KEY secret)
  - Alpha Vantage (WTI + Brent crude — requires ALPHA_VANTAGE_KEY secret)
  - FRED / St. Louis Fed (treasury yields — requires FRED_API_KEY secret)

Writes output to data/market.json.

Rate limits:
  - Massive:       generous (paid API, no hard daily cap)
  - Alpha Vantage: 25 calls/day free tier; this script uses 2/run → 6/day at 3×/day
  - CoinGecko:     free, ~50 req/min public
  - FRED:          free, 120 req/min
"""

import json
import os
import time
from datetime import date, datetime, timedelta, timezone

import requests

# ── Config ──────────────────────────────────────────────────────────────────

MASSIVE_BASE = "https://api.massive.com"
MASSIVE_KEY  = os.environ.get("MASSIVE_API_KEY", "")

AV_BASE = "https://www.alphavantage.co/query"
AV_KEY  = os.environ.get("ALPHA_VANTAGE_KEY", "")

FRED_KEY = os.environ.get("FRED_API_KEY", "")

AV_DELAY = 13  # seconds between AV calls (free tier: 5 calls/min)


# ── Generic HTTP helper ──────────────────────────────────────────────────────

def get(url, params=None, label="", headers=None):
    try:
        r = requests.get(url, params=params, headers=headers, timeout=20)
        r.raise_for_status()
        data = r.json()
        # Detect AV rate-limit envelope
        if isinstance(data, dict) and ("Note" in data or "Information" in data):
            print(f"  [AV limit] {(data.get('Note') or data.get('Information'))[:120]}")
            return None
        return data
    except Exception as exc:
        print(f"  ERROR {label}: {exc}")
        return None


def massive_hdr():
    return {"Authorization": f"Bearer {MASSIVE_KEY}"}


# ── CoinGecko — BTC ─────────────────────────────────────────────────────────

def fetch_btc():
    print("BTC (CoinGecko)…")
    price = get(
        "https://api.coingecko.com/api/v3/simple/price",
        {"ids": "bitcoin", "vs_currencies": "usd", "include_24hr_change": "true"},
        "BTC price",
    )
    hist = get(
        "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart",
        {"vs_currency": "usd", "days": "30", "interval": "daily"},
        "BTC history",
    )
    if not price or not hist:
        return None
    coin = price["bitcoin"]
    return {
        "name": "Bitcoin",
        "symbol": "BTC",
        "price": coin["usd"],
        "change_pct": coin["usd_24h_change"],
        "history": [p[1] for p in hist["prices"]],
        "unit": "$",
    }


# ── Massive — equity indices ─────────────────────────────────────────────────

def fetch_massive_index(ticker, name, display_symbol, days=30, unit="pts"):
    """
    Fetch 30 trading days of daily bars for any Massive-supported ticker.
    Indices use "I:SPX" format; stocks/ETFs use plain ticker ("CEG", "GLD").
    """
    print(f"{name} ({ticker}, Massive)…")
    if not MASSIVE_KEY:
        print("  MASSIVE_API_KEY not set — skipping.")
        return None

    end   = date.today().isoformat()
    start = (date.today() - timedelta(days=60)).isoformat()  # extra buffer for holidays

    data = get(
        f"{MASSIVE_BASE}/v2/aggs/ticker/{ticker}/range/1/day/{start}/{end}",
        {"adjusted": "true", "sort": "asc", "limit": 60},
        ticker,
        headers=massive_hdr(),
    )
    if not data or "results" not in data:
        print(f"  No results for {ticker}: {list((data or {}).keys())}")
        return None

    results = data["results"][-days:]
    history = [r["c"] for r in results]
    if not history:
        return None

    price  = history[-1]
    prev   = history[-2] if len(history) >= 2 else price
    change_pct = (price - prev) / prev * 100 if prev else 0

    return {
        "name": name,
        "symbol": display_symbol,
        "price": price,
        "change_pct": change_pct,
        "history": history,
        "unit": unit,
    }


# ── Alpha Vantage — commodities (WTI / Brent) ───────────────────────────────

def fetch_av_commodity(function, name, symbol, days=30):
    print(f"{name} ({function}, AV)…")
    if not AV_KEY:
        print("  ALPHA_VANTAGE_KEY not set — skipping.")
        return None
    data = get(
        AV_BASE,
        {"function": function, "interval": "daily", "apikey": AV_KEY},
        function,
    )
    if not data:
        return None
    entries = data.get("data", [])
    valid = [
        (e["date"], float(e["value"]))
        for e in entries
        if e.get("value") not in ("", ".", None)
    ]
    valid.sort(key=lambda x: x[0])
    recent  = valid[-days:]
    history = [v for _, v in recent]
    if not history:
        return None
    price  = history[-1]
    prev   = history[-2] if len(history) >= 2 else price
    change_pct = (price - prev) / prev * 100 if prev else 0
    return {
        "name": name,
        "symbol": symbol,
        "price": price,
        "change_pct": change_pct,
        "history": history,
        "unit": "$",
    }


# ── FRED — treasury yields ───────────────────────────────────────────────────

def fetch_fred(series_id, label, days=30):
    print(f"Treasury {label} ({series_id}, FRED)…")
    if not FRED_KEY:
        print("  FRED_API_KEY not set — skipping.")
        return None
    data = get(
        "https://api.stlouisfed.org/fred/series/observations",
        {
            "series_id": series_id,
            "api_key": FRED_KEY,
            "file_type": "json",
            "sort_order": "desc",
            "limit": days + 10,
        },
        series_id,
    )
    if not data:
        return None
    obs = data.get("observations", [])
    valid = [(o["date"], float(o["value"])) for o in obs if o.get("value") != "."]
    valid.sort(key=lambda x: x[0])
    recent  = valid[-days:]
    history = [v for _, v in recent]
    if not history:
        return None
    rate = history[-1]
    prev = history[-2] if len(history) >= 2 else rate
    return {
        "label": label,
        "rate": rate,
        "change": round(rate - prev, 4),  # percentage-point delta
        "history": history,
    }


# ── Yahoo Finance — stocks & spot commodities ────────────────────────────────

def fetch_yfinance(symbol, name, display_symbol, days=30, unit="$"):
    """
    Fetch daily price history via yfinance (Yahoo Finance).
    Use plain ticker for stocks (e.g. 'CEG') and futures symbols for
    commodities (e.g. 'GC=F' for gold spot, 'SI=F' for silver spot).
    """
    print(f"{name} ({symbol}, yfinance)…")
    try:
        import yfinance as yf
        hist = yf.Ticker(symbol).history(period=f"{days + 15}d")
        if hist.empty:
            print(f"  No data returned for {symbol}")
            return None
        hist = hist.tail(days)
        history = [round(float(p), 2) for p in hist["Close"].tolist()]
        if not history:
            return None
        price      = history[-1]
        prev       = history[-2] if len(history) >= 2 else price
        change_pct = (price - prev) / prev * 100 if prev else 0
        return {
            "name":       name,
            "symbol":     display_symbol,
            "price":      price,
            "change_pct": change_pct,
            "history":    history,
            "unit":       unit,
        }
    except Exception as exc:
        print(f"  ERROR {symbol}: {exc}")
        return None


# ── Persistence helper ───────────────────────────────────────────────────────

def load_existing():
    try:
        with open("data/market.json") as f:
            return json.load(f)
    except Exception:
        return {"assets": {}, "treasuries": {}}


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    existing = load_existing()
    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "assets":     dict(existing.get("assets", {})),
        "treasuries": dict(existing.get("treasuries", {})),
    }

    # BTC — CoinGecko
    btc = fetch_btc()
    if btc:
        output["assets"]["btc"] = btc

    # Indices, stocks & spot commodities — yfinance (no key required)
    for symbol, name, sym, key, unit in [
        ("^GSPC", "S&P 500",              "SPX",    "spx",    "pts"),
        ("^NDX",  "Nasdaq 100",           "NDX",    "ndx",    "pts"),
        ("^DJI",  "Dow Jones",            "DJI",    "dji",    "pts"),
        ("CEG",   "Constellation Energy", "CEG",    "ceg",    "$"),
        ("GC=F",  "Gold",                 "GOLD",   "gold",   "$"),
        ("SI=F",  "Silver",               "SILVER", "silver", "$"),
    ]:
        result = fetch_yfinance(symbol, name, sym, unit=unit)
        if result:
            output["assets"][key] = result

    # Crude oil — Alpha Vantage (2 calls, 13-s apart)
    time.sleep(AV_DELAY)
    wti = fetch_av_commodity("WTI", "WTI Crude", "WTI")
    if wti:
        output["assets"]["wti"] = wti

    time.sleep(AV_DELAY)
    brent = fetch_av_commodity("BRENT", "Brent Crude", "BRENT")
    if brent:
        output["assets"]["brent"] = brent

    # Treasury yields — FRED
    for label, series in [("2yr", "DGS2"), ("5yr", "DGS5"), ("10yr", "DGS10"), ("30yr", "DGS30")]:
        result = fetch_fred(series, label)
        if result:
            output["treasuries"][label] = result

    os.makedirs("data", exist_ok=True)
    with open("data/market.json", "w") as f:
        json.dump(output, f, indent=2)
    print("✓  Wrote data/market.json")


if __name__ == "__main__":
    main()
