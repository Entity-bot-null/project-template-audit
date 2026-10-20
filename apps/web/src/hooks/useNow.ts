import { useEffect, useState } from 'react';

/**
 * The time now, again every `everyMs` while shown: for what holds until a
 * moment (a quiet time, a silence), so it ends on screen when it ends.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, everyMs);
    return () => {
      clearInterval(timer);
    };
  }, [everyMs]);
  return now;
}
