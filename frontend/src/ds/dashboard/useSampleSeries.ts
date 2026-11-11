import { useState } from 'react';

// Appends value each time tick changes, keeping the last `length` samples;
// done during render (like useOverviewHistory) so the line never lags the number.
export function useSampleSeries(value: number, tick: unknown, length = 40): number[] {
  const [state, setState] = useState<{ tick: unknown; series: number[] }>({
    tick: undefined,
    series: [],
  });
  if (tick !== undefined && tick !== state.tick) {
    setState({ tick, series: [...state.series, value].slice(-length) });
  }
  return state.series;
}
