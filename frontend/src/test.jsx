import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { Line as LineChartJs } from "react-chartjs-2";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
} from "chart.js";

import zoomPlugin from "chartjs-plugin-zoom";

const HOURLY_URL = "http://localhost:3000/data/hourly.json";
const DAILY_URL = "http://localhost:3000/data/daily.json";
const TICKS_URL = "http://localhost:3000/data/ticks.json";

// FANCY THEME: neon
const APP_BG = "radial-gradient(1200px 600px at 50% -20%, #0ea5e9, transparent), #020617";
const CARD_BG = "linear-gradient(180deg, #0b1220, #020617)";
const BORDER = "#1e293b";
const TITLE = "#e5e7eb";
const TEXT = "#e5e7eb";
const MUTED = "#94a3b8";
const BTN_BG = "linear-gradient(135deg, #38bdf8, #22d3ee)";
const LINE_COLOR = "#e5e7eb";
const CARD_GLOW = "0 0 0 1px rgba(56,189,248,0.25), 0 20px 40px rgba(56,189,248,0.14)";
const ACTIVE_BG = "rgba(56, 189, 248, 0.14)";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const fmtInt = (n) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)
    : "—";

const fmtUSD0 = (n) =>
  Number.isFinite(n) ? `$${fmtInt(n)}` : "—";

const fmtUSD2 = (n) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(n)
    : "—";

const formatHour = (unixSec) => {
  const d = new Date(unixSec * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  return `${mm}/${dd} ${hh}`;
};

const formatDay = (unixSec) => {
  const d = new Date(unixSec * 1000);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${yy}`;
};

function extractTs(d) {
  const ts = Number(d.timestamp ?? d.periodStartUnix ?? d.dayStartUnix);
  return Number.isFinite(ts) ? ts : NaN;
}

function extractPrice(d) {
  const p0 = Number(d.token0Price);
  if (Number.isFinite(p0)) return p0;

  const p = Number(d.price);
  if (Number.isFinite(p)) return p;

  const p1 = Number(d.token1Price);
  if (Number.isFinite(p1) && p1 !== 0) return 1 / p1;

  return NaN;
}

function computeYRange(values, padFrac = 0.06) {
  if (!values || values.length === 0) return { min: undefined, max: undefined };
  let lo = Infinity,
    hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi))
    return { min: undefined, max: undefined };
  if (hi === lo) {
    const pad = Math.max(1, Math.abs(hi) * 0.01);
    return { min: lo - pad, max: hi + pad };
  }
  const span = hi - lo;
  const pad = span * padFrac;
  return { min: lo - pad, max: hi + pad };
}

// =========================
//   PLUGIN: BOUNDS + CURSOR
// =========================
const rangeAndCursorPlugin = {
  id: "rangeAndCursor",

  afterEvent(chart, evt) {
    const { event } = evt;

    const state = (chart.$dragState ??= { dragging: null });
    const lines = chart.$lines;
    const yScale = chart.scales.y;
    const chartArea = chart.chartArea;

    if (!lines || !yScale || !chartArea) return;

    const inside =
      event.x >= chartArea.left &&
      event.x <= chartArea.right &&
      event.y >= chartArea.top &&
      event.y <= chartArea.bottom;

    if (!state.dragging && event.type === "mousemove" && inside) {
      chart.$cursorY = event.y;
      chart.$cursorVal = yScale.getValueForPixel(event.y);
      chart.draw();
    }

    if (event.type === "mouseout") {
      chart.$cursorY = null;
      chart.$cursorVal = null;
      chart.draw();
    }

    if (event.type === "mousedown" && inside) {
      for (const line of [...lines].reverse()) {
        const lineY = yScale.getPixelForValue(line.value);
        if (Math.abs(event.y - lineY) < 6) {
          state.dragging = line;
          break;
        }
      }
    }

    if (event.type === "mousemove" && state.dragging) {
      let newVal = yScale.getValueForPixel(event.y);

      const axisMin = Number.isFinite(yScale.min) ? yScale.min : newVal;
      const axisMax = Number.isFinite(yScale.max) ? yScale.max : newVal;
      newVal = clamp(newVal, axisMin, axisMax);

      const upper = lines.find((l) => l.label === "Upper Bound");
      const lower = lines.find((l) => l.label === "Lower Bound");

      if (state.dragging.label === "Upper Bound") {
        state.dragging.value = Math.max(newVal, lower.value);
      } else {
        state.dragging.value = Math.min(newVal, upper.value);
      }

      chart.draw();
    }

    if (event.type === "mouseup" || event.type === "mouseout") {
      if (state.dragging?.onDragEnd)
        state.dragging.onDragEnd(state.dragging.value);
      state.dragging = null;
    }
  },

  afterDatasetsDraw(chart) {
    const lines = chart.$lines;
    const yScale = chart.scales.y;
    const xScale = chart.scales.x;
    const { ctx } = chart;

    if (!lines || !yScale || !xScale) return;

    const upper = lines.find((l) => l.label === "Upper Bound");
    const lower = lines.find((l) => l.label === "Lower Bound");

    const left = xScale.left;
    const right = xScale.right;

    const yUpper = yScale.getPixelForValue(upper.value);
    const yLower = yScale.getPixelForValue(lower.value);

    ctx.save();
    ctx.fillStyle = "rgba(99, 102, 241, 0.12)";
    ctx.fillRect(left, yUpper, right - left, yLower - yUpper);
    ctx.restore();

    for (const line of lines) {
      const y = yScale.getPixelForValue(line.value);

      ctx.save();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();

      const labelWidth = 118;
      const labelHeight = 24;
      const radius = 12;
      const midX = (left + right) / 2;
      const x = midX - labelWidth / 2;
      const yBox = y - labelHeight / 2;

      ctx.fillStyle = line.color;
      ctx.beginPath();
      ctx.moveTo(x + radius, yBox);
      ctx.lineTo(x + labelWidth - radius, yBox);
      ctx.quadraticCurveTo(
        x + labelWidth,
        yBox,
        x + labelWidth,
        yBox + radius
      );
      ctx.lineTo(x + labelWidth, yBox + labelHeight - radius);
      ctx.quadraticCurveTo(
        x + labelWidth,
        yBox + labelHeight,
        x + labelWidth - radius,
        yBox + labelHeight
      );
      ctx.lineTo(x + radius, yBox + labelHeight);
      ctx.quadraticCurveTo(
        x,
        yBox + labelHeight,
        x,
        yBox + labelHeight - radius
      );
      ctx.lineTo(x, yBox + radius);
      ctx.quadraticCurveTo(x, yBox, x + radius, yBox);
      ctx.fill();

      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "600 12px Inter";
      ctx.fillText(line.label, midX, y);
      ctx.restore();
    }

    if (chart.$cursorY != null && chart.$cursorVal != null) {
      const y = chart.$cursorY;
      const val = chart.$cursorVal;

      ctx.save();
      ctx.strokeStyle = "rgba(17, 24, 39, 0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.restore();

      const text = fmtUSD2(val);
      ctx.save();
      ctx.font = "600 11px Inter";

      const padX = 6;
      const w = ctx.measureText(text).width + padX * 2;
      const h = 18;

      const x0 = left + 6;
      const y0 = y - h / 2;

      const top = chart.chartArea.top;
      const bottom = chart.chartArea.bottom;
      const yClamped = Math.max(top, Math.min(bottom - h, y0));

      const r = 9;

      ctx.fillStyle = "rgba(17, 24, 39, 0.80)";
      ctx.beginPath();
      ctx.moveTo(x0 + r, yClamped);
      ctx.lineTo(x0 + w - r, yClamped);
      ctx.quadraticCurveTo(x0 + w, yClamped, x0 + w, yClamped + r);
      ctx.lineTo(x0 + w, yClamped + h - r);
      ctx.quadraticCurveTo(x0 + w, yClamped + h, x0 + w - r, yClamped + h);
      ctx.lineTo(x0 + r, yClamped + h);
      ctx.quadraticCurveTo(x0, yClamped + h, x0, yClamped + h - r);
      ctx.lineTo(x0, yClamped + r);
      ctx.quadraticCurveTo(x0, yClamped, x0 + r, yClamped);
      ctx.fill();

      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x0 + w / 2, yClamped + h / 2);
      ctx.restore();
    }
  },
};

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  zoomPlugin,
  rangeAndCursorPlugin
);

const TIMEFRAMES = [
  { id: "24h", label: "24 Hours", source: "hourly", count: 24 },
  { id: "7d", label: "7 Days", source: "hourly", count: 7 * 24 },
  { id: "30d", label: "30 Days", source: "daily", count: 30 },
  { id: "6m", label: "6 Months", source: "daily", count: 182 },
  { id: "1y", label: "Yearly", source: "daily", count: 365 },
];

function normalizeRange(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { lo, hi };
}

// Include ticks whose price interval overlaps [rangeLo, rangeHi]
function tickOverlapsRange(tick, rangeLo, rangeHi) {
  const pl = Number(tick.priceLowerUSD);
  const pu = Number(tick.priceUpperUSD);
  if (!Number.isFinite(pl) || !Number.isFinite(pu)) return false;
  const lo = Math.min(pl, pu);
  const hi = Math.max(pl, pu);
  return hi >= rangeLo && lo <= rangeHi;
}

export default function Test() {
  const chartRef = useRef(null);

  const [hourlyAll, setHourlyAll] = useState([]);
  const [dailyAll, setDailyAll] = useState([]);
  const [ticksAll, setTicksAll] = useState([]);

  const [view, setView] = useState("7d");
  const [loadErr, setLoadErr] = useState("");

  const didInitBoundsRef = useRef(false);
  const [upperValue, setUpperValue] = useState(1000);
  const [lowerValue, setLowerValue] = useState(-1000);

  const [upperText, setUpperText] = useState("1000");
  const [lowerText, setLowerText] = useState("-1000");

  const [depositText, setDepositText] = useState("1000");

  const [calcRequested, setCalcRequested] = useState(false);
  const [estFeesWeekly, setEstFeesWeekly] = useState("—");
  const [estFeesDaily, setEstFeesDaily] = useState("—");
  const [estApr, setEstApr] = useState("—");

  useEffect(() => setUpperText(fmtInt(upperValue)), [upperValue]);
  useEffect(() => setLowerText(fmtInt(lowerValue)), [lowerValue]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    chart.$lines = [
      {
        label: "Upper Bound",
        color: "#7c3aed",
        value: upperValue,
        onDragEnd: setUpperValue,
      },
      {
        label: "Lower Bound",
        color: "#2563eb",
        value: lowerValue,
        onDragEnd: setLowerValue,
      },
    ];
  }, [upperValue, lowerValue]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(HOURLY_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${HOURLY_URL}`);
        const raw = await res.json();
        const arr = Array.isArray(raw) ? raw : raw?.poolHourDatas;
        if (!Array.isArray(arr) || arr.length === 0)
          throw new Error("hourly.json has no array data");

        const sorted = [...arr].sort((a, b) => extractTs(a) - extractTs(b));
        const mapped = sorted
          .map((d) => {
            const ts = extractTs(d);
            const price = extractPrice(d);
            if (!Number.isFinite(ts) || !Number.isFinite(price)) return null;
            return { ts, label: formatHour(ts), price };
          })
          .filter(Boolean);

        setHourlyAll(mapped);

        if (!didInitBoundsRef.current && mapped.length) {
          didInitBoundsRef.current = true;
          const last = mapped[mapped.length - 1].price;
          setLowerValue(last * 0.95);
          setUpperValue(last * 1.05);
        }
      } catch (e) {
        setLoadErr(String(e?.message || e));
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(DAILY_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${DAILY_URL}`);
        const raw = await res.json();
        const arr = Array.isArray(raw) ? raw : raw?.poolDayDatas;
        if (!Array.isArray(arr) || arr.length === 0)
          throw new Error("daily.json has no array data");

        const sorted = [...arr].sort((a, b) => extractTs(a) - extractTs(b));
        const mapped = sorted
          .map((d) => {
            const ts = extractTs(d);
            const price = extractPrice(d);
            const feesUSD = Number(d.feesUSD);
            if (!Number.isFinite(ts) || !Number.isFinite(price)) return null;
            return {
              ts,
              label: formatDay(ts),
              price,
              feesUSD: Number.isFinite(feesUSD) ? feesUSD : null,
            };
          })
          .filter(Boolean);

        setDailyAll(mapped);
      } catch (e) {
        setLoadErr((prev) => prev || String(e?.message || e));
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(TICKS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${TICKS_URL}`);
        const raw = await res.json();
        const arr = Array.isArray(raw) ? raw : raw?.ticks;
        if (!Array.isArray(arr) || arr.length === 0)
          throw new Error("ticks.json has no array data");

        const mapped = arr
          .map((t) => ({
            priceLowerUSD: Number(t.priceLowerUSD),
            priceUpperUSD: Number(t.priceUpperUSD),
            usdValue: Number(t.usdValue),
          }))
          .filter(
            (t) =>
              Number.isFinite(t.priceLowerUSD) &&
              Number.isFinite(t.priceUpperUSD) &&
              Number.isFinite(t.usdValue)
          );

        setTicksAll(mapped);
      } catch (e) {
        setLoadErr((prev) => prev || String(e?.message || e));
      }
    })();
  }, []);

  const currentPrice = useMemo(() => {
    if (!hourlyAll.length) return null;
    return hourlyAll[hourlyAll.length - 1].price;
  }, [hourlyAll]);

  const feesSummary = useMemo(() => {
    const fees = dailyAll
      .map((d) => ({ ts: d.ts, feesUSD: Number(d.feesUSD) }))
      .filter((d) => Number.isFinite(d.ts) && Number.isFinite(d.feesUSD));

    if (!fees.length) {
      return { last1d: null, last7d: null, last30d: null };
    }

    const last1 = fees[fees.length - 1].feesUSD;

    const sumLastN = (n) => {
      const slice = fees.slice(-n);
      const s = slice.reduce((acc, x) => acc + x.feesUSD, 0);
      return Number.isFinite(s) ? s : null;
    };

    return {
      last1d: last1,
      last7d: sumLastN(7),
      last30d: sumLastN(30),
    };
  }, [dailyAll]);

  const tf = useMemo(
    () => TIMEFRAMES.find((t) => t.id === view) ?? TIMEFRAMES[1],
    [view]
  );

  const activeSeries = useMemo(() => {
    const source = tf.source === "hourly" ? hourlyAll : dailyAll;
    if (!source.length) return [];
    return source.slice(-tf.count);
  }, [tf, hourlyAll, dailyAll]);

  const yRange = useMemo(() => {
    const dataRange = computeYRange(activeSeries.map((p) => p.price), 0.06);
    const combined = [
      dataRange.min,
      dataRange.max,
      Number.isFinite(lowerValue) ? lowerValue : null,
      Number.isFinite(upperValue) ? upperValue : null,
    ].filter((v) => Number.isFinite(v));
    return computeYRange(combined, 0.04);
  }, [activeSeries, lowerValue, upperValue]);

  const applyUpper = (raw) => {
    const n = Number(String(raw).replaceAll(",", ""));
    if (!Number.isFinite(n)) return;
    setUpperValue(Math.max(n, lowerValue));
  };

  const applyLower = (raw) => {
    const n = Number(String(raw).replaceAll(",", ""));
    if (!Number.isFinite(n)) return;
    setLowerValue(Math.min(n, upperValue));
  };

  const handleReset = useCallback(() => {
    if (!Number.isFinite(currentPrice)) return;
    setLowerValue(currentPrice * 0.95);
    setUpperValue(currentPrice * 1.05);
    const chart = chartRef.current;
    if (chart?.resetZoom) chart.resetZoom();
  }, [currentPrice]);

  const totalLiquidityInRange = useMemo(() => {
    const { lo, hi } = normalizeRange(lowerValue, upperValue);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    if (!ticksAll.length) return null;

    let sum = 0;
    for (const t of ticksAll) {
      if (!tickOverlapsRange(t, lo, hi)) continue;
      sum += t.usdValue;
    }
    return Number.isFinite(sum) ? sum : null;
  }, [ticksAll, lowerValue, upperValue]);

  const handleCalculate = useCallback(() => {
    const deposit = Number(String(depositText).replaceAll(",", ""));
    const L = totalLiquidityInRange;
    const fees7 = feesSummary.last7d;

    if (!Number.isFinite(deposit) || deposit <= 0) {
      setCalcRequested(true);
      setEstFeesWeekly("—");
      setEstFeesDaily("—");
      setEstApr("—");
      return;
    }

    if (!Number.isFinite(L) || L <= 0 || !Number.isFinite(fees7) || fees7 < 0) {
      setCalcRequested(true);
      setEstFeesWeekly("—");
      setEstFeesDaily("—");
      setEstApr("—");
      return;
    }

    // Your math:
    // weekly_est = deposit / L * fees_last_week
    // daily_est = weekly_est / 7
    // APR(%) = (fees_last_week / L) * 52 * 100   (same as weekly_est/deposit * 52 * 100)
    const weeklyEst = (deposit / L) * fees7;
    const dailyEst = weeklyEst / 7;
    const aprPct = (fees7 / L) * 52 * 100;

    setCalcRequested(true);
    setEstFeesWeekly(fmtUSD0(weeklyEst));
    setEstFeesDaily(fmtUSD0(dailyEst));
    setEstApr(Number.isFinite(aprPct) ? `${fmtInt(aprPct)}%` : "—");
  }, [depositText, totalLiquidityInRange, feesSummary.last7d]);

  const chartData = useMemo(
    () => ({
      labels: activeSeries.map((p) => p.label),
      datasets: [
        {
          label: "ETH Price (USD)",
          data: activeSeries.map((p) => p.price),
          borderColor: LINE_COLOR,
          pointRadius: 0,
          tension: 0.15,
        },
      ],
    }),
    [activeSeries]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      events: ["mousedown", "mousemove", "mouseup", "mouseout"],
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: view === "24h" ? 12 : view === "7d" ? 12 : 10,
            color: MUTED,
          },
        },
        y: {
          min: yRange.min,
          max: yRange.max,
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: MUTED,
            callback: (v) => fmtUSD0(Number(v)),
          },
        },
      },
      plugins: {
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: false },
            mode: "y",
          },
          pan: { enabled: false },
        },
        tooltip: { enabled: true },
      },
    }),
    [yRange.min, yRange.max, view]
  );

  const cardStyle = {
    background: CARD_BG,
    border: `1px solid ${BORDER}`, boxShadow: CARD_GLOW,
    borderRadius: 14,
    padding: 14,
    boxSizing: "border-box",
  };

  const labelStyle = { color: MUTED, fontWeight: 600 };

  return (
    <div style={{ padding: 20, minHeight: "100vh", background: APP_BG, color: TEXT, backgroundAttachment: "fixed" }}>
      <h2 style={{ fontWeight: 700, color: TITLE, marginBottom: 10, letterSpacing: "0.3px" }}>
        Uniswap Pool Tracker
      </h2>

      {loadErr ? (
        <div style={{ marginBottom: 12, color: "crimson", fontWeight: 600 }}>
          {loadErr}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {TIMEFRAMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: `1px solid ${BORDER}`,
              background: view === t.id ? ACTIVE_BG : "transparent",
              cursor: "pointer",
              fontWeight: 600,
              color: TEXT,
            }}
          >
            {t.label}
          </button>
        ))}

        <button
          onClick={handleReset}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: `1px solid ${BORDER}`,
            background: CARD_BG,
            cursor: "pointer",
            fontWeight: 600,
            color: TEXT,
            marginLeft: 6,
          }}
        >
          Reset
        </button>

        <div style={{ marginLeft: "auto", color: MUTED, fontWeight: 600 }}>
          {Number.isFinite(currentPrice) ? `Current: ${fmtUSD2(currentPrice)}` : "Loading..."}
        </div>
      </div>

      <div
        style={{
          width: "100%",
          height: 520,
          background: CARD_BG,
          border: `1px solid ${BORDER}`, boxShadow: CARD_GLOW,
          borderRadius: 14,
          padding: 10,
          boxSizing: "border-box",
        }}
      >
        <LineChartJs ref={chartRef} data={chartData} options={options} />
      </div>

      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Fees</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              rowGap: 10,
              columnGap: 12,
            }}
          >
            <div style={labelStyle}>Last day</div>
            <div style={{ fontWeight: 700 }}>{fmtUSD0(feesSummary.last1d)}</div>

            <div style={labelStyle}>Last week</div>
            <div style={{ fontWeight: 700 }}>{fmtUSD0(feesSummary.last7d)}</div>

            <div style={labelStyle}>Last month</div>
            <div style={{ fontWeight: 700 }}>{fmtUSD0(feesSummary.last30d)}</div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Position setup</div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <label style={{ fontWeight: 600, color: MUTED }}>Upper bound</label>
              <input
                value={upperText}
                onChange={(e) => setUpperText(e.target.value)}
                onBlur={() => applyUpper(upperText)}
                onKeyDown={(e) => e.key === "Enter" && applyUpper(upperText)}
                style={{
                  width: "100%",
                  minWidth: 0,
                  padding: "10px 10px",
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <label style={{ fontWeight: 600, color: MUTED }}>Lower bound</label>
              <input
                value={lowerText}
                onChange={(e) => setLowerText(e.target.value)}
                onBlur={() => applyLower(lowerText)}
                onKeyDown={(e) => e.key === "Enter" && applyLower(lowerText)}
                style={{
                  width: "100%",
                  minWidth: 0,
                  padding: "10px 10px",
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          <div style={{ height: 12 }} />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 128px",
              gap: 12,
              alignItems: "end",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <label style={{ fontWeight: 600, color: MUTED }}>Deposit ($)</label>
              <input
                value={depositText}
                onChange={(e) => setDepositText(e.target.value)}
                style={{
                  width: "100%",
                  minWidth: 0,
                  padding: "10px 10px",
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  boxSizing: "border-box",
                }}
              />
            </div>

            <button
              onClick={handleCalculate}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "none",
                background: BTN_BG,
                color: "white",
                cursor: "pointer",
                fontWeight: 700,
                height: 42,
              }}
            >
              Calculate
            </button>
          </div>

          <div style={{ height: 10 }} />

          <div style={{ color: MUTED, fontWeight: 600 }}>
            Total liquidity in range: {fmtUSD0(totalLiquidityInRange)}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Estimates</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              rowGap: 10,
              columnGap: 12,
            }}
          >
            <div style={labelStyle}>Estimated fees (daily)</div>
            <div style={{ fontWeight: 700 }}>{calcRequested ? estFeesDaily : "—"}</div>

            <div style={labelStyle}>Estimated fees (weekly)</div>
            <div style={{ fontWeight: 700 }}>{calcRequested ? estFeesWeekly : "—"}</div>

            <div style={labelStyle}>Estimated APR</div>
            <div style={{ fontWeight: 700 }}>{calcRequested ? estApr : "—"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
