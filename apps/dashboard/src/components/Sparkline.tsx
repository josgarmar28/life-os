import type { Point } from '@shared/stats.ts';
import { addDays } from '@shared/stats.ts';

/** Minigráfico de los últimos `days` días; los días sin dato quedan como hueco. */
export function Sparkline({ series, today, days = 30, height = 36 }: { series: Point[]; today: string; days?: number; height?: number }) {
  const width = 120;
  if (series.length < 2) return <svg className="spark" width={width} height={height} aria-hidden="true" />;
  const from = addDays(today, -(days - 1));
  const xs = (d: string) => ((Date.parse(d) - Date.parse(from)) / 86400000 / (days - 1)) * (width - 4) + 2;
  const vals = series.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const ys = (v: number) => (hi === lo ? height / 2 : height - 3 - ((v - lo) / (hi - lo)) * (height - 6));
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${xs(p.date).toFixed(1)},${ys(p.value).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Tendencia de ${series.length} días con dato`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xs(last.date)} cy={ys(last.value)} r="2.6" fill="currentColor" />
    </svg>
  );
}
