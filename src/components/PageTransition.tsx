import { useLocation } from "react-router-dom";
import { useEffect, useRef, ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Wraps page content with a native-app-like enter animation.
 * Re-triggers on every route change by keying on pathname.
 */
export const PageTransition = ({ children }: PageTransitionProps) => {
  const { pathname } = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Remove then re-add class to re-trigger animation on each navigation
    el.classList.remove("page-enter");
    // Force reflow
    void el.offsetWidth;
    el.classList.add("page-enter");
  }, [pathname]);

  return (
    <div ref={ref} className="page-enter w-full">
      {children}
    </div>
  );
};
