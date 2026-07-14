"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Global scroll-reveal: fades in any element with className "reveal" as it enters
// the viewport. Re-scans on route change so every ported page animates without
// needing its own client boilerplate.
export function RevealScript() {
  const pathname = usePathname();
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    const observeAll = () =>
      document.querySelectorAll(".reveal:not(.in)").forEach((el) => io.observe(el));
    observeAll();
    // Pages that fetch data client-side (agent report, track, result) render their
    // body AFTER this effect runs, so re-scan whenever the DOM changes — otherwise
    // those late `.reveal` sections never get observed and stay invisible.
    // Coalesce bursts of mutations (e.g. the admin board re-rendering large tables every 4s) into a
    // single rAF-batched rescan, instead of a document-wide querySelectorAll on every mutation record.
    let scheduled = false;
    const scheduleObserve = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; observeAll(); });
    };
    const mo = new MutationObserver(scheduleObserve);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [pathname]);
  return null;
}
