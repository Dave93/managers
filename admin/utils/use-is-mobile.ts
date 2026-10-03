import { useEffect, useState } from "react";

// Returns true on viewports narrower than `breakpoint` (default 768px = Tailwind md).
// Starts false so SSR and the first client render match (desktop), then flips
// after mount — no hydration mismatch, just a one-frame switch on phones.
export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);

  return isMobile;
}
