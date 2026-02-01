import React, { useEffect, useState, useMemo, useRef } from "react";
import { Line as LineChartJs } from "react-chartjs-2";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

import zoomPlugin from "chartjs-plugin-zoom";
import annotationPlugin from "chartjs-plugin-annotation";

// ---------- GLOBALS FOR DRAGGING ----------
let activeAnnotationElement = null;
let isDraggingAnnotation = false;
let globalSetLowerPrice = null;
let globalSetUpperPrice = null;
let globalLowerPrice = null;
let globalUpperPrice = null;

// ---------- CUSTOM DRAGGER PLUGIN ----------
const draggerPlugin = {
  id: "dragger",
  afterEvent(chart, args) {
    const event = args.event;
    if (!event) return;

    // Start drag when mouse down on an annotation element
    if (event.type === "mousedown" && activeAnnotationElement) {
      isDraggingAnnotation = true;
      return;
    }

    // End drag on mouseup / mouseout
    if (event.type === "mouseup" || event.type === "mouseout") {
      isDraggingAnnotation = false;
      return;
    }

    // Handle drag move
    if (
      event.type === "mousemove" &&
      isDraggingAnnotation &&
      activeAnnotationElement
    ) {
      const yScale =
        chart.scales[activeAnnotationElement.options.yScaleID || "y"];
      const newPixelY = event.y;
      let newPrice = yScale.getValueForPixel(newPixelY);

      const annId = activeAnnotationElement.options.id; // "lowerLine" or "upperLine"
      const anns = chart.options.plugins.annotation.annotations;

      if (annId === "lowerLine") {
        // Clamp so it stays below upperLine
        if (globalUpperPrice != null && newPrice >= globalUpperPrice) {
          newPrice = globalUpperPrice - 0.01;
        }
        anns.lowerLine.yMin = anns.lowerLine.yMax = newPrice;
        if (globalSetLowerPrice) globalSetLowerPrice(newPrice);
      } else if (annId === "upperLine") {
        // Clamp so it stays above lowerLine
        if (globalLowerPrice != null && newPrice <= globalLowerPrice) {
          newPrice = globalLowerPrice + 0.01;
        }
        anns.upperLine.yMin = anns.upperLine.yMax = newPrice;
        if (globalSetUpperPrice) globalSetUpperPrice(newPrice);
      }

      chart.update("none");
    }
  },
};

// Register plugins globally
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  zoomPlugin,
  annotationPlugin,
  draggerPlugin
);

export default function App() {
  // -----------------------------------------
  // STATE
  // -----------------------------------------
  const [hourly, setHourly] = useState([]);
  const [daily, setDaily] = useState([]);
  const [points, setPoints] = useState([]);
  const [range, setRange] = useState("24h");

  const [currentPrice, setCurrentPrice] = useState(null);
  const [fees24h, setFees24h] = useState(0);

  const [lowerPrice, setLowerPrice] = useState(null);
  const [upperPrice, setUpperPrice] = useState(null);

  const chartRef = useRef(null);

  // Make React setters / values visible to dragger plugin
  globalSetLowerPrice = setLowerPrice;
  globalSetUpperPrice = setUpperPrice;
  globalLowerPrice = lowerPrice;
  globalUpperPrice = upperPrice;

  // -----------------------------------------
  // LOAD DATA
  // -----------------------------------------
  useEffect(() => {
    async function load() {
      const h = await fetch("http://localhost:3000/data/hourly.json").then(
        (r) => r.json()
      );
      const d = await fetch("http://localhost:3000/data/daily.json").then(
        (r) => r.json()
      );
      setHourly(h);
      setDaily(d);
    }
    load();
  }, []);

  // -----------------------------------------
  // PROCESS DATA + INIT LINES
  // -----------------------------------------
  useEffect(() => {
    if (!hourly.length) return;

    const last = hourly[hourly.length - 1];
    const price = last.token0Price;

    setCurrentPrice(price);
    const fees = hourly
      .slice(-24)
      .reduce((acc, h) => acc + h.feesUSD, 0);
    setFees24h(fees);

    // Initialize range lines at ±5% once
    if (lowerPrice === null && upperPrice === null) {
      setLowerPrice(price * 0.95);
      setUpperPrice(price * 1.05);
    }

    let data;
    if (range === "24h") {
      data = hourly.slice(-24);
    } else if (range === "7d") {
      data = hourly.slice(-(24 * 7));
    } else {
      const n = range === "30d" ? 30 : range === "90d" ? 90 : 365;
      data = daily.slice(-n);
    }

    setPoints(
      data.map((d) => ({
        label: new Date(d.timestamp * 1000).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        price: d.token0Price,
      }))
    );
  }, [range, hourly, daily]);

  // -----------------------------------------
  // CHART DATA
  // -----------------------------------------
  const chartData = useMemo(
    () => ({
      labels: points.map((p) => p.label),
      datasets: [
        {
          label: "Price",
          data: points.map((p) => p.price),
          borderColor: "#4f46e5",
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
        },
      ],
    }),
    [points]
  );

  // -----------------------------------------
  // CHART OPTIONS
  // -----------------------------------------
  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,

      // Important for dragging
      events: ["mousedown", "mousemove", "mouseup", "mouseout"],

      plugins: {
        // ANNOTATIONS (LINES)
        annotation: {
          // Tell annotation plugin which element is "active" (hovered) for dragging
          enter(ctx) {
            activeAnnotationElement = ctx.element;
          },
          leave() {
            activeAnnotationElement = null;
            isDraggingAnnotation = false;
          },

          annotations: {
            lowerLine: {
              id: "lowerLine",
              type: "line",
              yMin: lowerPrice,
              yMax: lowerPrice,
              borderColor: "#7c3aed",
              borderWidth: 3,
              xMin: 0,
              xMax: "100%", // full width
              yScaleID: "y",
              label: {
                enabled: true,
                content: lowerPrice
                  ? `Lower: $${lowerPrice.toFixed(2)}`
                  : "Lower",
                position: "start",
                color: "#7c3aed",
              },
            },

            upperLine: {
              id: "upperLine",
              type: "line",
              yMin: upperPrice,
              yMax: upperPrice,
              borderColor: "#7c3aed",
              borderWidth: 3,
              xMin: 0,
              xMax: "100%",
              yScaleID: "y",
              label: {
                enabled: true,
                content: upperPrice
                  ? `Upper: $${upperPrice.toFixed(2)}`
                  : "Upper",
                position: "start",
                color: "#7c3aed",
              },
            },
          },
        },

        // ZOOM CONFIG
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "xy",
            drag: { enabled: false },
            limits: {
              y: {
                min: -4000,
                max: 10000,
              },
            },
          },
          pan: { enabled: false },
        },

        legend: { display: false },
        tooltip: { enabled: true },
      },

      scales: {
        y: {
          ticks: {
            callback: (v) => `$${v.toFixed(0)}`,
          },
        },
      },
    }),
    [lowerPrice, upperPrice]
  );

  const resetZoom = () => {
    if (chartRef.current) chartRef.current.resetZoom();
  };

  // -----------------------------------------
  // UI
  // -----------------------------------------
  return (
    <div style={{ display: "flex", gap: 20, padding: 20 }}>
      {/* LEFT: Chart */}
      <div
        style={{
          flex: 1,
          background: "white",
          padding: 20,
          borderRadius: 12,
        }}
      >
        <h2>ETH / USDC Price</h2>

        {/* Range buttons */}
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          {["24h", "7d", "30d", "90d", "1y"].map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #ccc",
                background: r === range ? "#eef2ff" : "white",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {r}
            </button>
          ))}

          <button
            onClick={resetZoom}
            style={{
              marginLeft: "auto",
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #bbb",
              cursor: "pointer",
            }}
          >
            Reset Zoom
          </button>
        </div>

        <div style={{ width: "100%", height: 420 }}>
          <LineChartJs
            ref={chartRef}
            data={chartData}
            options={chartOptions}
          />
        </div>
      </div>

      {/* RIGHT: Stats */}
      <div
        style={{
          width: 260,
          background: "#eef2ff",
          padding: 20,
          borderRadius: 12,
        }}
      >
        <h2>Stats</h2>

        <p>Current Price:</p>
        <div style={{ fontSize: 24 }}>
          {currentPrice ? `$${currentPrice.toFixed(2)}` : "--"}
        </div>

        <p style={{ marginTop: 20 }}>Fees (24h):</p>
        <div style={{ fontSize: 20 }}>${fees24h.toFixed(0)}</div>

        <h3 style={{ marginTop: 20 }}>Selected Range</h3>

        <p>Lower Price:</p>
        <div>{lowerPrice ? `$${lowerPrice.toFixed(2)}` : "--"}</div>

        <p style={{ marginTop: 10 }}>Upper Price:</p>
        <div>{upperPrice ? `$${upperPrice.toFixed(2)}` : "--"}</div>
      </div>
    </div>
  );
}
