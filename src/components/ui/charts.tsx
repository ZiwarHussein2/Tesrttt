"use client";

import * as React from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";

// Recharts wrappers with the Merna monochrome-first chart style.
// Palette: ink primary, gray secondary, semantic colors only for status.

export const CHART_COLORS = ["#171717", "#8f8f8f", "#0070f3", "#7928ca", "#f5a623", "#ee0000", "#29bc9b"];

function compactIQD(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(Math.round(v));
}

const tooltipStyle: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid #ebebeb",
  boxShadow: "0px 2px 2px #0000000a, 0px 8px 16px -4px #0000000a",
  fontSize: 12,
  padding: "8px 10px",
  background: "#ffffff",
};

function fmtVal(v: unknown, money: boolean, digits = 0): string {
  if (typeof v !== "number") return String(v ?? "");
  return money
    ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(v))} IQD`
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(v);
}

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
}

export function TrendLines({
  data,
  series,
  money = false,
  height = 260,
}: {
  data: Record<string, string | number>[];
  series: SeriesDef[];
  money?: boolean;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: money ? 8 : 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#ebebeb" }} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={money ? 44 : 36} tickFormatter={(v) => (money ? compactIQD(v) : compactIQD(v))} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown, name: unknown) => [fmtVal(v, money), String(name)]} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconSize={10} />}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth={1.75}
            dot={false}
            activeDot={{ r: 3.5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function AreaTrend({
  data,
  series,
  money = false,
  height = 260,
  stacked = false,
}: {
  data: Record<string, string | number>[];
  series: SeriesDef[];
  money?: boolean;
  height?: number;
  stacked?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: money ? 8 : 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#ebebeb" }} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={money ? 44 : 36} tickFormatter={(v) => compactIQD(v)} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown, name: unknown) => [fmtVal(v, money), String(name)]} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconSize={10} />}
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? "a" : undefined}
            stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
            fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
            fillOpacity={0.08}
            strokeWidth={1.75}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CompareBars({
  data,
  series,
  money = false,
  height = 260,
  stacked = false,
  horizontal = false,
}: {
  data: Record<string, string | number>[];
  series: SeriesDef[];
  money?: boolean;
  height?: number;
  stacked?: boolean;
  horizontal?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 8, bottom: 0, left: horizontal ? 24 : money ? 8 : 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => compactIQD(v)} />
            <YAxis type="category" dataKey="label" tickLine={false} axisLine={{ stroke: "#ebebeb" }} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#ebebeb" }} interval={0} minTickGap={8} />
            <YAxis tickLine={false} axisLine={false} width={money ? 44 : 36} tickFormatter={(v) => compactIQD(v)} />
          </>
        )}
        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown, name: unknown) => [fmtVal(v, money), String(name)]} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconSize={10} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? "a" : undefined}
            fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
            radius={stacked ? 0 : [3, 3, 0, 0]}
            maxBarSize={40}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// Waterfall: revenue → deductions → net. Uses an invisible "base" series.
export function Waterfall({
  data,
  height = 260,
}: {
  data: { label: string; base: number; value: number; color?: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#ebebeb" }} interval={0} />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v) => compactIQD(v)} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: unknown, name: unknown) => (name === "base" ? [null, null] : [fmtVal(v, true), "Amount"])}
        />
        <Bar dataKey="base" stackId="w" fill="transparent" />
        <Bar dataKey="value" stackId="w" maxBarSize={48}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? "#171717"} radius={3} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ScatterPlot({
  data,
  xLabel,
  yLabel,
  money = false,
  height = 280,
}: {
  data: { x: number; y: number; label: string }[];
  xLabel: string;
  yLabel: string;
  money?: boolean;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 12, right: 12, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis type="number" dataKey="x" name={xLabel} tickLine={false} axisLine={{ stroke: "#ebebeb" }} tickFormatter={(v) => compactIQD(v)} label={{ value: xLabel, position: "insideBottom", offset: -4, fontSize: 11, fill: "#888" }} />
        <YAxis type="number" dataKey="y" name={yLabel} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => compactIQD(v)} label={{ value: yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "#888" }} />
        <ZAxis range={[50, 51]} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: unknown, name: unknown) => [fmtVal(v, money), String(name)]}
          labelFormatter={() => ""}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content={({ payload }: any) => {
            const p = payload?.[0]?.payload;
            if (!p) return null;
            return (
              <div style={tooltipStyle}>
                <p style={{ fontWeight: 600 }}>{p.label}</p>
                <p>{xLabel}: {fmtVal(p.x, money)}</p>
                <p>{yLabel}: {fmtVal(p.y, money)}</p>
              </div>
            );
          }}
        />
        <Scatter data={data} fill="#171717" fillOpacity={0.75} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
