import type { Point } from '@shared/stats.ts';
import { addDays } from '@shared/stats.ts';

const W = 340;
const H = 132;
const PAD = { l: 34, r: 8, t: 8, b: 20 };

const shortDay = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;

/** Media móvil de `n` días por fecha (solo con días que tienen dato). */
export function movingAverage(series: Point[], n = 7): Point[] {
  return series.map((p) => {
    const from = addDays(p.date, -(n - 1));
    const win = series.filter((q) => q.date >= from && q.date <= p.date).map((q) => q.value);
    return { date: p.date, value: win.reduce((a, b) => a + b, 0) / win.length };
  });
}

/**
 * Gráfica de un campo en un periodo: cada día con dato es un punto y la línea es la media de 7 días
 * (lo que decide en peso y sueño). `bars` dibuja barras (p. ej. series por semana).
 */
export function TrendChart({ series, from, to, label, format, bars = false }: {
  series: Point[];
  from: string;
  to: string;
  label: string;
  format: (v: number) => string;
  bars?: boolean;
}) {
  const span = Math.max(1, (Date.parse(to) - Date.parse(from)) / 86400000);
  const x = (d: string) => PAD.l + ((Date.parse(d) - Date.parse(from)) / 86400000 / span) * (W - PAD.l - PAD.r);
  const vals = series.map((p) => p.value);
  let lo = bars ? 0 : Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi === lo) { hi += 1; lo = bars ? 0 : lo - 1; }
  const m = bars ? 0 : (hi - lo) * 0.12;
  lo -= m; hi += m;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const avg = bars ? [] : movingAverage(series);
  const line = avg.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const barW = Math.max(4, ((W - PAD.l - PAD.r) / Math.max(series.length, 1)) * 0.6);
  const desc = series.length
    ? `${label}: ${series.length} ${bars ? 'semanas' : 'días con dato'} entre el ${shortDay(from)} y el ${shortDay(to)}; mínimo ${format(Math.min(...vals))}, máximo ${format(Math.max(...vals))}, último ${format(vals[vals.length - 1])}.`
    : `${label}: sin datos en el periodo.`;
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc}>
      {[lo + m, hi - m].map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="trend-grid" />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="trend-axis">{format(v)}</text>
        </g>
      ))}
      <text x={PAD.l} y={H - 4} className="trend-axis">{shortDay(from)}</text>
      <text x={W - PAD.r} y={H - 4} textAnchor="end" className="trend-axis">{shortDay(to)}</text>
      {bars
        ? series.map((p) => <rect key={p.date} x={x(p.date) - barW / 2} y={y(p.value)} width={barW} height={Math.max(0, y(lo) - y(p.value))} rx="2" className="trend-bar" />)
        : series.map((p) => <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r="2.4" className="trend-dot" />)}
      {line ? <path d={line} className="trend-line" /> : null}
    </svg>
  );
}
