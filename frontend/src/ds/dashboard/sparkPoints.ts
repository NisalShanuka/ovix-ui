// SVG polyline points for a 0-based sparkline: the peak touches the top edge.
export function sparkPoints(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return '';
  const series = values.length === 1 ? [values[0], values[0]] : values;
  const max = Math.max(...series);
  const step = width / (series.length - 1);
  return series
    .map((v, i) => {
      const y = max > 0 ? height - (Math.max(0, v) / max) * height : height;
      return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
