// Sekcja wykresów profilu (prędkość, wysokość, przyspieszenie) w dwóch
// przełączalnych trybach: połączonym (jedna scena, trzy osie) i osobym
// (trzy wykresy jeden pod drugim, zsynchronizowane kursorem i tooltipami).
// Wskazanie próbki na wykresie raportuje `onHighlight` (punkt na mapie).

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartZoomSurface } from "./ChartZoomSurface.tsx";
import { Icon } from "./Icon.tsx";
import { getDistanceAxisForDomain, type DistanceDomain } from "../lib/chart.ts";
import { accelDomain, findNearestIndex, type ProfilePoint } from "../lib/chartSeries.ts";
import { readChartMode, writeChartMode, type ChartMode } from "../lib/chartMode.ts";

type SeriesKey = "speed" | "altitude" | "accel";

const SERIES: Record<SeriesKey, { dataKey: "v" | "h" | "a"; label: string; color: string; unit: string }> = {
  speed: { dataKey: "v", label: "prędkość", color: "#ee6b4a", unit: " km/h" },
  altitude: { dataKey: "h", label: "wysokość", color: "#358866", unit: " m" },
  accel: { dataKey: "a", label: "przyspieszenie", color: "#8b5cf6", unit: " km/h/s" },
};

const SERIES_ORDER: SeriesKey[] = ["speed", "altitude", "accel"];

export interface ProfileSegment {
  endD: number;
  id: string;
}

export interface ProfileChartsProps {
  data: ProfilePoint[];
  axisMaxKm: number;
  domain: DistanceDomain;
  onDomainChange: (next: DistanceDomain) => void;
  onReset: () => void;
  onHighlight?: (point: { lat: number; lon: number } | null) => void;
  speedMaxKmh: number;
  segments?: ProfileSegment[];
  eyebrow: string;
  title: string;
}

const TOOLTIP_STYLE = { background: "#17363b", border: 0, borderRadius: 10, color: "#fff" };
const AXIS_TICK = { fill: "#71858a", fontSize: 11 };
const CROSSHAIR = "#17363b";
const BOUNDARY = "#8fb7ac";

function formatDistanceTick(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function altitudeDomain(points: ProfilePoint[]): [number, number] {
  if (points.length === 0) return [0, 1];
  const min = Math.min(...points.map((point) => point.h));
  const max = Math.max(...points.map((point) => point.h));
  const padding = Math.max((max - min) * 0.12, 1);
  return [Math.floor((min - padding) * 10) / 10, Math.ceil((max + padding) * 10) / 10];
}

export function ProfileCharts({
  data,
  axisMaxKm,
  domain,
  onDomainChange,
  onReset,
  onHighlight,
  speedMaxKmh,
  segments,
  eyebrow,
  title,
}: ProfileChartsProps) {
  const [mode, setMode] = useState<ChartMode>(() => readChartMode());
  const [enabled, setEnabled] = useState<Record<SeriesKey, boolean>>({
    speed: true,
    altitude: true,
    accel: true,
  });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  function changeMode(next: ChartMode): void {
    setMode(next);
    writeChartMode(next);
  }

  function toggle(key: SeriesKey): void {
    setEnabled((current) => ({ ...current, [key]: !current[key] }));
  }

  const distanceAxis = useMemo(
    () => getDistanceAxisForDomain(domain[0], domain[1]),
    [domain],
  );
  const altDomain = useMemo(() => altitudeDomain(data), [data]);
  const aDomain = useMemo(() => accelDomain(data.map((point) => point.a)), [data]);

  const hasData = data.length > 0;
  const show: Record<SeriesKey, boolean> = {
    speed: enabled.speed && hasData,
    altitude: enabled.altitude && hasData,
    accel: enabled.accel && hasData,
  };
  const visibleKeys = SERIES_ORDER.filter((key) => show[key]);

  const hoveredD = hoverIndex !== null ? data[hoverIndex]?.d ?? null : null;

  const highlightPoint = useMemo(() => {
    if (hoverIndex === null) return null;
    const point = data[hoverIndex];
    return point ? { lat: point.lat, lon: point.lon } : null;
  }, [hoverIndex, data]);

  useEffect(() => {
    onHighlight?.(highlightPoint);
  }, [highlightPoint, onHighlight]);

  function handleMove(state: { activeTooltipIndex?: number | string } | null): void {
    const index = state?.activeTooltipIndex;
    if (typeof index === "number" && index >= 0 && index < data.length) setHoverIndex(index);
  }

  function handleLeave(): void {
    setHoverIndex(null);
  }

  function handleTap(fraction: number): void {
    const distance = domain[0] + fraction * (domain[1] - domain[0]);
    setHoverIndex(findNearestIndex(data, distance));
  }

  const boundaries = segments ?? [];
  // W trybie połączonym kursor i granice zjazdów muszą wskazać istniejącą oś Y
  // (Recharts wymaga zgodności yAxisId); gdy wszystkie serie ukryte — pomijamy.
  const crosshairAxisId = show.speed ? "speed" : show.altitude ? "alt" : show.accel ? "accel" : null;

  function boundaryLines(prefix: string, axisId?: string) {
    if (axisId === undefined && prefix === "merged" && crosshairAxisId === null) return null;
    return boundaries.map((segment) => (
      <ReferenceLine
        key={`${prefix}-${segment.id}`}
        stroke={BOUNDARY}
        strokeDasharray="4 4"
        x={segment.endD}
        {...(axisId ? { yAxisId: axisId } : {})}
      />
    ));
  }

  function crosshair(prefix: string, axisId?: string) {
    if (hoveredD === null) return null;
    if (axisId === undefined && prefix === "merged" && crosshairAxisId === null) return null;
    return (
      <ReferenceLine
        key={`${prefix}-cross`}
        stroke={CROSSHAIR}
        strokeDasharray="3 3"
        x={hoveredD}
        {...(axisId ? { yAxisId: axisId } : {})}
      />
    );
  }

  const tooltip = (
    <Tooltip
      animationDuration={80}
      contentStyle={TOOLTIP_STYLE}
      labelFormatter={(value) => `${Number(value).toFixed(2)} km`}
      offset={24}
    />
  );

  function xAxis(withTicks: boolean) {
    return (
      <XAxis
        allowDataOverflow
        axisLine={false}
        dataKey="d"
        domain={domain}
        height={withTicks ? 30 : 8}
        interval="preserveStartEnd"
        minTickGap={18}
        tick={withTicks ? AXIS_TICK : false}
        tickFormatter={formatDistanceTick}
        tickLine={false}
        ticks={distanceAxis.ticks}
        type="number"
      />
    );
  }

  function speedAxis() {
    return (
      <YAxis
        axisLine={false}
        domain={[0, speedMaxKmh]}
        tick={AXIS_TICK}
        tickLine={false}
        tickMargin={4}
        width={44}
        yAxisId="speed"
      />
    );
  }

  function altitudeAxis() {
    return (
      <YAxis
        axisLine={false}
        domain={altDomain}
        orientation="right"
        tick={AXIS_TICK}
        tickLine={false}
        tickMargin={4}
        width={44}
        yAxisId="alt"
      />
    );
  }

  function accelAxis() {
    // W trybie połączonym oś przyspieszenia jest ukryta (szerokość 0, bez
    // ticków) — zostaje tylko do skalowania linii; wartość odczytasz z
    // tooltipa po najechaniu. Dzięki temu scena jest czytelniejsza.
    return (
      <YAxis
        axisLine={false}
        domain={aDomain}
        orientation="right"
        tick={false}
        tickLine={false}
        width={0}
        yAxisId="accel"
      />
    );
  }

  function speedBand() {
    if (!show.speed || speedMaxKmh <= 100) return null;
    return <ReferenceArea fill="#f5a276" fillOpacity={0.2} y1={100} y2={150} yAxisId="speed" />;
  }

  function mergedChart() {
    return (
      <ResponsiveContainer height="100%" width="100%">
        <ComposedChart
          data={data}
          margin={{ left: 0, right: 8, top: 10, bottom: 0 }}
          onMouseLeave={handleLeave}
          onMouseMove={handleMove}
        >
          <CartesianGrid stroke="#dbe5e8" strokeDasharray="3 3" />
          {xAxis(true)}
          {show.speed && speedAxis()}
          {show.altitude && altitudeAxis()}
          {show.accel && accelAxis()}
          {tooltip}
          {speedBand()}
          {show.altitude && (
            <Area
              dataKey="h"
              fill="#78b99b"
              fillOpacity={0.28}
              isAnimationActive={false}
              name="wysokość"
              stroke="#358866"
              strokeWidth={2}
              type="monotone"
              unit=" m"
              yAxisId="alt"
            />
          )}
          {show.accel && (
            <ReferenceLine stroke={SERIES.accel.color} strokeOpacity={0.5} y={0} yAxisId="accel" />
          )}
          {show.speed && (
            <Line
              dataKey="v"
              dot={false}
              isAnimationActive={false}
              name="prędkość"
              stroke="#ee6b4a"
              strokeWidth={2.5}
              type="monotone"
              unit=" km/h"
              yAxisId="speed"
            />
          )}
          {show.accel && (
            <Line
              dataKey="a"
              dot={false}
              isAnimationActive={false}
              name="przyspieszenie"
              stroke={SERIES.accel.color}
              strokeWidth={2}
              type="monotone"
              unit=" km/h/s"
              yAxisId="accel"
            />
          )}
          {boundaryLines("merged", crosshairAxisId ?? undefined)}
          {crosshair("merged", crosshairAxisId ?? undefined)}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  function separateChart(key: SeriesKey, last: boolean) {
    return (
      <div className="chart-subwrap" key={key}>
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart
            data={data}
            margin={{ left: 0, right: 8, top: 6, bottom: 0 }}
            onMouseLeave={handleLeave}
            onMouseMove={handleMove}
            syncId="profile"
          >
            <CartesianGrid stroke="#dbe5e8" strokeDasharray="3 3" />
            {xAxis(last)}
            <YAxis
              axisLine={false}
              domain={key === "speed" ? [0, speedMaxKmh] : key === "altitude" ? altDomain : aDomain}
              tick={AXIS_TICK}
              tickLine={false}
              tickMargin={4}
              width={44}
            />
            {tooltip}
            {key === "speed" && speedMaxKmh > 100 && (
              <ReferenceArea fill="#f5a276" fillOpacity={0.2} y1={100} y2={150} />
            )}
            {key === "accel" && <ReferenceLine stroke={SERIES.accel.color} strokeOpacity={0.5} y={0} />}
            {key === "altitude" && (
              <Area
                dataKey="h"
                fill="#78b99b"
                fillOpacity={0.28}
                isAnimationActive={false}
                name="wysokość"
                stroke="#358866"
                strokeWidth={2}
                type="monotone"
                unit=" m"
              />
            )}
            {key === "speed" && (
              <Line
                dataKey="v"
                dot={false}
                isAnimationActive={false}
                name="prędkość"
                stroke="#ee6b4a"
                strokeWidth={2.5}
                type="monotone"
                unit=" km/h"
              />
            )}
            {key === "accel" && (
              <Line
                dataKey="a"
                dot={false}
                isAnimationActive={false}
                name="przyspieszenie"
                stroke={SERIES.accel.color}
                strokeWidth={2}
                type="monotone"
                unit=" km/h/s"
              />
            )}
            {boundaryLines(key)}
            {crosshair(key)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  function separateCharts() {
    return (
      <div className="chart-stack">
        {visibleKeys.map((key, index) => separateChart(key, index === visibleKeys.length - 1))}
      </div>
    );
  }

  return (
    <section className="chart-card">
      <div className="chart-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <div className="chart-mode-toggle" role="group" aria-label="Tryb wykresów">
          <button
            aria-label="Tryb połączony"
            aria-pressed={mode === "combined"}
            className={`chart-mode-button${mode === "combined" ? " is-active" : ""}`}
            onClick={() => changeMode("combined")}
            title="Połączony (3 osie)"
            type="button"
          >
            <Icon name="chart-combined" size={16} />
          </button>
          <button
            aria-label="Tryb osobny"
            aria-pressed={mode === "separate"}
            className={`chart-mode-button${mode === "separate" ? " is-active" : ""}`}
            onClick={() => changeMode("separate")}
            title="Osobny (3 wykresy)"
            type="button"
          >
            <Icon name="chart-rows" size={16} />
          </button>
        </div>
      </div>

      <div className="chart-legend-row">
        {SERIES_ORDER.map((key) => (
          <button
            aria-pressed={enabled[key]}
            className={`chart-legend-item legend-${key}${enabled[key] ? "" : " is-off"}`}
            key={key}
            onClick={() => toggle(key)}
            type="button"
          >
            <i /> {SERIES[key].label}
          </button>
        ))}
      </div>

      <ChartZoomSurface
        className={`chart-wrap${mode === "separate" ? " chart-wrap-stack" : ""}`}
        dataMaxKm={axisMaxKm}
        domain={domain}
        onDomainChange={onDomainChange}
        onReset={onReset}
        onTap={handleTap}
      >
        {mode === "combined" ? mergedChart() : separateCharts()}
      </ChartZoomSurface>

      <div className="chart-axis-label">Dystans [km]</div>
    </section>
  );
}
