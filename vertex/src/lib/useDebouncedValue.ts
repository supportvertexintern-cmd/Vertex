import { useEffect, useState } from "react";

/** Delays reflecting a fast-changing value (typically search input) so a
 * server-side search request only fires once typing pauses, not on every
 * keystroke. */
export function useDebouncedValue<T>(value: T, delayMs: number = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
