import { useEffect, useState } from 'react';

// Wall-clock time that refreshes every `everyMs`, so date maths stays pure in render.
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
