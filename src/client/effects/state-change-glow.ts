import { useEffect, useRef, useState } from "react";

/**
 * True for `ms` (default 1500) after `value` changes, never on mount: drives a one-shot glow when a state
 * flips. The theme turns it into an animation, or a 1px outline under reduced motion (`motion-reduce:`).
 */
export function useStateChangeGlow(value: unknown, ms = 1500): boolean {
  const prev = useRef(value);
  const duration = useRef(ms);
  duration.current = ms;
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (Object.is(prev.current, value)) return;
    prev.current = value;
    setOn(true);
    const timer = setTimeout(() => setOn(false), duration.current);
    return () => clearTimeout(timer);
  }, [value]);

  return on;
}
