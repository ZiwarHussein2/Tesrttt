// Server-renderable inline SVG sparkline — no chart library needed.
export function Sparkline({
  data,
  width = 72,
  height = 24,
  negative = false,
}: {
  data: number[];
  width?: number;
  height?: number;
  negative?: boolean;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const points = data
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const color = negative ? "#c50000" : "#171717";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}
